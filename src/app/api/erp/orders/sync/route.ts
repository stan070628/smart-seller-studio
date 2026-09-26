// POST /api/erp/orders/sync — 화면의 「지금 수집」(재고현황 수집 패널 · 원가관리·상품별 「판매 가져오기」). body { channel?, dryRun?, backfillFrom? }
// 크론과 같은 수집(기초재고 시각 이후 · 겹침 · 옛 장부 · 스위치가 켜져 있으면 차감).
// backfillFrom('YYYY-MM-DD' KST — 설계 해석 #25): 한 번만 쓰는 과거 보충. 그날 0시부터 가져와 옛 장부(sale_records)를 채운다 —
//   사라짐 판정·커서 이동 없음, 기초 이전 라인은 차감하지 않는다(pre_cutover). 기초 시각 전 · 기초 시각 − 62일 이후만(아니면 400).
// dryRun(true | 1 | '1') = 가져와서 세기만 하고 쓰지 않는다.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { maskPII } from '@/lib/jobs/mask';
import { runOrdersSync } from '@/lib/erp/orders/run';
import { checkBackfillFrom } from '@/lib/erp/orders/backfill-request';
import { ORDER_CHANNELS, isOrderChannel } from '@/lib/erp/orders/types';
import { BackfillError } from '@/lib/erp/orders/window';
import { badRequest } from '@/lib/erp/stock/http';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function parseDryRun(v: unknown): boolean | null {
  if (v === undefined || v === null || v === false || v === 0 || v === '0') return false;
  if (v === true || v === 1 || v === '1') return true;
  return null;
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { channel?: unknown; dryRun?: unknown; backfillFrom?: unknown } | null;
  const channel = body?.channel;
  if (channel !== undefined && channel !== null && !isOrderChannel(channel)) return badRequest(`채널이 잘못됐다: ${String(channel)}`);
  const dryRun = parseDryRun(body?.dryRun);
  if (dryRun === null) return badRequest(`dryRun은 true·1이어야 한다: ${String(body?.dryRun).slice(0, 20)}`);
  try {
    const backfillFrom = await checkBackfillFrom(body?.backfillFrom);
    const data = await runOrdersSync({
      channels: isOrderChannel(channel) ? [channel] : [...ORDER_CHANNELS], dryRun, trigger: 'manual',
      ...(backfillFrom !== undefined ? { backfillFrom } : {}),
    });
    return NextResponse.json({ success: true, data });
  } catch (e) {
    if (e instanceof BackfillError) return badRequest(e.message);
    return NextResponse.json({ success: false, code: 'server', error: maskPII(e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }
}
