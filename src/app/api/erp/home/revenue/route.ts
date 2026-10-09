// src/app/api/erp/home/revenue/route.ts
// GET ?period=today|7d|30d|month — A12 매출 추이(채널별 일 매출). ERP DB만 읽는다
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { buildRevenue } from '@/lib/erp/home/revenue';
import { badRequest, erpError } from '@/lib/erp/stock/http';
import { isPeriod, type Period } from '@/lib/dashboard/types';

export const dynamic = 'force-dynamic';
const PERIODS: readonly Period[] = ['today', '7d', '30d', 'month'];

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const p = request.nextUrl.searchParams.get('period') ?? '30d';
  if (!isPeriod(p)) return badRequest(`period는 ${PERIODS.join('|')} 중 하나다: ${p}`);
  try {
    return NextResponse.json({ success: true, data: await buildRevenue(getSourcingPool(), p as Period, new Date()) });
  } catch (e) {
    return erpError(e);
  }
}
