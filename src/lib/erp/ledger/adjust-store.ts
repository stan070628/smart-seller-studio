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

/** 처음 기초재고가 들어간 시각. 이미 있으면 두지 않는다 — 1-C2 판매 소급의 시작점 */
export async function ensureCutover(db: Db, at: string): Promise<void> {
  await db.query(
    `insert into erp.sync_cursors (name, cursor_at) values ('ledger_cutover', $1) on conflict (name) do nothing`,
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

/** 옛 cost_entries(SKU의 legacy_product_cost_ids)의 최근 단가 */
export async function legacyUnitCost(db: Db, skuId: number): Promise<number | null> {
  const { rows } = await db.query(
    `select round(ce.unit_cost)::int as unit_cost from cost_entries ce
       join erp.skus s on ce.product_cost_id = any(s.legacy_product_cost_ids)
      where s.id = $1
      order by ce.received_at desc, ce.created_at desc limit 1`,
    [skuId],
  );
  return rows.length > 0 ? Number(rows[0].unit_cost) : null;
}

export async function applyAdjustment(db: Db, p: AdjustInput): Promise<AdjustResult> {
  validateAdjustInput(p);
  const base = { skuId: p.skuId, location: p.location, requestId: p.requestId };
  const none = { kind: null, qty: 0, idemKey: null, unitCost: null, costSource: null };
  await lockSku(db, p.skuId);

  const dup = await db.query(`select 1 from erp.stock_ledger where ref_type = 'adjust' and ref_id = $1 limit 1`, [p.requestId]);
  if (dup.rows.length > 0) return { ...base, outcome: 'duplicate', ...none };

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
    if (!r.posted) throw new AdjustInputError(`멱등키 ${idemKey}가 이미 있다`);
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
  if (!r.posted) throw new AdjustInputError(`멱등키 ${idemKey}가 이미 있다`);
  if (step.setsCutover) await ensureCutover(db, p.occurredAt);
  return { ...base, outcome: 'posted', kind: step.lotKind, qty: step.diff, idemKey, unitCost: cost.unitCost, costSource: cost.source };
}

/** 여러 건(실사 모드·RG 일괄 반영). 호출자 트랜잭션 하나 — 실패하면 몇 번째인지 AdjustItemError로 던진다 */
export async function applyAdjustments(db: Db, items: AdjustInput[]): Promise<AdjustResult[]> {
  const seen = new Set<string>();
  items.forEach((p, i) => {
    try {
      validateAdjustInput(p);
    } catch (e) {
      throw new AdjustItemError(i, p.skuId, p.location, e);
    }
    const k = `${p.skuId}:${p.location}`;
    if (seen.has(k)) throw new AdjustItemError(i, p.skuId, p.location, new AdjustInputError('같은 SKU·위치가 한 요청에 두 번 있다'));
    seen.add(k);
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
