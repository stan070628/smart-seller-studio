// src/app/api/erp/sales/karrot/route.ts
// GET 최근 당근 판매 10건 · POST { skuId, qty, amount, soldOn, note?, requestId } — 휴대폰·PC 공용
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { karrotErrorResponse, recentKarrot, recordKarrotSale, validateKarrot } from '@/lib/erp/orders/karrot';
import { kstDay } from '@/lib/erp/orders/window';
import { erpError, withTx } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ success: true, data: await recentKarrot(getSourcingPool(), 10) });
  } catch (e) {
    return erpError(e);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const now = new Date();
  try {
    const input = validateKarrot(await request.json().catch(() => null), kstDay(now.toISOString()));
    const data = await withTx((c) => recordKarrotSale(c, input, now));
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return karrotErrorResponse(e) ?? erpError(e);
  }
}
