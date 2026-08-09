import type { PoolClient, Pool } from 'pg';

/**
 * 초안의 열림/닫힘 상태를 현재 줄 상태로부터 다시 계산한다.
 *
 * **판정을 한 곳에 둔다.** 확정 경로와 줄 수정 경로가 각자 판정하면
 * 한쪽에서만 닫히거나 열리지 않는다 — 2026-08-09 실사용에서 실제로 그랬다.
 * 확정 라우트만 닫는 규칙을 갖고 있어서, 마지막 줄을 「제외」로 정해도
 * 초안이 영원히 열린 채 남았고, 반대로 미정 줄이 남았는데도 닫혔다.
 *
 * **열린 줄**이란 사람이 아직 손대야 할 줄이다:
 * 아직 정하지 않았거나(`pending`), 입고하기로 했는데 확정되지 않은 줄.
 * 할인 줄과 제외한 줄은 손댈 대상이 아니므로 세지 않는다.
 *
 * `discarded`는 건드리지 않는다 — 사람이 명시적으로 폐기한 것이다.
 */
export async function syncDraftStatus(
  db: PoolClient | Pool,
  draftId: string,
): Promise<'draft' | 'done' | 'unchanged'> {
  const { rows } = await db.query(
    `SELECT count(*)::int AS open
     FROM receipt_draft_lines
     WHERE draft_id = $1
       AND is_discount = false
       AND (decision = 'pending' OR (decision = 'ingest' AND cost_entry_id IS NULL))`,
    [draftId],
  );

  const next = rows[0].open === 0 ? 'done' : 'draft';

  const { rowCount } = await db.query(
    `UPDATE receipt_drafts SET status = $2, updated_at = now()
     WHERE id = $1 AND status <> $2 AND status <> 'discarded'`,
    [draftId, next],
  );

  return rowCount && rowCount > 0 ? next : 'unchanged';
}
