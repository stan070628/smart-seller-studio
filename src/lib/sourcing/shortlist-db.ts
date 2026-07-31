/**
 * shortlist-db.ts
 * sourcing_shortlist 테이블 CRUD. SQL만 담당하고 검증 로직은 모른다.
 */

import { getSourcingPool } from '@/lib/sourcing/db';
import type { ShortlistItem, LogisticsSize, Verdict, DeliType } from '@/types/shortlist';

interface Row {
  item_no: number;
  title: string;
  memo: string | null;
  added_at: Date;
  dome_status: string | null;
  dome_price: number | null;
  dome_inventory: number | null;
  dome_moq: number | null;
  deli_is_free: boolean | null;
  deli_type: string | null;
  deli_unit_qty: number | null;
  deli_fee: number | null;
  coupang_p25: number | null;
  coupang_sample_n: number | null;
  order_qty: number;
  unit_deli_fee: number | null;
  effective_cost: number | null;
  logistics_size: string;
  break_even_price: number | null;
  margin: number | null;
  margin_rate: string | null;
  verdict: string | null;
  verified_at: Date | null;
  is_archived: boolean;
}

/**
 * DB 행을 도메인 타입으로 변환한다.
 *
 * verdict·logistics_size·deli_type의 캐스트는 094_sourcing_shortlist.sql의
 * CHECK 제약이 값 범위를 보장한다는 전제에 기댄다. 제약을 바꾸면 여기도 함께 봐야 한다.
 */
function toItem(r: Row): ShortlistItem {
  return {
    itemNo: r.item_no,
    title: r.title,
    memo: r.memo,
    addedAt: r.added_at.toISOString(),
    domeStatus: r.dome_status,
    domePrice: r.dome_price,
    domeInventory: r.dome_inventory,
    domeMoq: r.dome_moq,
    deliIsFree: r.deli_is_free,
    deliType: r.deli_type as DeliType | null,
    deliUnitQty: r.deli_unit_qty,
    deliFee: r.deli_fee,
    coupangP25: r.coupang_p25,
    coupangSampleN: r.coupang_sample_n,
    orderQty: r.order_qty,
    unitDeliFee: r.unit_deli_fee,
    effectiveCost: r.effective_cost,
    logisticsSize: r.logistics_size as LogisticsSize,
    breakEvenPrice: r.break_even_price,
    margin: r.margin,
    // numeric(5,1)은 pg가 문자열로 반환하므로 number로 변환한다
    marginRate: r.margin_rate === null ? null : Number(r.margin_rate),
    verdict: r.verdict as Verdict | null,
    verifiedAt: r.verified_at ? r.verified_at.toISOString() : null,
    isArchived: r.is_archived,
  };
}

const SELECT_COLS = `
  item_no, title, memo, added_at,
  dome_status, dome_price, dome_inventory, dome_moq,
  deli_is_free, deli_type, deli_unit_qty, deli_fee,
  coupang_p25, coupang_sample_n,
  order_qty, unit_deli_fee, effective_cost, logistics_size,
  break_even_price, margin, margin_rate, verdict, verified_at, is_archived
`;

/** 쇼트리스트 전체 조회. 기본은 보관 처리되지 않은 항목만 */
export async function listShortlist(includeArchived = false): Promise<ShortlistItem[]> {
  const pool = getSourcingPool();
  const { rows } = await pool.query<Row>(
    `SELECT ${SELECT_COLS}
       FROM sourcing_shortlist
      ${includeArchived ? '' : 'WHERE is_archived = false'}
      ORDER BY margin_rate DESC NULLS LAST, added_at DESC`,
  );
  return rows.map(toItem);
}

/** 단건 조회 */
export async function getShortlistItem(itemNo: number): Promise<ShortlistItem | null> {
  const pool = getSourcingPool();
  const { rows } = await pool.query<Row>(
    `SELECT ${SELECT_COLS} FROM sourcing_shortlist WHERE item_no = $1`,
    [itemNo],
  );
  return rows[0] ? toItem(rows[0]) : null;
}

/**
 * 후보를 추가한다.
 * @returns 실제로 삽입됐으면 true, 이미 있어서 건너뛰었으면 false
 */
