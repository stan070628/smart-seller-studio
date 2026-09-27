// src/lib/erp/orders/run.ts
// 주문 수집 한 번을 erp.job_runs('orders-sync')에 남긴다 — 크론과 화면 「지금 수집」이 같이 쓴다.
// 모든 채널이 실패하면 던진다(withJobRun이 failed로 남기고 텔레그램 JOB_ALERT) — 단 busy(다른 실행이 임대를 잡고 있다)는
// 실패가 아니다. busy가 아닌 채널만 보고 전부 실패일 때만 던진다. 모든 채널이 busy면(수동 클릭과 크론이 겹친 것뿐) 정상
// 반환하고 counts.busy_all로만 남긴다. 일부만 실패해도 200으로 남되,
// reportAlerts(설계 해석 #24 — busy·사라짐 판정 거절·버린 라인·매핑 안 된 상태·옛 장부 경고)가 뭔가 있으면
// 같은 채팅에 채널별 확인 문구를 보낸다. 구매자 정보는 reportAlerts가 담지 않으므로 여기도 없다.
// 과거 보충(backfillFrom — 설계 해석 #25)도 같은 작업 이름으로 남기고 counts.backfill = 1로 가른다.
// busy는 겹친 실행에서 흔히 나오므로 텔레그램 알림 줄에는 싣지 않는다(counts에는 남는다 — reportCounts의 busy·<채널>_busy).
// (1-C2b ②) 쓰는 실행에 쿠팡 채널이 있으면 수집 뒤 쿠팡 즉시할인 쿠폰을 조회한다(discounts.ts) — 결과는 counts.discount_*에 남기고,
// RATE 쿠폰 주문·조회 불가로 닫은 주문이 있으면 같은 채팅에 알린다. 쿠폰 조회가 실패해도 수집 결과는 그대로 남긴다(discount_failed = 1).
import { withJobRun } from '@/lib/jobs/run-log';
import { getCoupangClient } from '@/lib/listing/coupang-client';
import { getSourcingPool } from '@/lib/sourcing/db';
import { sendTelegramMessage } from '@/lib/telegram/client';
import { collectOrders, reportAlerts, reportCounts, type ChannelReport } from './collect';
import { enrichCoupangDiscounts } from './discounts';
import { CHANNEL_LABEL, type OrderChannel } from './types';

export async function runOrdersSync(p: {
  channels: OrderChannel[];
  dryRun: boolean;
  trigger: 'cron' | 'manual';
  /** 과거 보충 시작일(KST YYYY-MM-DD). 호출자가 형식·범위를 먼저 검사한다 */
  backfillFrom?: string;
  /** 과거 보충 끝날(그날 포함) — backfillFrom과 함께만 */
  backfillTo?: string;
}): Promise<ChannelReport[]> {
  // withJobRun 밖(텔레그램 알림)에서 쿠폰 조회 결과를 읽는다
  let lastCounts: Record<string, number> = {};
  const reports = await withJobRun(
    'orders-sync',
    async () => {
      const r = await collectOrders({
        channels: p.channels, dryRun: p.dryRun, ...(p.backfillFrom !== undefined ? { backfillFrom: p.backfillFrom } : {}),
        ...(p.backfillTo !== undefined ? { backfillTo: p.backfillTo } : {}),
      });
      // busy는 실패가 아니다 — 다른 수집(수동 클릭 ↔ 크론)이 이 채널의 임대를 잡고 있을 뿐이다. 전부-실패 판정에서 뺀다
      const active = r.filter((x) => x.skipped !== 'busy');
      if (active.length > 0 && active.every((x) => !x.ok)) {
        throw new Error(`모든 채널 실패: ${active.map((x) => `${CHANNEL_LABEL[x.channel]} ${x.error ?? ''}`).join(' / ')}`);
      }
      const counts = reportCounts(r);
      // 모든 채널이 busy였다(active가 비었다) — 던지지 않고 이 값으로만 남긴다
      counts.busy_all = r.length > 0 && active.length === 0 ? 1 : 0;
      counts.backfill = p.backfillFrom !== undefined ? 1 : 0;
      counts.dry_run = p.dryRun ? 1 : 0;
      // (1-C2b ②) 쿠팡 즉시할인 — 주문마다 한 번. 실행당 주문 60건 · 90초까지(나머지는 다음 15분). 실패해도 수집 결과는 그대로 남긴다
      if (!p.dryRun && p.channels.some((c) => c === 'coupang_wing' || c === 'coupang_rg')) {
        try {
          const cp = getCoupangClient();
          const d = await enrichCoupangDiscounts(getSourcingPool(), (orderId) => cp.getOrderCoupons(orderId), {
            limitOrders: 60, deadline: Date.now() + 90_000,
          });
          Object.assign(counts, {
            discount_orders: d.orders, discount_checked: d.checked, discount_errors: d.errors,
            discount_errors_closed: d.errorsClosed, discount_rate: d.rate,
          });
        } catch (e) {
          counts.discount_failed = 1;
          console.error('[orders-sync] 쿠폰 조회 실패:', e instanceof Error ? e.message : String(e));
        }
      }
      lastCounts = counts;
      return { value: r, counts };
    },
    { trigger: p.trigger },
  );
  const chatId = process.env.JOB_ALERT_TELEGRAM_CHAT_ID ?? '';
  if (chatId) {
    // 실패한 채널은 채널 — 오류 그대로(옛 문구 유지). busy는 알림줄에서 뺀다(위 주석). 성공했지만 확인이 필요한 채널은 reportAlerts로 따로 모은다.
    const failed = reports.filter((r) => !r.ok && r.skipped !== 'busy');
    const attention = reports.filter((r) => r.ok && reportAlerts(r).length > 0);
    const lines = [
      ...failed.map((f) => `${CHANNEL_LABEL[f.channel]} — ${f.error ?? '알 수 없음'}`),
      ...attention.map((r) => `${CHANNEL_LABEL[r.channel]} — ${reportAlerts(r).join(' · ')}`),
      ...(Number(lastCounts.discount_rate ?? 0) > 0 ? [`쿠팡 율(RATE) 쿠폰 주문 ${lastCounts.discount_rate}건 — 할인 미기록`] : []),
      ...(Number(lastCounts.discount_errors_closed ?? 0) > 0
        ? [`쿠팡 쿠폰 조회 불가로 닫은 주문 ${lastCounts.discount_errors_closed}건 — 할인 모름`] : []),
    ];
    if (lines.length > 0) {
      const text = `🟡 주문 수집 확인 필요\n${lines.join('\n')}`;
      await sendTelegramMessage(chatId, text).catch((e) => console.error('[orders-sync] 텔레그램 실패:', e));
    }
  }
  return reports;
}
