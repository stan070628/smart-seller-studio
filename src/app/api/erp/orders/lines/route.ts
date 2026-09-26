// GET /api/erp/orders/lines?channel=naver&date=2026-09-27 — 그 채널·KST 날짜(주문 시각)의 라인(구매자 정보 없음)
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { dayLines } from '@/lib/erp/orders/queries';
import { isOrderChannel } from '@/lib/erp/orders/types';
import { badRequest, erpError } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const sp = request.nextUrl.searchParams;
  const channel = sp.get('channel');
  const date = sp.get('date') ?? '';
  if (!isOrderChannel(channel)) return badRequest(`채널이 잘못됐다: ${channel}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return badRequest(`날짜는 YYYY-MM-DD다: ${date}`);
  try {
    return NextResponse.json({ success: true, data: await dayLines(getSourcingPool(), channel, date) });
  } catch (e) {
    return erpError(e);
  }
}
