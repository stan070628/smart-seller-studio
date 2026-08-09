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
  const remember = body?.remember === true;
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

      if (remember && row.item_code) {
        // 확정 경로와 달리 skip도 기억한다 — "이 품번은 늘 개인용"을 저장할 유일한 경로다.
        // pending은 "매번 물어라"이므로 ask로 옮긴다
        const decisionToRemember = next.decision === 'pending' ? 'ask' : next.decision;
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

      // 줄이 바뀌면 초안의 열림/닫힘도 바뀔 수 있다.
      // 마지막 줄을 「제외」로 정하면 닫히고, 닫힌 초안에 할 일이 생기면 열린다
      await syncDraftStatus(client, id);

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    return NextResponse.json({ success: true, data: next });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '수정 실패';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