export async function insertShortlist(
  itemNo: number,
  title: string,
  orderQty: number,
): Promise<boolean> {
  const pool = getSourcingPool();
  const result = await pool.query(
    `INSERT INTO sourcing_shortlist (item_no, title, order_qty)
     VALUES ($1, $2, $3)
     ON CONFLICT (item_no) DO NOTHING`,
    [itemNo, title, orderQty],
  );
  return result.rowCount === 1;
}

/** 쇼트리스트에서 완전히 제거한다 (보관과 다르게 행 자체를 삭제) */
export async function deleteShortlist(itemNo: number): Promise<void> {
  const pool = getSourcingPool();
  await pool.query('DELETE FROM sourcing_shortlist WHERE item_no = $1', [itemNo]);
}

export interface ShortlistPatch {
  memo?: string;
  logisticsSize?: LogisticsSize;
  orderQty?: number;
  isArchived?: boolean;
}

/** 사용자가 직접 편집 가능한 필드만 부분 갱신한다 */
export async function patchShortlist(itemNo: number, patch: ShortlistPatch): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;

  if (patch.memo !== undefined) { sets.push(`memo = $${i++}`); vals.push(patch.memo); }
  if (patch.logisticsSize !== undefined) { sets.push(`logistics_size = $${i++}`); vals.push(patch.logisticsSize); }
  if (patch.orderQty !== undefined) { sets.push(`order_qty = $${i++}`); vals.push(patch.orderQty); }
  if (patch.isArchived !== undefined) { sets.push(`is_archived = $${i++}`); vals.push(patch.isArchived); }
  if (sets.length === 0) return;

  vals.push(itemNo);
  const pool = getSourcingPool();
  await pool.query(
    `UPDATE sourcing_shortlist SET ${sets.join(', ')} WHERE item_no = $${i}`,
    vals,
  );
}

/**
 * 모든 행의 사입 수량을 일괄 변경한다.
 * WHERE 절이 없는 것은 의도다 — 사입 수량은 리스트 전체에 적용되는 값이라
 * 아카이브된 행까지 함께 갱신한다.
 * @returns 갱신된 행 수
 */
export async function setOrderQtyAll(orderQty: number): Promise<number> {
  const pool = getSourcingPool();
  const result = await pool.query('UPDATE sourcing_shortlist SET order_qty = $1', [orderQty]);
  return result.rowCount ?? 0;
}

/** 검증 결과 저장용 필드 */
export interface VerifyResult {
  domeStatus: string | null;
  domePrice: number | null;
  domeInventory: number | null;
  domeMoq: number | null;
  deliIsFree: boolean | null;
  deliType: DeliType | null;
  deliUnitQty: number | null;
  deliFee: number | null;
  coupangP25: number | null;
  coupangSampleN: number | null;
  unitDeliFee: number | null;
  effectiveCost: number | null;
  breakEvenPrice: number | null;
  margin: number | null;
  marginRate: number | null;
  verdict: Verdict;
}

/** 재검증 결과를 저장하고 verified_at을 now()로 갱신한다 */
export async function saveVerifyResult(itemNo: number, r: VerifyResult): Promise<void> {
  const pool = getSourcingPool();
  await pool.query(
    `UPDATE sourcing_shortlist SET
       dome_status = $1, dome_price = $2, dome_inventory = $3, dome_moq = $4,
       deli_is_free = $5, deli_type = $6, deli_unit_qty = $7, deli_fee = $8,
       coupang_p25 = $9, coupang_sample_n = $10,
       unit_deli_fee = $11, effective_cost = $12,
       break_even_price = $13, margin = $14, margin_rate = $15,
       verdict = $16, verified_at = now()
     WHERE item_no = $17`,
    [
      r.domeStatus, r.domePrice, r.domeInventory, r.domeMoq,
      r.deliIsFree, r.deliType, r.deliUnitQty, r.deliFee,
      r.coupangP25, r.coupangSampleN,
      r.unitDeliFee, r.effectiveCost,
      r.breakEvenPrice, r.margin, r.marginRate,
      r.verdict, itemNo,
    ],
  );
}

