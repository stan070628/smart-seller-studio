// GET /api/erp/stock — 활성 SKU별 원장 재고(집·RG입고중·RG) · 평가액 · 최근 lot 단가 · 옛 입고 단가
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { listStock } from '@/lib/erp/stock/queries';
import { erpError } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ success: true, data: await listStock(getSourcingPool()) });
  } catch (e) {
    return erpError(e);
  }
}
