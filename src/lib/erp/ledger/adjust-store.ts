// src/lib/erp/ledger/adjust-store.ts
// 조정 전표 기록. 호출자가 트랜잭션을 연다 — 여러 건(실사 모드)은 한 트랜잭션이라 하나라도 실패하면 전부 되돌린다.
// 순서: 입력 검사 → SKU 잠금 → 같은 요청 확인 → 그 위치 재고 → 규칙(adjust.ts) → FIFO 차감 또는 새 lot → (기초면) 커서.
import type { Location } from './fifo';
import { lockSku, postConsume, postLotCreate, type Db } from './store';
import {
  AdjustInputError, AdjustItemError, CostRequiredError, adjustIdemKey, openingIdemKey, pickUnitCost, planAdjustment, validateAdjustInput,
  type AdjustCostSource, type AdjustInput,
} from './adjust';

export interface AdjustResult {
  skuId: number;
  location: Location;
  requestId: string;
  /** posted = 기록 · duplicate = 같은 요청이 이미 기록됨 · noop = 차이 0 */
  outcome: 'posted' | 'duplicate' | 'noop';
  kind: 'opening' | 'adjust' | null;
  /** 원장 증감(+ 늘림 / − 줄임) */
  qty: number;
  idemKey: string | null;
  unitCost: number | null;
  costSource: AdjustCostSource | null;
}

/** 기초재고 기준 시각 = 가장 이른 기초 시각. 이미 있으면 더 이른 쪽을 남긴다 — 1-C2 판매 소급의 시작점.
 *  (화면 조정·실사표 불러오기·opening-apply 스크립트 어느 쪽이 먼저 들어가도 같은 값이 된다) */
export async function ensureCutover(db: Db, at: string): Promise<void> {
  await db.query(
    `insert into erp.sync_cursors (name, cursor_at) values ('ledger_cutover', $1)
     on conflict (name) do update set cursor_at = least(erp.sync_cursors.cursor_at, excluded.cursor_at), updated_at = now()`,
    [at],
  );
}

/** 그 SKU의 가장 최근 lot 단가(위치 무관, 되돌린 lot 제외) */
export async function latestLotCost(db: Db, skuId: number): Promise<number | null> {
  const { rows } = await db.query(
    `select l.unit_cost from erp.stock_ledger l
      where l.sku_id = $1 and l.lot_id is null
        and not exists (select 1 from erp.stock_ledger r where r.reverses_id = l.id)
      order by l.occurred_at desc, l.id desc limit 1`,
    [skuId],
  );
  return rows.length > 0 ? Number(rows[0].unit_cost) : null;
}

/** 옛 cost_entries(SKU의 legacy_product_cost_ids)의 최근 단가.
 *  기준 단위(base_unit_label)가 정해진 SKU는 null — 옛 입고는 다른 단위(묶음·박스)일 수 있어 사람이 단가를 적는다 */
export async function legacyUnitCost(db: Db, skuId: number): Promise<number | null> {
  const { rows } = await db.query(
    `select s.base_unit_label,
            (select round(ce.unit_cost)::int from cost_entries ce
              where ce.product_cost_id = any(s.legacy_product_cost_ids)
              order by ce.received_at desc nulls last, ce.created_at desc nulls last limit 1) as unit_cost
       from erp.skus s where s.id = $1`,
    [skuId],
  );
  const r = rows[0];
  if (!r || r.base_unit_label !== null || r.unit_cost === null || r.unit_cost === undefined) return null;
  return Number(r.unit_cost);
}

