// src/lib/erp/ledger/receipt.ts
// 코스트코 영수증 확정 → 원장 self 입고(kind='receipt'). 영수증 확정 라우트의 줄 트랜잭션 안에서 부른다.
// 품번 : SKU = 1 : N(erp.purchase_units). 후보: 기억한 품번 연결 → 없으면 옛 상품(product_cost) 연결.
// 수량 단위 = cost_entries.quantity(소분이면 팩 수) · 단가 = 그 입고의 cost_entries.unit_cost(배송비·RG 물류비 제외, 1-B 정의).
import { lockSku, postLotCreate, type Db } from './store';

export interface SkuCandidate {
  skuId: number;
  key: string;
  name: string;
  option: string;
}

export interface LineOptions {
  source: 'learned' | 'product' | 'none';
  candidates: SkuCandidate[];
}

/** 확정 요청의 한 줄 분배. qty null = (고른 SKU가 하나일 때) 입고 수량 전부 */
export interface SplitItem {
  skuId: number;
  qty: number | null;
}

export class ReceiptSplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptSplitError';
  }
}

const strip = (c: SkuCandidate): SkuCandidate => ({ skuId: c.skuId, key: c.key, name: c.name, option: c.option });

export function buildLineOptions(
  itemCode: string | null,
  productCostId: string | null,
  learned: (SkuCandidate & { supplierCode: string })[],
  byProduct: (SkuCandidate & { legacy: string[] })[],
): LineOptions {
  const l = itemCode ? learned.filter((x) => x.supplierCode === itemCode) : [];
  if (l.length > 0) return { source: 'learned', candidates: l.map(strip) };
  const p = productCostId ? byProduct.filter((x) => x.legacy.includes(productCostId)) : [];
  if (p.length > 0) return { source: 'product', candidates: p.map(strip) };
  return { source: 'none', candidates: [] };
}

/** 화면이 보여줄 예상 판매단위 수량. 소분은 이월을 모르므로 추정이다 */
export function expectedPacks(l: { entry_type: string | null; quantity: number; items_per_box: number | null; subdivision_unit: number | null }): { qty: number; approx: boolean } | null {
  if (l.entry_type === 'subdivision') {
    if (!l.items_per_box || !l.subdivision_unit) return null;
    return { qty: Math.floor((l.quantity * l.items_per_box) / l.subdivision_unit), approx: true };
  }
  return Number.isInteger(l.quantity) && l.quantity > 0 ? { qty: l.quantity, approx: false } : null;
}

export function resolveReceiptSplit(packs: number, candidates: number[], requested?: SplitItem[] | null): { skuId: number; qty: number }[] {
  if (!Number.isInteger(packs) || packs <= 0) throw new ReceiptSplitError(`입고 수량 ${packs}이 양의 정수가 아니다 — 원장에 넣을 수 없다`);
  if (requested && requested.length > 0) {
    const seen = new Set<number>();
    for (const r of requested) {
      if (!Number.isInteger(r.skuId) || r.skuId <= 0) throw new ReceiptSplitError(`SKU id가 잘못됐다: ${r.skuId}`);
      if (seen.has(r.skuId)) throw new ReceiptSplitError(`SKU ${r.skuId}가 두 번 있다`);
      seen.add(r.skuId);
    }
    if (requested.length === 1 && requested[0].qty === null) return [{ skuId: requested[0].skuId, qty: packs }];
    for (const r of requested) {
      if (r.qty === null || !Number.isInteger(r.qty) || r.qty < 0) throw new ReceiptSplitError('옵션별 수량은 0 이상 정수다');
    }
    const out = requested.filter((r) => (r.qty as number) > 0).map((r) => ({ skuId: r.skuId, qty: r.qty as number }));
    const sum = out.reduce((s, r) => s + r.qty, 0);
    if (sum !== packs) throw new ReceiptSplitError(`옵션 분배 합 ${sum}개가 입고 수량 ${packs}개와 다르다 — 다시 나눈다`);
    return out.sort((a, b) => a.skuId - b.skuId);
  }
  if (candidates.length === 1) return [{ skuId: candidates[0], qty: packs }];
  if (candidates.length === 0) throw new ReceiptSplitError('이 품목에 연결된 재고 SKU가 없다 — 확정 화면에서 SKU를 고른다');
  throw new ReceiptSplitError(`옵션이 ${candidates.length}개다 — 확정 화면에서 옵션별 수량을 나눈다`);
}

