// POST /api/erp/orders/sync — 화면의 「지금 수집」(재고현황 수집 패널 · 원가관리·상품별 「판매 가져오기」). body { channel? }
// 크론과 같은 수집(기초재고 시각 이후 · 겹침 · 옛 장부 · 스위치가 켜져 있으면 차감). 날짜는 받지 않는다 — 과거 복구는 1-C2b.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { maskPII } from '@/lib/jobs/mask';
import { runOrdersSync } from '@/lib/erp/orders/run';
import { ORDER_CHANNELS, isOrderChannel } from '@/lib/erp/orders/types';
import { badRequest } from '@/lib/erp/stock/http';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { channel?: unknown } | null;
  const channel = body?.channel;
  if (channel !== undefined && channel !== null && !isOrderChannel(channel)) return badRequest(`채널이 잘못됐다: ${String(channel)}`);
  try {
    const data = await runOrdersSync({ channels: isOrderChannel(channel) ? [channel] : [...ORDER_CHANNELS], dryRun: false, trigger: 'manual' });
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return NextResponse.json({ success: false, code: 'server', error: maskPII(e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }
}
