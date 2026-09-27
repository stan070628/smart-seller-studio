// POST { mode:'listing', listingId } | { mode:'line', lineId } — 이 화면에서 만든 연결만 해제한다
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { linkErrorResponse, toPosInt, unlinkLine, unlinkListing } from '@/lib/erp/orders/link';
import { badRequest, erpError, withTx } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const at = new Date().toISOString();
  try {
    if (b?.mode === 'listing') {
      // (리뷰 A5~A7 #3) 숫자 문자열도 받는다("1801") · true 같은 값은 NaN으로 막는다
      const listingId = toPosInt(b.listingId);
      if (Number.isNaN(listingId)) return badRequest(`listingId가 잘못됐다: ${String(b.listingId)}`);
      return NextResponse.json({ success: true, data: await withTx((c) => unlinkListing(c, listingId, at)) });
    }
    if (b?.mode === 'line') {
      const lineId = toPosInt(b.lineId);
      if (Number.isNaN(lineId)) return badRequest(`lineId가 잘못됐다: ${String(b.lineId)}`);
      return NextResponse.json({ success: true, data: await withTx((c) => unlinkLine(c, lineId, at)) });
    }
    return badRequest("{ mode:'listing', listingId } 또는 { mode:'line', lineId }");
  } catch (e) {
    return linkErrorResponse(e) ?? erpError(e);
  }
}
