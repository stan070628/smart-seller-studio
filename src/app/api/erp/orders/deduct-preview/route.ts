// GET /api/erp/orders/deduct-preview — 「차감 켜기」를 누르면 소급해서 빠질 것(라인·SKU·집/RG 감소량·재고 부족 SKU). 읽기 전용
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { previewBackfill } from '@/lib/erp/orders/deduct';
import { erpError } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ success: true, data: await previewBackfill(getSourcingPool()) });
  } catch (e) {
    return erpError(e);
  }
}