export async function applyAdjustment(db: Db, p: AdjustInput): Promise<AdjustResult> {
  validateAdjustInput(p);
  const base = { skuId: p.skuId, location: p.location, requestId: p.requestId };
  const none = { kind: null, qty: 0, idemKey: null, unitCost: null, costSource: null };
  await lockSku(db, p.skuId);

  // 같은 요청 id의 재전송만 duplicate다. 다른 SKU·위치에 쓰인 id면 조용히 삼키지 않고 거부한다
  const dup = await db.query(`select sku_id, location from erp.stock_ledger where ref_type = 'adjust' and ref_id = $1 limit 1`, [p.requestId]);
  if (dup.rows.length > 0) {
    const d = dup.rows[0];
    if (Number(d.sku_id) === p.skuId && d.location === p.location) return { ...base, outcome: 'duplicate', ...none };
    throw new AdjustInputError('요청 id가 다른 조정에 이미 쓰였다');
  }

  const { rows } = await db.query(
    `select coalesce(sum(qty), 0)::int as qty, count(*)::int as n from erp.stock_ledger where sku_id = $1 and location = $2`,
    [p.skuId, p.location],
  );
  const step = planAdjustment({
    mode: p.mode, value: p.value, expected: p.expected, onHand: Number(rows[0].qty), locationEmpty: Number(rows[0].n) === 0,
  });
  if (step.diff === 0) return { ...base, outcome: 'noop', ...none };

  const ref = { refType: 'adjust', refId: p.requestId, note: p.note };
  if (step.diff < 0) {
    const idemKey = adjustIdemKey(p.requestId);
    const r = await postConsume(db, {
      skuId: p.skuId, location: p.location, qty: -step.diff, kind: 'adjust', reason: p.reason, occurredAt: p.occurredAt, idemKey, ...ref,
    });
    // 잠금 안에서 요청 id를 확인했으니 여기 오면 불변식 위반이다(입력 오류가 아니라 500)
    if (!r.posted) throw new Error(`멱등키 ${idemKey}가 이미 있다`);
    return { ...base, outcome: 'posted', kind: 'adjust', qty: step.diff, idemKey, unitCost: null, costSource: null };
  }

  // 단가는 필요한 만큼만 조회한다: 입력 → 최근 lot → 옛 입고
  let cost = pickUnitCost(p.unitCost, null, null);
  if (!cost) cost = pickUnitCost(undefined, await latestLotCost(db, p.skuId), null);
  if (!cost) cost = pickUnitCost(undefined, null, await legacyUnitCost(db, p.skuId));
  if (!cost) throw new CostRequiredError(p.skuId);

  const opening = step.lotKind === 'opening';
  const idemKey = opening ? openingIdemKey(p.skuId, p.location) : adjustIdemKey(p.requestId);
  const r = await postLotCreate(db, {
    skuId: p.skuId, location: p.location, qty: step.diff, unitCost: cost.unitCost, kind: step.lotKind,
    reason: opening ? 'opening' : p.reason, occurredAt: p.occurredAt, idemKey, ...ref,
  });
  // 기초 키는 빈 위치에서만 쓰고 조정 키는 요청 id가 새것일 때만 쓰므로 여기 오면 불변식 위반이다(500)
  if (!r.posted) throw new Error(`멱등키 ${idemKey}가 이미 있다`);
  if (step.setsCutover) await ensureCutover(db, p.occurredAt);
  return { ...base, outcome: 'posted', kind: step.lotKind, qty: step.diff, idemKey, unitCost: cost.unitCost, costSource: cost.source };
}

/** 여러 건(실사 모드·RG 일괄 반영). 호출자 트랜잭션 하나 — 실패하면 몇 번째인지 AdjustItemError로 던진다 */
export async function applyAdjustments(db: Db, items: AdjustInput[]): Promise<AdjustResult[]> {
  const seen = new Set<string>();
  const ids = new Set<string>();
  items.forEach((p, i) => {
    try {
      validateAdjustInput(p);
    } catch (e) {
      throw new AdjustItemError(i, p.skuId, p.location, e);
    }
    const k = `${p.skuId}:${p.location}`;
    if (seen.has(k)) throw new AdjustItemError(i, p.skuId, p.location, new AdjustInputError('같은 SKU·위치가 한 요청에 두 번 있다'));
    seen.add(k);
    // requestId는 validateAdjustInput이 소문자로 맞췄다
    if (ids.has(p.requestId)) throw new AdjustItemError(i, p.skuId, p.location, new AdjustInputError('같은 요청 id가 한 요청에 두 번 있다'));
    ids.add(p.requestId);
  });
  // 1-B 인계(I4): 여러 SKU를 한 트랜잭션에 기록할 때는 sku_id 오름차순으로 먼저 잠가 교착을 피한다
  for (const id of [...new Set(items.map((p) => p.skuId))].sort((a, b) => a - b)) await lockSku(db, id);
  const out: AdjustResult[] = [];
  for (let i = 0; i < items.length; i++) {
    try {
      out.push(await applyAdjustment(db, items[i]));
    } catch (e) {
      throw new AdjustItemError(i, items[i].skuId, items[i].location, e);
    }
  }
  return out;
}
