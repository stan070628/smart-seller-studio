// GET /api/erp/stock/[skuId]/history — SKU 입출 이력(최근 300건) · 되돌릴 수 있는 묶음 표시
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { skuHistory } from '@/lib/erp/stock/queries';
import { badRequest, erpError } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ skuId: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const { skuId } = await params;
  const id = Number(skuId);
  if (!Number.isInteger(id) || id <= 0) return badRequest(`SKU id가 잘못됐다: ${skuId}`);
  try {
    return NextResponse.json({ success: true, data: await skuHistory(getSourcingPool(), id) });
  } catch (e) {
    return erpError(e);
  }
}
