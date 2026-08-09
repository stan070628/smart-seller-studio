import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { validateLinePatch, type LineState, type LinePatch } from '@/lib/receipt/line-patch';
import { syncDraftStatus } from '@/lib/receipt/draft-status';

/** 패치로 받아들이는 필드. 이 밖의 키는 무시한다 */
const PATCHABLE = [
  'decision',
  'product_cost_id',
  'entry_type',
  'items_per_box',
  'subdivision_unit',
] as const;

/**
 * PATCH /api/receipts/[id]/lines/[lineNo] — 줄 하나 수정
 *
 * Body: `{ decision?, product_cost_id?, entry_type?, items_per_box?, subdivision_unit? }`
 * 보내지 않은 필드는 그대로 두고, null은 지운다는 뜻이다.
 *
 * `remember: true`를 함께 보내면 이 결정을 품번에 기억시킨다.
 * 확정 경로(3편)는 확정할 때만 기억시키므로, **"이 품번은 개인용이라 항상 제외"**
 * 같은 결정은 이 경로로만 저장할 수 있다.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; lineNo: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id, lineNo } = await params;
  const n = Number(lineNo);
  if (!Number.isInteger(n)) {
    return NextResponse.json({ success: false, error: 'line_no가 정수가 아닙니다.' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  /**
   * `true`  — 이 줄의 결정을 품번에 기억시킨다
   * `false` — 기억을 지운다(= `ask`, 매번 물어봄)
   * 생략    — 상품을 골랐다면 자동으로 기억한다
   */
  const remember: boolean | undefined =
    typeof body?.remember === 'boolean' ? body.remember : undefined;
  const patch: LinePatch = {};
  for (const k of PATCHABLE) {
    if (k in (body ?? {})) (patch as Record<string, unknown>)[k] = body[k];
  }

  try {
    const pool = getSourcingPool();

    // 소유권은 초안을 통해 확인한다 — 줄에는 user_id가 없다
    const { rows: cur } = await pool.query(
      `SELECT l.id, l.item_code, l.item_label, l.is_discount, l.decision, l.product_cost_id,
              l.entry_type, l.items_per_box, l.subdivision_unit, l.cost_entry_id
       FROM receipt_draft_lines l
       JOIN receipt_drafts d ON d.id = l.draft_id
       WHERE l.draft_id = $1 AND l.line_no = $2 AND d.user_id = $3`,
      [id, n, user.userId],
    );
    if (cur.length === 0) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    const row = cur[0];

    const { next, errors } = validateLinePatch(patch, row as LineState);
    if (errors.length > 0) {
      return NextResponse.json({ success: false, error: errors.join(' '), errors }, { status: 422 });
    }

    /** 같은 품번이라 함께 채워진 줄 번호. 화면이 무엇이 바뀌었는지 알려줄 수 있다 */
    let filled: number[] = [];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE receipt_draft_lines SET
           decision = $2, product_cost_id = $3, entry_type = $4,
           items_per_box = $5, subdivision_unit = $6
         WHERE id = $1`,
        [row.id, next.decision, next.product_cost_id, next.entry_type,
         next.items_per_box, next.subdivision_unit],
      );

      // 🔵 상품을 고르는 순간 기억한다. 확정까지 기다리지 않는다 —
      // 다음 장보기에서 같은 품번이 나오면 상품 선택을 생략하는 것이 목적이고,
      // 확정 여부는 그 목적과 무관하다.
      //
      // `remember: true`는 상품 없이 결정만 기억시킬 때 쓴다("이 품번은 늘 개인용").
      // `remember: false`는 그 기억을 지운다 — 화면에서 되돌릴 경로가 없으면
      // 잘못 누른 「항상 제외」가 영구히 남는다.
      const shouldTouchMemory =
        (remember === true || remember === false || next.product_cost_id != null) &&
        !!row.item_code;

      if (shouldTouchMemory) {
        // 확정 경로와 달리 skip도 기억한다 — "이 품번은 늘 개인용"을 저장할 유일한 경로다.
        // pending과 「기억 지움」은 "매번 물어라"이므로 ask로 옮긴다
        const decisionToRemember =
          remember === false ? 'ask'
          : next.decision === 'pending' ? 'ask'
          : next.decision;
        await client.query(
          `INSERT INTO costco_item_map
             (user_id, item_code, item_label, product_cost_id, default_decision,
              default_entry_type, items_per_box, subdivision_unit, times_used, last_seen_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,now())
           ON CONFLICT (user_id, item_code) DO UPDATE SET
             item_label = EXCLUDED.item_label,
             product_cost_id = EXCLUDED.product_cost_id,
             default_decision = EXCLUDED.default_decision,
             default_entry_type = EXCLUDED.default_entry_type,
             items_per_box = EXCLUDED.items_per_box,
             subdivision_unit = EXCLUDED.subdivision_unit,
             last_seen_at = now(),
             updated_at = now()`,
          [user.userId, row.item_code, row.item_label, next.product_cost_id,
           decisionToRemember, next.entry_type, next.items_per_box, next.subdivision_unit],
        );
      }

      // 같은 품번의 다른 줄에도 상품을 채운다.
      //
      // 코스트코는 같은 상품을 수량으로 묶지 않고 여러 줄로 인쇄할 때가 있다
      // (콜맨웨건 1개 × 2줄). 그때마다 상품을 다시 고르게 하는 것은 군더더기다.
      //
      // **아직 상품이 없는 줄만** 채운다 — 사람이 다른 상품을 지정했다면
      // 그 선택을 덮어쓰지 않는다. `decision`도 건드리지 않는다:
      // 같은 품번이라도 어떤 줄은 팔고 어떤 줄은 개인용일 수 있다.
      let filledLineNos: number[] = [];
      if (next.product_cost_id && row.item_code) {
        const { rows: filled } = await client.query(
          `UPDATE receipt_draft_lines SET
             product_cost_id = $3, entry_type = $4, items_per_box = $5, subdivision_unit = $6
           WHERE draft_id = $1
             AND item_code = $2
             AND id <> $7
             AND is_discount = false
             AND cost_entry_id IS NULL
             AND product_cost_id IS NULL
           RETURNING line_no`,
          [id, row.item_code, next.product_cost_id, next.entry_type,
           next.items_per_box, next.subdivision_unit, row.id],
        );
        filledLineNos = filled.map((r) => r.line_no as number);
      }

      // 줄이 바뀌면 초안의 열림/닫힘도 바뀔 수 있다.
      // 마지막 줄을 「제외」로 정하면 닫히고, 닫힌 초안에 할 일이 생기면 열린다
      await syncDraftStatus(client, id);

      filled = filledLineNos;

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    return NextResponse.json({ success: true, data: next, filled_line_nos: filled });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '수정 실패';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
