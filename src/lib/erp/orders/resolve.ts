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
export function normalizeOption(s: string): string {
  return s
    .split('/')
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
  // 그 상품의 리스팅이 하나뿐이면 옵션 표기가 달라도 그것이다(네이버 단일상품 · 토스 옵션 하나)
  if (all.length === 1) return { entry: all[0], reason: null };
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
