// src/app/api/erp/home/revenue/route.ts
// GET ?period=today|7d|30d|month — A12 매출 추이(채널별 일 매출). ERP DB만 읽는다
// 이번달이면 최근 6개월 월 매출(months)을 함께 준다 — 9월 전은 옛 장부 기준(monthly.ts)
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { buildRevenue } from '@/lib/erp/home/revenue';
import { buildMonthly } from '@/lib/erp/home/monthly';
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
    const pool = getSourcingPool();
    const now = new Date();
    const [data, months] = await Promise.all([
      buildRevenue(pool, p as Period, now),
      p === 'month' ? buildMonthly(pool, now) : Promise.resolve(undefined),
    ]);
    return NextResponse.json({ success: true, data: months ? { ...data, months } : data });
  } catch (e) {
    return erpError(e);
  }
}
