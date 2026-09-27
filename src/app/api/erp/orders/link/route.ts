// POST { mode:'listing', channel, productId, optionKey, skuId, multiplier, label } | { mode:'line', lineIds, skuId }
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { linkErrorResponse, linkLines, linkListing, toPosInt } from '@/lib/erp/orders/link';
import type { OrderChannel } from '@/lib/erp/orders/types';
import { badRequest, erpError, withTx } from '@/lib/erp/stock/http';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const at = new Date().toISOString();
  try {
    if (b?.mode === 'listing') {
      // (리뷰 A5~A7 #3) Number(true)===1·Number('')===0처럼 조용히 숫자가 되는 값을 걸러낸다
      const skuId = toPosInt(b.skuId);
      const multiplier = b.multiplier === undefined ? 1 : toPosInt(b.multiplier);
      if (Number.isNaN(skuId)) return badRequest(`skuId가 잘못됐다: ${String(b.skuId)}`);
      if (Number.isNaN(multiplier)) return badRequest(`multiplier가 잘못됐다: ${String(b.multiplier)}`);
      const data = await withTx((c) => linkListing(c, {
        channel: b.channel as OrderChannel, productId: String(b.productId ?? ''), optionKey: String(b.optionKey ?? ''),
        skuId, multiplier, label: typeof b.label === 'string' ? b.label.trim() : '',
      }, at));
      return NextResponse.json({ success: true, data });
    }
    if (b?.mode === 'line') {
      const lineIds = Array.isArray(b.lineIds) ? b.lineIds.map(toPosInt) : [];
      const skuId = toPosInt(b.skuId);
      if (lineIds.length === 0 || lineIds.some((x) => Number.isNaN(x))) return badRequest('lineIds가 잘못됐다');
      if (Number.isNaN(skuId)) return badRequest(`skuId가 잘못됐다: ${String(b.skuId)}`);
      const data = await withTx((c) => linkLines(c, { lineIds, skuId }, at));
      return NextResponse.json({ success: true, data });
    }
    return badRequest("mode는 'listing' 또는 'line'이다");
  } catch (e) {
    return linkErrorResponse(e) ?? erpError(e);
  }
}
