// GET /api/erp/stock/recent?limit=5 — 최근 조정(요청 단위, 되돌렸으면 증감 0). 휴대폰 「최근 수정」
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { recentAdjustments } from '@/lib/erp/stock/queries';
import { erpError } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const n = Number(request.nextUrl.searchParams.get('limit') ?? '5');
  const limit = Number.isInteger(n) ? Math.min(Math.max(n, 1), 20) : 5;
  try {
    return NextResponse.json({ success: true, data: await recentAdjustments(getSourcingPool(), limit) });
  } catch (e) {
    return erpError(e);
  }
}
