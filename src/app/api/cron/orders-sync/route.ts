// src/app/api/cron/orders-sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { maskPII } from '@/lib/jobs/mask';
import { runOrdersSync } from '@/lib/erp/orders/run';
import { checkBackfillFrom, checkBackfillTo } from '@/lib/erp/orders/backfill-request';
import { BackfillError } from '@/lib/erp/orders/window';
import { ORDER_CHANNELS, isOrderChannel } from '@/lib/erp/orders/types';

/** 네이버 변경 조회(500ms 간격)·RG(1.3초 간격)가 겹치면 1분을 넘긴다 */
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/orders-sync — 4채널 주문 수집(ERP 1-C2a). 채널 API는 읽기만 한다(발주확인·송장·재고 쓰기 없음).
 *
 * 호출은 Supabase pg_cron(supabase/migrations/118_pg_cron_orders_sync.sql)이 15분마다 한다. 실행 기록은 erp.job_runs('orders-sync').
 * `?dryRun=1` = 가져와서 연결만 세고 쓰지 않는다 · `?channel=<coupang_wing|coupang_rg|naver|toss>` = 그 채널만 ·
 * `?backfillFrom=YYYY-MM-DD[&backfillTo=YYYY-MM-DD]` = 한 번만 쓰는 과거 보충(끝날 포함 — 줄이 많으면 나눠 부른다)(설계 해석 #25 — 사라짐 판정·커서 이동 없음, 틀리면 400). 셋 중 하나라도 있으면 manual로 남는다.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET ?? '';
  const auth = request.headers.get('authorization') ?? '';
  if (!cronSecret || auth.replace('Bearer ', '') !== cronSecret) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const sp = request.nextUrl.searchParams;
  const channel = sp.get('channel');
  if (channel !== null && !isOrderChannel(channel)) {
    return NextResponse.json({ success: false, error: `채널이 잘못됐다: ${channel}` }, { status: 400 });
  }
  const dryRun = sp.get('dryRun') === '1';
  const bfRaw = sp.get('backfillFrom');
  const btRaw = sp.get('backfillTo');
  const manual = dryRun || channel !== null || bfRaw !== null || btRaw !== null || sp.get('trigger') === 'manual';
  try {
    const backfillFrom = await checkBackfillFrom(bfRaw);
    const backfillTo = await checkBackfillTo(btRaw, backfillFrom);
    const reports = await runOrdersSync({
      channels: channel ? [channel] : [...ORDER_CHANNELS], dryRun, trigger: manual ? 'manual' : 'cron',
      ...(backfillFrom !== undefined ? { backfillFrom } : {}),
      ...(backfillTo !== undefined ? { backfillTo } : {}),
    });
    return NextResponse.json({ success: true, reports });
  } catch (e) {
    if (e instanceof BackfillError) return NextResponse.json({ success: false, error: e.message }, { status: 400 });
    return NextResponse.json({ success: false, error: maskPII(e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }
}
