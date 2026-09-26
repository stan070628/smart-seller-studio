// src/lib/erp/ledger/receipt.ts
// 코스트코 영수증 확정 → 원장 self 입고(kind='receipt'). 영수증 확정 라우트의 줄 트랜잭션 안에서 부른다.
// 품번 : SKU = 1 : N(erp.purchase_units). 후보: 기억한 품번 연결 ∪ 옛 상품(product_cost) 연결(기억한 것이 먼저).
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

/**
 * 확정 요청의 한 줄 분배. qty null = (고른 SKU가 하나일 때) 입고 수량 전부.
 * manual = 화면의 「다른 SKU로 바꾸기」로 사람이 후보 밖에서 고른 SKU. 후보가 있을 때 후보 밖 SKU는 이 표시가 있어야 받는다.
 */
export interface SplitItem {
  skuId: number;
  qty: number | null;
  manual?: boolean;
}

export class ReceiptSplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptSplitError';
  }
}

/**
 * 영수증 확정에서 사람이 고른(나눈·바꾼·검색한) SKU로 학습한 purchase_units 행의 label 꼬리표.
 * purchase_units에는 만든 시각·출처 열이 없고 이번에는 마이그레이션을 하지 않는다 — 그래서 label 끝에 붙여 구분한다.
 * 이 꼬리표가 없는 행 = 사람이 미리 적재한 연결(2026-09-26 63행). 후보 하나 자동 입고는 고른 것이 없으므로 학습하지 않는다.
 */
export const LEARNED_LABEL_SUFFIX = '[영수증 확정 학습]';

const strip = (c: SkuCandidate): SkuCandidate => ({ skuId: c.skuId, key: c.key, name: c.name, option: c.option });

export const skuLabel = (c: { name: string; option?: string | null }): string => (c.option ? `${c.name} · ${c.option}` : c.name);

/** 끝 글자 받침으로 조사를 고른다(한글이 아니면 받침 없음으로 본다) */
function josa(word: string, withBatchim: string, without: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0 ? withBatchim : without;
}
const quote = (label: string, withBatchim: string, without: string) => `「${label}」${josa(label, withBatchim, without)}`;

/**
 * 줄의 SKU 후보 = 기억한 품번 연결(purchase_units) ∪ 상품 연결(product_cost → skus.legacy_product_cost_ids).
 * 기억한 것이 먼저, 같은 SKU는 한 번. 합치는 이유: 품번이 옵션 하나만 기억하고 있어도 같은 상품의 다른 옵션을 고를 수 있어야 한다.
 */
export function buildLineOptions(
  itemCode: string | null,
  productCostId: string | null,
  learned: (SkuCandidate & { supplierCode: string })[],
  byProduct: (SkuCandidate & { legacy: string[] })[],
): LineOptions {
  const l = itemCode ? learned.filter((x) => x.supplierCode === itemCode) : [];
  const p = productCostId ? byProduct.filter((x) => x.legacy.includes(productCostId)) : [];
  const seen = new Set<number>();
  const candidates: SkuCandidate[] = [];
  for (const c of [...l, ...p]) {
    if (seen.has(c.skuId)) continue;
    seen.add(c.skuId);
    candidates.push(strip(c));
  }
  return { source: l.length > 0 ? 'learned' : p.length > 0 ? 'product' : 'none', candidates };
}

/** 화면이 보여줄 예상 판매단위 수량. 소분은 이월을 모르므로 추정이다 */
export function expectedPacks(l: { entry_type: string | null; quantity: number; items_per_box: number | null; subdivision_unit: number | null }): { qty: number; approx: boolean } | null {
  if (l.entry_type === 'subdivision') {
    if (!l.items_per_box || !l.subdivision_unit) return null;
    return { qty: Math.floor((l.quantity * l.items_per_box) / l.subdivision_unit), approx: true };
  }
  return Number.isInteger(l.quantity) && l.quantity > 0 ? { qty: l.quantity, approx: false } : null;
}

export function resolveReceiptSplit(
  packs: number,
  candidates: number[],
  requested?: SplitItem[] | null,
  opts: { labelOf?: (skuId: number) => string } = {},
): { skuId: number; qty: number }[] {
  const labelOf = opts.labelOf ?? (() => '고른 SKU');
  if (!Number.isInteger(packs) || packs <= 0) throw new ReceiptSplitError(`입고 수량 ${packs}개가 양의 정수가 아니어서 재고에 넣을 수 없습니다.`);
  if (requested && requested.length > 0) {
    const seen = new Set<number>();
    for (const r of requested) {
      if (!Number.isInteger(r.skuId) || r.skuId <= 0) throw new ReceiptSplitError('고른 SKU 정보가 잘못됐습니다 — 다시 골라 주세요.');
      if (seen.has(r.skuId)) throw new ReceiptSplitError(`${quote(labelOf(r.skuId), '이', '가')} 두 번 들어 있습니다.`);
      seen.add(r.skuId);
      if (candidates.length > 0 && !r.manual && !candidates.includes(r.skuId)) {
        throw new ReceiptSplitError(`${quote(labelOf(r.skuId), '은', '는')} 이 품목의 옵션 후보가 아닙니다 — 「다른 SKU로 바꾸기」로 골라 주세요.`);
      }
    }
    if (requested.length === 1 && requested[0].qty === null) return [{ skuId: requested[0].skuId, qty: packs }];
    for (const r of requested) {
      if (r.qty === null || !Number.isInteger(r.qty) || r.qty < 0) throw new ReceiptSplitError('옵션별 수량은 0 이상 정수로 적어 주세요.');
    }
    const out = requested.filter((r) => (r.qty as number) > 0).map((r) => ({ skuId: r.skuId, qty: r.qty as number }));
    const sum = out.reduce((s, r) => s + r.qty, 0);
    if (sum !== packs) throw new ReceiptSplitError(`옵션별로 나눈 합 ${sum}개가 입고 수량 ${packs}개와 다릅니다 — 다시 나눠 주세요.`);
    return out.sort((a, b) => a.skuId - b.skuId);
  }
  if (candidates.length === 1) return [{ skuId: candidates[0], qty: packs }];
  if (candidates.length === 0) throw new ReceiptSplitError('이 품목에 연결된 재고 SKU가 없습니다 — 확정 화면에서 SKU를 골라 주세요.');
  throw new ReceiptSplitError(`옵션이 ${candidates.length}개입니다 — 확정 화면에서 옵션별 수량을 나눠 주세요.`);
}

