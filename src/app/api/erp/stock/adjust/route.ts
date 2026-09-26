// POST /api/erp/stock/adjust — 재고 조정(집·RG입고중). body { items: [{ skuId, location, mode, value, expected?, reason, note?, unitCost?, requestId }] }
// 여러 건(실사 모드)은 한 트랜잭션 — 하나라도 실패하면 전부 되돌리고 몇 번째인지(index) 알려준다.
// RG 위치는 여기서 고치지 않는다 — 「RG 실재고 대조」(/api/erp/stock/rg-reconcile)로만.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { applyAdjustments } from '@/lib/erp/ledger/adjust-store';
import { AdjustInputError, AdjustItemError, USER_REASONS, validateAdjustInput } from '@/lib/erp/ledger/adjust';
import { activeSkuIds } from '@/lib/erp/stock/queries';
import { badRequest, erpError, parseAdjustItem, withTx } from '@/lib/erp/stock/http';

const MAX_ITEMS = 300;
const EDITABLE: readonly string[] = ['self', 'rg_inbound'];
const REASONS: readonly string[] = USER_REASONS;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null);
  const raw: unknown = body?.items;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ITEMS) return badRequest(`items는 1~${MAX_ITEMS}건 배열이다`);
  const at = new Date().toISOString();
  try {
    const inputs = raw.map((b, i) => {
      const p = parseAdjustItem((b ?? {}) as Record<string, unknown>, at);
      try {
        if (!EDITABLE.includes(p.location)) throw new AdjustInputError('RG 위치는 「RG 실재고 대조」로만 고친다');
        if (!REASONS.includes(p.reason)) throw new AdjustInputError(`사유가 잘못됐다: ${String(p.reason)}`);
        validateAdjustInput(p);
      } catch (e) {
        throw new AdjustItemError(i, p.skuId, p.location, e);
      }
      return p;
    });
    const active = await activeSkuIds(getSourcingPool());
    inputs.forEach((p, i) => {
      if (!active.has(p.skuId)) throw new AdjustItemError(i, p.skuId, p.location, new AdjustInputError(`활성 SKU가 아니다: ${p.skuId}`));
    });
    const results = await withTx((c) => applyAdjustments(c, inputs));
    return NextResponse.json({ success: true, data: results });
  } catch (e) {
    return erpError(e);
  }
}
