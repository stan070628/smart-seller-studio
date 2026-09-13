import { NextRequest, NextResponse } from 'next/server';
import { runStockSync, formatSyncReport } from '@/lib/stock-sync/run';
import { sendTelegramMessage } from '@/lib/telegram/client';

const CRON_SECRET = process.env.CRON_SECRET ?? '';

/** 쿠팡 옵션 140여 개 조회 + 네이버 상세 700ms 간격이라 60초를 넘긴다 */
export const maxDuration = 300;

/**
 * GET /api/cron/stock-sync — 쿠팡 Wing에서 못 파는 옵션을 네이버·토스에서 품절 처리
 *
 * Vercel Hobby는 cron을 하루 1회만 허용해 3시간 주기를 못 건다.
 * 그래서 호출은 GitHub Actions(.github/workflows/stock-sync.yml)가 하고 로직은 여기 둔다 —
 * 쿠팡 IP 조건을 푸는 프록시와 채널 키가 이미 Vercel에 있기 때문이다.
 *
 * `?dryRun=1`이면 판정만 하고 아무것도 바꾸지 않는다.
 * 텔레그램은 바뀐 것이나 오류가 있을 때만 보낸다 — 3시간마다 「변화 없음」이 오면 알림을 안 보게 된다.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') ?? '';
  if (!CRON_SECRET || auth.replace('Bearer ', '') !== CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  const chatId = process.env.STOCK_SYNC_TELEGRAM_CHAT_ID ?? '';

  try {
    const result = await runStockSync({ dryRun });
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