/** 요청 본문 sku_splits: { [line_no]: [{ sku_id, qty, manual? }] } */
export function parseSkuSplits(raw: unknown): Record<number, SplitItem[]> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ReceiptSplitError('옵션 분배(sku_splits) 형식이 잘못됐습니다.');
  const out: Record<number, SplitItem[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const lineNo = Number(k);
    if (!Number.isInteger(lineNo) || !Array.isArray(v)) throw new ReceiptSplitError(`${k}번 줄의 옵션 분배 형식이 잘못됐습니다.`);
    out[lineNo] = v.map((x) => {
      const o = (x ?? {}) as { sku_id?: unknown; qty?: unknown; manual?: unknown };
      const item: SplitItem = { skuId: Number(o.sku_id), qty: o.qty === null || o.qty === undefined ? null : Number(o.qty) };
      if (o.manual === true) item.manual = true;
      return item;
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
 * 멱등키 receipt:<receipt_line_id>:<sku_id>.
 * 학습: 사람이 분배를 보냈을 때(나눈·고른·바꾼 SKU)만 품번 연결을 purchase_units에 기억한다(LEARNED_LABEL_SUFFIX 참조).
 * 후보 하나 자동 입고는 사람이 고른 것이 없으므로 기억하지 않는다.
 */
export async function postReceiptLots(
  db: Db,
  p: {
    lineId: string; lineNo: number; itemCode: string | null; itemLabel: string; productCostId: string;
    packs: number; unitCost: number; receivedAt: string; requested?: SplitItem[] | null;
  },
): Promise<{ skuId: number; qty: number }[]> {
  const opts = (await loadSkuOptions(db, [{ lineNo: p.lineNo, itemCode: p.itemCode, productCostId: p.productCostId }])).get(p.lineNo)!;
  const candIds = opts.candidates.map((c) => c.skuId);
  const reqIds = (p.requested ?? []).map((r) => r.skuId).filter((id) => Number.isInteger(id) && id > 0);
  const ids = [...new Set([...candIds, ...reqIds])];
  // 메시지에 id 대신 이름을 쓰고, 활성 여부도 같은 조회로 본다
  const info = new Map<number, { label: string; active: boolean }>();
  if (ids.length > 0) {
    const { rows } = await db.query(`select id, name, option_label, status from erp.skus where id = any($1::bigint[])`, [ids]);
    for (const r of rows) info.set(Number(r.id), { label: skuLabel({ name: String(r.name), option: r.option_label }), active: r.status === 'active' });
  }
  const labelOf = (id: number) => info.get(id)?.label ?? '고른 SKU';
  const split = resolveReceiptSplit(p.packs, candIds, p.requested, { labelOf });
  if (!Number.isInteger(p.unitCost) || p.unitCost < 0) throw new ReceiptSplitError(`입고 단가 ${p.unitCost}원이 0 이상 정수가 아니어서 재고에 넣을 수 없습니다.`);
  for (const s of split) {
    const i = info.get(s.skuId);
    if (!i) throw new ReceiptSplitError('고른 SKU를 찾지 못했습니다 — 다시 골라 주세요.');
    if (!i.active) throw new ReceiptSplitError(`${quote(i.label, '은', '는')} 판매 중인 SKU가 아닙니다 — 다시 골라 주세요.`);
  }
  const learn = !!p.itemCode && !!p.requested && p.requested.length > 0;

  // 1-B 인계(I4): 여러 SKU는 오름차순으로 먼저 잠근다(split은 이미 오름차순)
  for (const s of split) await lockSku(db, s.skuId);
  const occurredAt = `${p.receivedAt}T00:00:00+09:00`;
  for (const s of split) {
    await postLotCreate(db, {
      skuId: s.skuId, location: 'self', qty: s.qty, unitCost: p.unitCost, kind: 'receipt', occurredAt,
      idemKey: `receipt:${p.lineId}:${s.skuId}`, refType: 'receipt_line', refId: p.lineId, note: p.itemLabel.slice(0, 100),
    });
    if (learn) {
      await db.query(
        `insert into erp.purchase_units (supplier, supplier_code, label, sku_id) values ('costco', $1, $2, $3)
         on conflict (supplier, supplier_code, sku_id) do nothing`,
        [p.itemCode, `${p.itemLabel} ${LEARNED_LABEL_SUFFIX}`, s.skuId],
      );
    }
  }
  return split;
}