/** 검증 대상 목록 — cron이 오래된 것부터(verified_at ASC NULLS FIRST) 처리한다. */
export async function listForVerify(
  limit: number,
): Promise<{
  itemNo: number;
  title: string;
  orderQty: number;
  logisticsSize: LogisticsSize;
  coupangP25: number | null;
}[]> {
  const pool = getSourcingPool();
  const { rows } = await pool.query<{
    item_no: number;
    title: string;
    order_qty: number;
    logistics_size: string;
    coupang_p25: number | null;
  }>(
    `SELECT item_no, title, order_qty, logistics_size, coupang_p25
       FROM sourcing_shortlist
      WHERE is_archived = false
      ORDER BY verified_at ASC NULLS FIRST
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    itemNo: r.item_no,
    title: r.title,
    orderQty: r.order_qty,
    logisticsSize: r.logistics_size as LogisticsSize,
    coupangP25: r.coupang_p25,
  }));
}

export interface ShortlistCandidateInput {
  itemNo: number;
  title: string;
  domePrice: number;
  unitDeliFee: number;
  coupangP25: number | null;
  coupangSampleN: number;
  effectiveCost: number;
  breakEvenPrice: number;
  margin: number | null;
  marginRate: number | null;
  verdict: string;
}

/**
 * 발굴 파이프라인이 판정한 후보를 쇼트리스트에 넣는다.
 *
 * 이미 있는 항목이면 검증 결과만 갱신한다. **사용자 메모와 아카이브 상태는 덮지 않는다** —
 * 자동 적재가 사람의 판단을 지우면 안 되기 때문이다.
 *
 * marginRate 단위 주의: DB의 margin_rate는 numeric(5,1) — **백분율 1자리**다(예: 32.6).
 * evaluateCandidate()는 비율(0.326)을 돌려주므로 호출부에서 변환해 넘긴다.
 * 비율을 그대로 넣으면 0.3으로 반올림되어 값이 소실된다.
 *
 * verified_at을 NULL로 두는 이유: 파이프라인은 사입 10개·극소형을 **가정하고** 계산한다.
 * 반면 검증 크론은 행에 실제로 저장된 order_qty·logistics_size로 계산한다
 * (shortlist-verify.ts:238-240). 사용자가 30개·중형으로 바꿔 둔 항목이 발굴에 다시 걸리면
 * 파생값만 10개·극소형 기준으로 덮여 행 내부가 모순된다.
 *
 * NULL로 두면 두 가지가 동시에 해결된다.
 *   - listForVerify가 `verified_at ASC NULLS FIRST`로 뽑으므로 **검증 큐 맨 앞**에 서서
 *     행의 실제 설정으로 곧 재계산된다.
 *   - 그 전까지 ShortlistTab이 "검증 이력 없음"으로 표시한다(ShortlistTab.tsx:48).
 *     아직 검증되지 않은 가정값이므로 그 표시가 사실이다.
 * NOW()로 찍으면 가정값이 검증필로 위장되고, 큐 맨 뒤로 밀려 한 바퀴 도는 동안 남는다.
 */
export async function upsertShortlistCandidate(
  pool: { query: (sql: string, params: unknown[]) => Promise<unknown> },
  c: ShortlistCandidateInput,
): Promise<void> {
  await pool.query(
    `INSERT INTO sourcing_shortlist (
       item_no, title, dome_price, unit_deli_fee,
       coupang_p25, coupang_sample_n,
       effective_cost, break_even_price, margin, margin_rate,
       verdict, verified_at, added_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NULL, NOW())
     ON CONFLICT (item_no) DO UPDATE SET
       title             = EXCLUDED.title,
       dome_price        = EXCLUDED.dome_price,
       unit_deli_fee     = EXCLUDED.unit_deli_fee,
       coupang_p25       = EXCLUDED.coupang_p25,
       coupang_sample_n  = EXCLUDED.coupang_sample_n,
       effective_cost    = EXCLUDED.effective_cost,
       break_even_price  = EXCLUDED.break_even_price,
       margin            = EXCLUDED.margin,
       margin_rate       = EXCLUDED.margin_rate,
       verdict           = EXCLUDED.verdict,
       verified_at       = NULL`,
    [
      c.itemNo, c.title, c.domePrice, c.unitDeliFee,
      c.coupangP25, c.coupangSampleN,
      c.effectiveCost, c.breakEvenPrice, c.margin, c.marginRate,
      c.verdict,
    ],
  );
}
