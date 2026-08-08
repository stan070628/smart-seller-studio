import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { selectConfirmable, mappingUpsertFrom, type ConfirmCandidate } from '@/lib/receipt/confirm';
import { buildEntryPayload } from '@/lib/receipt/entry-payload';
import { createCostEntry } from '@/lib/cost-management/create-entry';
import type { AttributedLine } from '@/lib/receipt/discount';
import type { TaxType } from '@/lib/receipt/types';

/** DB에서 읽어온 초안 줄. 확정에 필요한 필드만 */
interface DraftLineRecord extends ConfirmCandidate {
  id: string;
  item_code: string | null;
  item_label: string;
  quantity: string | number;
  unit_price: number | null;
  amount: number;
  tax_type: TaxType;
  applies_to_line_id: string | null;
}

/**
 * POST /api/receipts/[id]/confirm — 영수증 줄을 입고로 확정한다.
 *
 * Body: `{ line_nos?: number[] }` — 생략하면 확정 가능한 줄 전부
 *
 * 확정 단위는 **줄**이다. 각 줄은 독립된 트랜잭션에서 성공/실패하고,
 * 성공하면 자기가 만든 `cost_entry_id`를 기록한다. 이미 기록된 줄은
 * 다시 확정되지 않는다 — 같은 요청을 두 번 보내도 입고가 두 번 생기지 않는다.
 *
 * `line_no` 오름차순 직렬로 처리한다. 같은 상품이 여러 줄에 나올 때
 * 소분 이월이 처리 순서에 의존하기 때문이다.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const lineNos: number[] | undefined =
    Array.isArray(body?.line_nos) && body.line_nos.every((n: unknown) => typeof n === 'number')
      ? body.line_nos
      : undefined;

  const pool = getSourcingPool();

  try {
    const { rows: drafts } = await pool.query(
      `SELECT id, purchased_at FROM receipt_drafts WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    );
    if (drafts.length === 0) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    // 입고일은 영수증의 구매일이다. 판독이 못 읽었으면 확정할 수 없다
    const purchasedAt = drafts[0].purchased_at;
    if (!purchasedAt) {
      return NextResponse.json(
        { success: false, error: '구매일을 읽지 못한 영수증은 확정할 수 없습니다.' },
        { status: 422 },
      );
    }
    const receivedAt = new Date(purchasedAt).toISOString().slice(0, 10);

    const { rows } = await pool.query(
      `SELECT id, line_no, item_code, item_label, quantity, unit_price, amount,
              is_discount, applies_to_line_id, tax_type, decision, product_cost_id,
              entry_type, items_per_box, subdivision_unit, cost_entry_id
       FROM receipt_draft_lines WHERE draft_id = $1 ORDER BY line_no`,
      [id],
    );
    const allLines = rows as DraftLineRecord[];

    const { confirmable, skipped } = selectConfirmable(allLines, lineNos);

    // 할인 반영 금액을 계산하려면 전체 줄이 필요하다.
    // DB의 applies_to_line_id(uuid)를 line_no로 되돌린다 — 순수 함수가 그 형태를 쓴다.
    // 사람이 화면에서 귀속을 고쳤다면 그 결과가 여기 반영된다.
    const lineNoById = new Map<string, number>(allLines.map((l) => [l.id, l.line_no]));
    const attributed: AttributedLine[] = allLines.map((l) => ({
      line_no: l.line_no,
      item_code: l.item_code,
      item_label: l.item_label,
      quantity: Number(l.quantity),
      unit_price: l.unit_price,
      amount: l.amount,
      is_discount: l.is_discount,
      tax_type: l.tax_type,
      applies_to_line_no: l.applies_to_line_id ? (lineNoById.get(l.applies_to_line_id) ?? null) : null,
    }));

    const lineById = new Map<number, DraftLineRecord>(allLines.map((l) => [l.line_no, l]));

    const created: { line_no: number; cost_entry_id: string }[] = [];
    const failed: { line_no: number; error: string }[] = [];

    // 줄마다 독립된 트랜잭션. 하나가 실패해도 앞서 확정된 것은 남는다
    for (const line of confirmable) {
      const dbLine = lineById.get(line.line_no);
      if (!dbLine) continue;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const payload =
          line.entry_type === 'subdivision'
            ? buildEntryPayload({
                lines: attributed,
                lineNo: line.line_no,
                receivedAt,
                entryType: 'subdivision',
                itemsPerBox: line.items_per_box as number,
                subdivisionUnit: line.subdivision_unit as number,
              })
            : buildEntryPayload({
                lines: attributed,
                lineNo: line.line_no,
                receivedAt,
                entryType: 'normal',
              });

        const { entry } = await createCostEntry({
          client,
          userId: user.userId,
          productCostId: line.product_cost_id as string,
          receivedAt,
          unitCost: payload.unit_cost,
          quantity: 'quantity' in payload ? payload.quantity : undefined,
          purchaseQuantity: 'purchase_quantity' in payload ? payload.purchase_quantity : null,
          subdivisionUnit: 'subdivision_unit' in payload ? payload.subdivision_unit : null,
          sourceReceiptLineId: dbLine.id,
        });

        const entryId = (entry as { id: string }).id;

        // cost_entry_id IS NULL 조건이 멱등성의 마지막 방어선이다.
        // 두 요청이 겹쳐도 두 번째는 0행을 갱신한다
        const upd = await client.query(
          `UPDATE receipt_draft_lines SET cost_entry_id = $1 WHERE id = $2 AND cost_entry_id IS NULL`,
          [entryId, dbLine.id],
        );
        if (upd.rowCount === 0) {
          throw new Error('이미 확정된 줄입니다.');
        }

        // 매핑 학습 — 다음 장보기에서 같은 품번이 자동으로 채워진다
        const upsert = mappingUpsertFrom({
          ...line,
          item_code: dbLine.item_code,
          item_label: dbLine.item_label,
        });
        if (upsert) {
          await client.query(
            `INSERT INTO costco_item_map
               (user_id, item_code, item_label, product_cost_id, default_decision,
                default_entry_type, items_per_box, subdivision_unit, times_used, last_seen_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,now())
             ON CONFLICT (user_id, item_code) DO UPDATE SET
               item_label = EXCLUDED.item_label,
               product_cost_id = EXCLUDED.product_cost_id,
               default_decision = EXCLUDED.default_decision,
               default_entry_type = EXCLUDED.default_entry_type,
               items_per_box = EXCLUDED.items_per_box,
               subdivision_unit = EXCLUDED.subdivision_unit,
               times_used = costco_item_map.times_used + 1,
               last_seen_at = now(),
               updated_at = now()`,
            [user.userId, upsert.item_code, upsert.item_label, upsert.product_cost_id,
             upsert.default_decision, upsert.default_entry_type,
             upsert.items_per_box, upsert.subdivision_unit],
          );
        }

        await client.query('COMMIT');
        created.push({ line_no: line.line_no, cost_entry_id: entryId });
      } catch (err) {
        await client.query('ROLLBACK');
        failed.push({
          line_no: line.line_no,
          error: err instanceof Error ? err.message : '확정 실패',
        });
      } finally {
        client.release();
      }
    }

    // 확정을 기다리는 줄이 남지 않았으면 초안을 완료로 표시한다
    const { rows: remaining } = await pool.query(
      `SELECT count(*)::int AS n FROM receipt_draft_lines
       WHERE draft_id = $1 AND decision = 'ingest' AND cost_entry_id IS NULL`,
      [id],
    );
    if (remaining[0].n === 0) {
      await pool.query(
        `UPDATE receipt_drafts SET status = 'done', updated_at = now() WHERE id = $1`,
        [id],
      );
    }

    return NextResponse.json({ success: true, data: { created, skipped, failed } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
