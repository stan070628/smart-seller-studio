// src/app/api/cron/stock-sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { runStockSync, formatSyncReport } from '@/lib/stock-sync/run';
import { sendTelegramMessage } from '@/lib/telegram/client';
import { withJobRun } from '@/lib/jobs/run-log';

/** 쿠팡 옵션 140여 개 조회 + 네이버 상세 700ms 간격이라 60초를 넘긴다 */
export const maxDuration = 300;

/**
 * GET /api/cron/stock-sync — 쿠팡 Wing에서 못 파는 옵션을 네이버·토스에서 품절 처리
 *
 * 호출은 Supabase pg_cron(supabase/migrations/108_pg_cron_stock_sync.sql)이 3시간마다 한다.
 * GitHub Actions 스케줄은 5~6시간 간격으로 밀려(2026-09-25 실측) 수동 실행용으로만 남겼다.
 * 실행 기록은 erp.job_runs에 남는다(withJobRun).
 *
 * `?dryRun=1`이면 판정만 하고 아무것도 바꾸지 않는다.
 * 텔레그램은 바뀐 것이나 오류가 있을 때만 보낸다 — 3시간마다 「변화 없음」이 오면 알림을 안 보게 된다.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET ?? '';
  const auth = request.headers.get('authorization') ?? '';
  if (!cronSecret || auth.replace('Bearer ', '') !== cronSecret) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  const chatId = process.env.STOCK_SYNC_TELEGRAM_CHAT_ID ?? '';

  try {
    const result = await withJobRun(
      'stock-sync',
      async () => {
        const r = await runStockSync({ dryRun });
        return { value: r, counts: { links: r.links, changes: r.changes.length, errors: r.errors.length } };
      },
      { trigger: dryRun ? 'manual' : 'cron' },
    );
    if (chatId && (result.changes.length || result.errors.length)) {
      await sendTelegramMessage(chatId, formatSyncReport(result));
    }
    return NextResponse.json({ success: true, ...result });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (chatId) await sendTelegramMessage(chatId, `🔴 재고 동기화 실패: ${msg}`);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
