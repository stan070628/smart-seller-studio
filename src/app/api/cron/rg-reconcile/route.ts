// src/app/api/cron/rg-reconcile/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { maskPII } from '@/lib/jobs/mask';
import { withJobRun } from '@/lib/jobs/run-log';
import { sendTelegramMessage } from '@/lib/telegram/client';
import { runRgAuto } from '@/lib/erp/stock/rg-auto-run';

/** RG 주문 수집(최대 수십 초) + RG 재고 조회(1.3초 간격 페이지) */
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/rg-reconcile — 매일 RG 대조(ERP 1-C2b ④). pg_cron(124)이 09:37 KST에 부른다(:30 주문 수집과 겹치지 않게).
 * 차감이 꺼져 있으면 건너뛴다. 자동 이동 스위치가 꺼져 있거나 `?dryRun=1`이면 「옮길 예정」만 기록·보고한다.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET ?? '';
  const auth = request.headers.get('authorization') ?? '';
  if (!cronSecret || auth.replace('Bearer ', '') !== cronSecret) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const forceDry = request.nextUrl.searchParams.get('dryRun') === '1';
  try {
    const s = await withJobRun('rg-reconcile', async () => {
      const r = await runRgAuto({ now: new Date(), forceDry });
      return {
        value: r,
        counts: {
          skipped: r.skipped ? 1 : 0, auto_move: r.autoMove ? 1 : 0, skus: r.skus, moves: r.moves.length,
          moved_qty: r.moved.reduce((a, m) => a + m.qty, 0), failed: r.failed, alerts: r.alerts.length, new_alerts: r.newAlerts.length,
        },
      };
    }, { trigger: forceDry ? 'manual' : 'cron' });
    // 중복 방지: 직전 실행에 없던 알림만(고정 키 비교 · 감소는 늘). 머리줄 — 자동 이동으로 실제로 옮겼으면 늘,
    // 자동 이동이 꺼져 있으면 옮길 예정(SKU:수량)이 직전과 달라졌을 때만
    const chatId = process.env.JOB_ALERT_TELEGRAM_CHAT_ID ?? '';
    const head = s.autoMove
      ? (s.moved.length > 0 ? `✅ RG 입고 완료 자동 ${s.moved.length}건${s.failed > 0 ? ` · 실패 ${s.failed}건` : ''}` : null)
      : (s.movesChanged && s.moves.length > 0 ? `🟡 RG 대조 — 옮길 예정 ${s.moves.length}건(자동 이동 꺼짐)` : null);
    if (chatId && !s.skipped && (head || s.newAlerts.length > 0)) {
      const text = [head ?? '🟡 RG 대조 — 새 알림', ...s.newAlerts.map((a) => `· ${a}`)].join('\n');
      await sendTelegramMessage(chatId, text).catch((e) => console.error('[rg-reconcile] 텔레그램 실패:', e));
    }
    return NextResponse.json({ success: true, data: s });
  } catch (e) {
    return NextResponse.json({ success: false, error: maskPII(e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }
}
