// POST { mode:'listing', listingId } | { mode:'line', lineId } — 이 화면에서 만든 연결만 해제한다
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { linkErrorResponse, unlinkLine, unlinkListing } from '@/lib/erp/orders/link';
import { badRequest, erpError, withTx } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const at = new Date().toISOString();
  try {
    if (b?.mode === 'listing' && Number.isInteger(b.listingId)) {
      return NextResponse.json({ success: true, data: await withTx((c) => unlinkListing(c, Number(b.listingId), at)) });
    }
    if (b?.mode === 'line' && Number.isInteger(b.lineId)) {
      return NextResponse.json({ success: true, data: await withTx((c) => unlinkLine(c, Number(b.lineId), at)) });
    }
    return badRequest("{ mode:'listing', listingId } 또는 { mode:'line', lineId }");
  } catch (e) {
    return linkErrorResponse(e) ?? erpError(e);
  }
}
