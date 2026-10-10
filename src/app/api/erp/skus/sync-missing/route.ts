// src/app/api/erp/skus/sync-missing/route.ts
// POST /api/erp/skus/sync-missing — 원가관리에 쿠팡 상품번호가 있는데 리스팅·SKU가 없는 상품을 SKU로 만든다(최신순, 한 번에 20개).
// 재고현황 「SKU 다시 맞추기」 버튼. 상품별 실패는 결과에 담기고(200), 후보 조회 자체가 실패하면 500.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { syncMissingForApp } from '@/lib/erp/sku/sync-app';
import { erpError } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  try {
    return NextResponse.json({ success: true, data: await syncMissingForApp() });
  } catch (e) {
    return erpError(e);
  }
}
