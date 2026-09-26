// src/lib/erp/orders/run.ts
// 주문 수집 한 번을 erp.job_runs('orders-sync')에 남긴다 — 크론과 화면 「지금 수집」이 같이 쓴다.
// 모든 채널이 실패하면 던진다(withJobRun이 failed로 남기고 텔레그램 JOB_ALERT). 일부만 실패해도 200으로 남되,
// reportAlerts(설계 해석 #24 — busy·사라짐 판정 거절·버린 라인·매핑 안 된 상태·옛 장부 경고)가 뭔가 있으면
// 같은 채팅에 채널별 확인 문구를 보낸다. 구매자 정보는 reportAlerts가 담지 않으므로 여기도 없다.
import { withJobRun } from '@/lib/jobs/run-log';
import { sendTelegramMessage } from '@/lib/telegram/client';
import { collectOrders, reportAlerts, reportCounts, type ChannelReport } from './collect';
import { CHANNEL_LABEL, type OrderChannel } from './types';

export async function runOrdersSync(p: { channels: OrderChannel[]; dryRun: boolean; trigger: 'cron' | 'manual' }): Promise<ChannelReport[]> {
  const reports = await withJobRun(
    'orders-sync',
    async () => {
      const r = await collectOrders({ channels: p.channels, dryRun: p.dryRun });
      if (r.length > 0 && r.every((x) => !x.ok)) {
        throw new Error(`모든 채널 실패: ${r.map((x) => `${CHANNEL_LABEL[x.channel]} ${x.error ?? ''}`).join(' / ')}`);
      }
      return { value: r, counts: reportCounts(r) };
    },
    { trigger: p.trigger },
  );
  const chatId = process.env.JOB_ALERT_TELEGRAM_CHAT_ID ?? '';
  if (chatId) {
    // 실패한 채널은 채널 — 오류 그대로(옛 문구 유지). 성공했지만 확인이 필요한 채널(busy는 이미 실패 쪽에 있다)은 reportAlerts로 따로 모은다.
    const failed = reports.filter((r) => !r.ok);
    const attention = reports.filter((r) => r.ok && reportAlerts(r).length > 0);
    const lines = [
      ...failed.map((f) => `${CHANNEL_LABEL[f.channel]} — ${f.error ?? '알 수 없음'}`),
      ...attention.map((r) => `${CHANNEL_LABEL[r.channel]} — ${reportAlerts(r).join(' · ')}`),
    ];
    if (lines.length > 0) {
      const text = `🟡 주문 수집 확인 필요\n${lines.join('\n')}`;
      await sendTelegramMessage(chatId, text).catch((e) => console.error('[orders-sync] 텔레그램 실패:', e));
    }
  }
  return reports;
}
