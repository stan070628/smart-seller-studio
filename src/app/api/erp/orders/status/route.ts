// GET /api/erp/orders/status — 주문 수집 현황(채널별 오늘·어제·3일 · 미귀속 · 재고 부족 · 대기 · 마지막 수집 · 차감 스위치)
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { ordersStatus } from '@/lib/erp/orders/queries';
import { erpError } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ success: true, data: await ordersStatus(getSourcingPool(), new Date()) });
  } catch (e) {
    return erpError(e);
  }
}
