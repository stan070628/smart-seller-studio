// src/app/api/erp/sales/karrot/cancel/route.ts
// POST { lineId } — 당근 판매 되돌리기(취소 → 옛 장부 무효 · 차감됐으면 역전표)
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { cancelKarrotSale, karrotErrorResponse } from '@/lib/erp/orders/karrot';
import { badRequest, erpError, withTx } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const b = (await request.json().catch(() => null)) as { lineId?: unknown } | null;
  if (typeof b?.lineId !== 'number' || !Number.isInteger(b.lineId) || b.lineId <= 0) return badRequest('lineId는 양의 정수다');
  const lineId = b.lineId;
  try {
    await withTx((c) => cancelKarrotSale(c, lineId, new Date()));
    return NextResponse.json({ success: true, data: { lineId } });
  } catch (e) {
    return karrotErrorResponse(e) ?? erpError(e);
  }
}