/** 요청 본문 sku_splits: { [line_no]: [{ sku_id, qty }] } */
export function parseSkuSplits(raw: unknown): Record<number, SplitItem[]> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ReceiptSplitError('sku_splits는 { 줄번호: [{ sku_id, qty }] } 형태다');
  const out: Record<number, SplitItem[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const lineNo = Number(k);
    if (!Number.isInteger(lineNo) || !Array.isArray(v)) throw new ReceiptSplitError(`sku_splits[${k}]가 잘못됐다`);
    out[lineNo] = v.map((x) => {
      const o = (x ?? {}) as { sku_id?: unknown; qty?: unknown };
      return { skuId: Number(o.sku_id), qty: o.qty === null || o.qty === undefined ? null : Number(o.qty) };
    });
  }
  return out;
}

export async function loadSkuOptions(
  db: Db,
  lines: { lineNo: number; itemCode: string | null; productCostId: string | null }[],
): Promise<Map<number, LineOptions>> {
  const codes = [...new Set(lines.map((l) => l.itemCode).filter((c): c is string => !!c))];
  const pcs = [...new Set(lines.map((l) => l.productCostId).filter((c): c is string => !!c))];
  const learned = codes.length === 0 ? [] : (await db.query(
    `select p.supplier_code, s.id, s.key, s.name, s.option_label
       from erp.purchase_units p join erp.skus s on s.id = p.sku_id
      where p.supplier = 'costco' and p.supplier_code = any($1::text[]) and s.status = 'active'
      order by s.id`,
    [codes],
  )).rows.map((r) => ({ supplierCode: String(r.supplier_code), skuId: Number(r.id), key: r.key, name: r.name, option: r.option_label ?? '' }));
  const byProduct = pcs.length === 0 ? [] : (await db.query(
    `select s.id, s.key, s.name, s.option_label, s.legacy_product_cost_ids::text[] as legacy
       from erp.skus s
      where s.status = 'active' and s.legacy_product_cost_ids && $1::uuid[]
      order by s.id`,
    [pcs],
  )).rows.map((r) => ({ skuId: Number(r.id), key: r.key, name: r.name, option: r.option_label ?? '', legacy: (r.legacy ?? []) as string[] }));
  return new Map(lines.map((l) => [l.lineNo, buildLineOptions(l.itemCode, l.productCostId, learned, byProduct)]));
}

/**
 * 영수증 한 줄의 원장 입고. 호출자(확정 라우트)의 줄 트랜잭션 안에서 부른다 — 던지면 그 줄의 입고(cost_entries)도 되돌아간다.
 * 멱등키 receipt:<receipt_line_id>:<sku_id>. 품번이 있으면 쓴 SKU를 purchase_units에 기억한다(다음 영수증부터 후보 1순위).
 */
export async function postReceiptLots(
  db: Db,
  p: {
    lineId: string; lineNo: number; itemCode: string | null; itemLabel: string; productCostId: string;
    packs: number; unitCost: number; receivedAt: string; requested?: SplitItem[] | null;
  },
): Promise<{ skuId: number; qty: number }[]> {
  const opts = (await loadSkuOptions(db, [{ lineNo: p.lineNo, itemCode: p.itemCode, productCostId: p.productCostId }])).get(p.lineNo)!;
  const split = resolveReceiptSplit(p.packs, opts.candidates.map((c) => c.skuId), p.requested);
  if (!Number.isInteger(p.unitCost) || p.unitCost < 0) throw new ReceiptSplitError(`입고 단가 ${p.unitCost}가 0 이상 정수가 아니다`);
  const { rows } = await db.query(`select id from erp.skus where id = any($1::bigint[]) and status = 'active'`, [split.map((s) => s.skuId)]);
  const active = new Set(rows.map((r) => Number(r.id)));
  for (const s of split) if (!active.has(s.skuId)) throw new ReceiptSplitError(`SKU ${s.skuId}가 활성 SKU가 아니다`);

  // 1-B 인계(I4): 여러 SKU는 오름차순으로 먼저 잠근다(split은 이미 오름차순)
  for (const s of split) await lockSku(db, s.skuId);
  const occurredAt = `${p.receivedAt}T00:00:00+09:00`;
  for (const s of split) {
    await postLotCreate(db, {
      skuId: s.skuId, location: 'self', qty: s.qty, unitCost: p.unitCost, kind: 'receipt', occurredAt,
      idemKey: `receipt:${p.lineId}:${s.skuId}`, refType: 'receipt_line', refId: p.lineId, note: p.itemLabel.slice(0, 100),
    });
    if (p.itemCode) {
      await db.query(
        `insert into erp.purchase_units (supplier, supplier_code, label, sku_id) values ('costco', $1, $2, $3)
         on conflict (supplier, supplier_code, sku_id) do nothing`,
        [p.itemCode, p.itemLabel, s.skuId],
      );
    }
  }
  return split;
}
