// GET /api/erp/receipts/[id]/sku-options — 확정 대기 중인 입고 줄마다 재고 SKU 후보와 예상 판매단위 수량.
// 확정 화면이 「자동 / 옵션별 수량 / SKU 고르기」를 정하는 데 쓴다. 확정 때 같은 규칙(receipt.ts)을 서버가 다시 적용한다.
// 대상 줄은 확정 라우트와 같은 selectConfirmable로 고른다 — 확정이 건너뛸 줄(상품·입고 방식 없음 등)에 옵션을 묻지 않는다.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { expectedPacks, loadSkuOptions } from '@/lib/erp/ledger/receipt';
import { erpError } from '@/lib/erp/stock/http';
import { selectConfirmable, type ConfirmCandidate } from '@/lib/receipt/confirm';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  try {
    const pool = getSourcingPool();
    const { rows: drafts } = await pool.query(`SELECT id FROM receipt_drafts WHERE id = $1 AND user_id = $2`, [id, auth.userId]);
    if (drafts.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    const { rows } = await pool.query(
      `SELECT line_no, item_code, product_cost_id, decision, entry_type, quantity, items_per_box, subdivision_unit, is_discount, cost_entry_id
         FROM receipt_draft_lines WHERE draft_id = $1 ORDER BY line_no`,
      [id],
    );
    type Row = ConfirmCandidate & { item_code: string | null; quantity: string | number };
    const target = selectConfirmable(rows as Row[]).confirmable as Row[];
    const opts = await loadSkuOptions(pool, target.map((l) => ({ lineNo: Number(l.line_no), itemCode: l.item_code ?? null, productCostId: l.product_cost_id ?? null })));
    const data = Object.fromEntries(target.map((l) => [
      Number(l.line_no),
      {
        ...opts.get(Number(l.line_no))!,
        expectedQty: expectedPacks({
          entry_type: l.entry_type, quantity: Number(l.quantity),
          items_per_box: l.items_per_box === null ? null : Number(l.items_per_box),
          subdivision_unit: l.subdivision_unit === null ? null : Number(l.subdivision_unit),
        }),
      },
    ]));
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return erpError(e);
  }
}
