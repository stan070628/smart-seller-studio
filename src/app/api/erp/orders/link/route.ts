// POST { mode:'listing', channel, productId, optionKey, skuId, multiplier, label } | { mode:'line', lineIds, skuId }
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { linkErrorResponse, linkLines, linkListing } from '@/lib/erp/orders/link';
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
      const data = await withTx((c) => linkListing(c, {
        channel: b.channel as OrderChannel, productId: String(b.productId ?? ''), optionKey: String(b.optionKey ?? ''),
        skuId: Number(b.skuId), multiplier: Number(b.multiplier ?? 1), label: String(b.label ?? ''),
      }, at));
      return NextResponse.json({ success: true, data });
    }
    if (b?.mode === 'line') {
      const lineIds = Array.isArray(b.lineIds) ? b.lineIds.map(Number) : [];
      const data = await withTx((c) => linkLines(c, { lineIds, skuId: Number(b.skuId) }, at));
      return NextResponse.json({ success: true, data });
    }
    return badRequest("mode는 'listing' 또는 'line'이다");
  } catch (e) {
    return linkErrorResponse(e) ?? erpError(e);
  }
}
