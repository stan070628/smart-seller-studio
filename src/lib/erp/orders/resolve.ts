// src/lib/erp/orders/resolve.ts
// 주문 라인 → 리스팅(erp.channel_listings) → SKU·수량. link_mode(110):
//   single = SKU 하나 · bundle = 연결된 SKU 전부를 각 배수만큼 · any_of = 그중 하나(주문만으로 못 가른다 → 미귀속, 1-C2b 대기열)
import type { OrderChannel, OrderLine } from './types';

export type LinkMode = 'single' | 'bundle' | 'any_of';

export interface ListingEntry {
  listingId: number;
  channel: OrderChannel;
  /** channel_listings.external_product_id */
  productId: string;
  /** channel_listings.external_option_key('' = 옵션 없음) */
  optionKey: string;
  linkMode: LinkMode;
  skus: { skuId: number; multiplier: number }[];
}

export type UnattributedReason = 'no_listing' | 'any_of' | 'option_unmatched' | 'no_sku_link';

export interface AllocItem {
  skuId: number;
  /** SKU 기준 단위 수량 = 주문 수량 × 배수 */
  qty: number;
}

export interface Resolution {
  listingId: number | null;
  attribution: 'mapped' | 'unattributed';
  reason: UnattributedReason | null;
  /** mapped일 때만. SKU 오름차순 */
  alloc: AllocItem[];
  /** 찾은 리스팅의 SKU 연결(미귀속이어도) — 옛 장부 product_cost 고르기에 쓴다 */
  listingSkus: { skuId: number; multiplier: number }[];
}

/** 토스 옵션명 비교용: '/'로 나눈 칸마다 「이름:」 접두와 공백을 뗀다. '색상: 블랙 / 사이즈: L' → '블랙/L' */
// 토스 주문은 옵션을 「, 」로 잇고 리스팅은 「 / 」로 잇는다(2026-09-27 운영 실측) — 둘 다 구분자로 본다.
// 값 안의 쉼표(보태니컬 비누 향 목록)도 양쪽이 똑같이 펼쳐지므로 비교 결과는 같다.
export function normalizeOption(s: string): string {
  return s
    .split(/[/,，]/)
    .map((seg) => seg.replace(/^[^:：]*[:：]/, '').replace(/\s+/g, ''))
    .filter((x) => x !== '')
    .join('/');
}

export class ListingIndex {
  private readonly exactMap = new Map<string, ListingEntry>();
  private readonly byProduct = new Map<string, ListingEntry[]>();

  constructor(entries: ListingEntry[]) {
    for (const e of entries) {
      this.exactMap.set(`${e.channel}|${e.productId}|${e.optionKey}`, e);
      const k = `${e.channel}|${e.productId}`;
      const list = this.byProduct.get(k) ?? [];
      list.push(e);
      this.byProduct.set(k, list);
    }
  }

  exact(ch: OrderChannel, productId: string, optionKey: string): ListingEntry | null {
    return this.exactMap.get(`${ch}|${productId}|${optionKey}`) ?? null;
  }

  ofProduct(ch: OrderChannel, productId: string): ListingEntry[] {
    return this.byProduct.get(`${ch}|${productId}`) ?? [];
  }
}

function findListing(l: OrderLine, idx: ListingIndex): { entry: ListingEntry | null; reason: UnattributedReason | null } {
  if (l.productId === '') return { entry: null, reason: 'no_listing' };
  const all = idx.ofProduct(l.channel, l.productId);
  if (all.length === 0) return { entry: null, reason: 'no_listing' };
  const exact = idx.exact(l.channel, l.productId, l.optionKey);
  if (exact) return { entry: exact, reason: null };
  if (l.channel === 'toss') {
    const want = normalizeOption(l.optionKey);
    const norm = all.filter((e) => normalizeOption(e.optionKey) === want);
    if (norm.length === 1) return { entry: norm[0], reason: null };
  }
  // 허용하는 대체는 둘뿐이다. 모르는 옵션을 「하나뿐이니 그것」으로 잡으면 다른 SKU에서 뺀다 — 미귀속으로 쌓는 편이 안전하다.
  //   ① 그 상품에 옵션 없는('') 리스팅이 있으면 단일상품이다 → 그것
  const single = all.find((e) => e.optionKey === '');
  if (single) return { entry: single, reason: null };
  //   ② 주문 쪽 옵션이 비었으면 그 상품의 유일한 리스팅
  if (l.optionKey === '' && all.length === 1) return { entry: all[0], reason: null };
  return { entry: null, reason: 'option_unmatched' };
}

export function resolveLine(l: OrderLine, idx: ListingIndex): Resolution {
  const { entry, reason } = findListing(l, idx);
  if (!entry) return { listingId: null, attribution: 'unattributed', reason: reason ?? 'no_listing', alloc: [], listingSkus: [] };
  const skus = [...entry.skus].sort((a, b) => a.skuId - b.skuId);
  const base = { listingId: entry.listingId, listingSkus: skus };
  if (skus.length === 0) return { ...base, attribution: 'unattributed', reason: 'no_sku_link', alloc: [] };
  // single인데 SKU가 여럿이면 적재 규칙(draft.ts)상 any_of다 — 뺄 SKU를 고를 수 없다
  if (entry.linkMode === 'any_of' || (entry.linkMode === 'single' && skus.length > 1)) {
    return { ...base, attribution: 'unattributed', reason: 'any_of', alloc: [] };
  }
  return { ...base, attribution: 'mapped', reason: null, alloc: skus.map((s) => ({ skuId: s.skuId, qty: l.qty * s.multiplier })) };
}

/**
 * (1-C2b ①) 사람이 정한 SKU(order_lines.manual_sku_id)가 있으면 판정을 덮는다. 수량 배수는 그 SKU가 찾은 리스팅에
 * 걸려 있으면 그 배수, 아니면 1(주문 수량 그대로). null이면 판정을 그대로 돌려준다.
 */
export function applyManualSku(l: OrderLine, r: Resolution, manualSkuId: number | null): Resolution {
  if (manualSkuId === null) return r;
  const m = r.listingSkus.find((s) => s.skuId === manualSkuId)?.multiplier ?? 1;
  return { listingId: r.listingId, attribution: 'mapped', reason: null, alloc: [{ skuId: manualSkuId, qty: l.qty * m }], listingSkus: r.listingSkus };
}
