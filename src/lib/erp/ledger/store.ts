// src/lib/erp/ledger/store.ts
// 원장 기록. 호출자가 트랜잭션(BEGIN … COMMIT)을 연다. 음수 재고 검사는 지연 제약이지만
// 기록 함수마다 즉시 돌려(guarded) 초과 차감이 그 호출에서 던지게 한다 — 커밋까지 미루지 않는다.
// 전표마다 SKU 단위 advisory lock을 잡아 겹친 실행이 같은 lot을 두 번 소진하지 못하게 한다.
import type { Location, LotBalance } from './fifo';
import {
  assertIdemKey, planConsume, planLotCreate, planReversal, planTransfer,
  type ConsumeInput, type LedgerRow, type LotCreateInput, type StoredRow, type TransferInput,
} from './plan';

export interface Db {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

export interface PostResult {
  /** false = 같은 멱등키가 이미 있어 아무것도 쓰지 않았다 */
  posted: boolean;
  ids: number[];
}

/** erp.stock_ledger 잠금 네임스페이스(pg_advisory_xact_lock(int, int)의 첫 인자) */
const LOCK_NS = 7101;

const likePrefix = (k: string) => `${k.replace(/[\\%_]/g, '\\$&')}#%`;

export async function lockSku(db: Db, skuId: number): Promise<void> {
  await db.query('select pg_advisory_xact_lock($1::int, $2::int)', [LOCK_NS, skuId]);
}

/** 멱등키 자체 또는 `${키}#…`로 시작하는 전표가 있으면 true */
export async function alreadyPosted(db: Db, idemKey: string): Promise<boolean> {
  const { rows } = await db.query(
    'select 1 from erp.stock_ledger where idem_key = $1 or idem_key like $2 limit 1',
    [idemKey, likePrefix(idemKey)],
  );
  return rows.length > 0;
}

export async function loadLots(db: Db, skuId: number, location: Location): Promise<LotBalance[]> {
  const { rows } = await db.query(
    `select coalesce(l.lot_id, l.id) as lot_id, sum(l.qty)::int as qty, h.unit_cost, extract(epoch from h.occurred_at) * 1000 as lot_at
       from erp.stock_ledger l join erp.stock_ledger h on h.id = coalesce(l.lot_id, l.id)
      where l.sku_id = $1 and l.location = $2
      group by 1, h.unit_cost, h.occurred_at
     having sum(l.qty) <> 0`,
    [skuId, location],
  );
  return rows.map((r) => ({ lotId: Number(r.lot_id), qty: Number(r.qty), unitCost: Number(r.unit_cost), lotAt: Number(r.lot_at) }));
}

export async function insertRows(db: Db, rows: LedgerRow[]): Promise<number[]> {
  const ids: number[] = [];
  for (const r of rows) {
    const { rows: out } = await db.query(
      `insert into erp.stock_ledger (sku_id, location, qty, kind, lot_id, unit_cost, occurred_at, ref_type, ref_id, reverses_id, idem_key, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
      [r.skuId, r.location, r.qty, r.kind, r.lotId, r.unitCost, r.occurredAt, r.refType, r.refId, r.reversesId, r.idemKey, r.note],
    );
    ids.push(Number(out[0].id));
  }
  return ids;
}

async function guarded(db: Db, skuId: number, idemKey: string, build: () => Promise<LedgerRow[]>): Promise<PostResult> {
  await lockSku(db, skuId);
  if (await alreadyPosted(db, idemKey)) return { posted: false, ids: [] };
  const ids = await insertRows(db, await build());
  // 음수 재고 검사(지연 제약 트리거)를 여기서 끌어와 돌린다. 커밋까지 미루면 한 트랜잭션에 여러 주문을 담은 호출자가
  // 어느 주문이 초과 차감했는지 모르고 전부를 잃는다 — 이제는 호출마다 던지므로 savepoint로 주문 단위로 잡을 수 있다.
  // 검사 뒤 지연으로 되돌려, 호출자가 직접 쓴 전표의 검사 시점은 바꾸지 않는다.
  await db.query('set constraints erp.stock_ledger_balance immediate');
  await db.query('set constraints erp.stock_ledger_balance deferred');
  return { posted: true, ids };
}

export function postLotCreate(db: Db, p: LotCreateInput): Promise<PostResult> {
  return guarded(db, p.skuId, p.idemKey, async () => planLotCreate(p));
}

export function postConsume(db: Db, p: ConsumeInput): Promise<PostResult> {
  return guarded(db, p.skuId, p.idemKey, async () => planConsume(p, await loadLots(db, p.skuId, p.location)));
}

export function postTransfer(db: Db, p: TransferInput): Promise<PostResult> {
  return guarded(db, p.skuId, p.idemKey, async () => planTransfer(p, await loadLots(db, p.skuId, p.from)));
}

/** 멱등키 origIdemKey로 기록된 전표 전부(순번 붙은 것 포함)를 `rev:` 키로 상쇄한다. */
export async function reverse(db: Db, origIdemKey: string, p: { occurredAt: string; note?: string }): Promise<PostResult> {
  assertIdemKey(origIdemKey);
  const { rows } = await db.query(
    `select id, sku_id, location, qty, kind, lot_id, unit_cost, occurred_at, ref_type, ref_id, reverses_id, idem_key, note
       from erp.stock_ledger where idem_key = $1 or idem_key like $2 order by id`,
    [origIdemKey, likePrefix(origIdemKey)],
  );
  if (rows.length === 0) throw new Error(`되돌릴 전표가 없다: ${origIdemKey}`);
  const stored: StoredRow[] = rows.map((r) => ({
    id: Number(r.id), skuId: Number(r.sku_id), location: r.location, qty: Number(r.qty), kind: r.kind,
    lotId: r.lot_id === null ? null : Number(r.lot_id), unitCost: r.unit_cost === null ? null : Number(r.unit_cost),
    occurredAt: r.occurred_at instanceof Date ? r.occurred_at.toISOString() : String(r.occurred_at), refType: r.ref_type, refId: r.ref_id,
    reversesId: r.reverses_id === null ? null : Number(r.reverses_id), idemKey: r.idem_key, note: r.note,
  }));
  return guarded(db, stored[0].skuId, `rev:${origIdemKey}`, async () =>
    stored.map((s) => planReversal(s, { occurredAt: p.occurredAt, idemKey: `rev:${s.idemKey}`, note: p.note })),
  );
}
