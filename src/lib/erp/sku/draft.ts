/**
 * 기존 데이터 → SKU 마스터 초안. 순수 함수라 DB·API 없이 시험한다.
 *
 * 초안은 「제안」이다. 레거시와 어긋나는 곳은 고치지 않고 issues로 올려
 * 사용자가 점검 보고서에서 정한 뒤(overrides) 적재한다.
 */
import { optionKeyOf, type ItemAttribute } from './option-key';

export type ListingChannel = 'coupang_wing' | 'coupang_rg' | 'naver' | 'toss';

export interface DraftInput {
  coupangProducts: {
    sellerProductId: number;
    productName: string;
    items: { itemName: string; attributes?: ItemAttribute[]; wingVid: number | null; rgVid: number | null }[];
  }[];
  syncLinks: { coupangVid: number; channel: 'naver' | 'toss'; productId: number; optionKey: string; label: string | null }[];
  legacyChannels: { productCostId: string; channelType: 'coupang_rg' | 'coupang_wing' | 'naver'; externalId: number; unitMultiplier: number }[];
  legacyProductCosts: { id: string; productName: string; sellerProductId: number; vendorItemId: number | null }[];
  saleAttributions: { vid: number; productCostId: string; rows: number }[];
}

export interface DraftSku {
  key: string;
  name: string;
  optionLabel: string;
  baseUnitLabel: string | null;
  status: 'active' | 'archived';
  legacyProductCostIds: string[];
}

export interface DraftListing {
  key: string; // `${channel}|${externalProductId}|${externalOptionKey}`
  channel: ListingChannel;
  externalProductId: string;
  externalOptionKey: string;
  altProductId: string | null;
  label: string | null;
}

export interface DraftLink {
  listingKey: string;
  skuKey: string;
  multiplier: number;
}

export type IssueKind =
  | 'uneven_multiplier'
  | 'multi_vid_listing'
  | 'sync_link_unresolved'
  | 'legacy_multiplier_mismatch'
  | 'legacy_listing_unresolved'
  | 'legacy_spans_skus'
  | 'sale_attribution_mismatch'
  | 'legacy_duplicate';

export interface DraftIssue {
  kind: IssueKind;
  ref: string;
  detail: string;
}

export interface Draft {
  skus: DraftSku[];
  listings: DraftListing[];
  links: DraftLink[];
  issues: DraftIssue[];
}

export interface Overrides {
  mergeSkus: string[][];
  setMultiplier: { listingKey: string; skuKey: string; multiplier: number }[];
  excludeListings: string[];
  rename: Record<string, string>;
  baseUnit: Record<string, string>;
  archive: string[];
}

export const listingKey = (channel: ListingChannel, productId: string | number, optionKey = '') =>
  `${channel}|${productId}|${optionKey}`;

export function buildDraft(input: DraftInput): Draft {
  const skus = new Map<string, DraftSku>();
  const listings = new Map<string, DraftListing>();
  const links = new Map<string, DraftLink>(); // key: listingKey + '→' + skuKey
  const issues: DraftIssue[] = [];
  const vidLink = new Map<number, { skuKey: string; multiplier: number }>();

  const addLink = (l: DraftLink) => links.set(`${l.listingKey}→${l.skuKey}`, l);

  // 1~3. 쿠팡 상품 → SKU · Wing/RG 리스팅
  for (const p of input.coupangProducts) {
    const groups = new Map<string, { item: DraftInput['coupangProducts'][number]['items'][number]; quantity: number }[]>();
    for (const item of p.items) {
      const { option, quantity } = optionKeyOf(item);
      const g = groups.get(option) ?? [];
      g.push({ item, quantity });
      groups.set(option, g);
    }
    for (const [option, members] of groups) {
      const skuKey = `cp:${p.sellerProductId}:${option}`;
      skus.set(skuKey, { key: skuKey, name: p.productName, optionLabel: option, baseUnitLabel: null, status: 'active', legacyProductCostIds: [] });
      const minQty = Math.min(...members.map((m) => m.quantity));
      const uneven = members.some((m) => m.quantity % minQty !== 0);
      if (uneven) issues.push({ kind: 'uneven_multiplier', ref: skuKey, detail: `수량 ${members.map((m) => m.quantity).join('/')} — 배수를 원래 수량으로 두었다` });
      for (const { item, quantity } of members) {
        const multiplier = uneven ? quantity : quantity / minQty;
        for (const [channel, vid] of [['coupang_wing', item.wingVid], ['coupang_rg', item.rgVid]] as const) {
          if (!vid) continue;
          const key = listingKey(channel, vid);
          listings.set(key, { key, channel, externalProductId: String(vid), externalOptionKey: '', altProductId: String(p.sellerProductId), label: `${p.productName} · ${item.itemName}`.trim() });
          addLink({ listingKey: key, skuKey, multiplier });
          vidLink.set(vid, { skuKey, multiplier });
        }
      }
    }
  }

  // 4. 네이버·토스 리스팅 (stock_sync_links)
  const syncGroups = new Map<string, DraftInput['syncLinks']>();
  for (const s of input.syncLinks) {
    const key = listingKey(s.channel, s.productId, s.optionKey);
    const g = syncGroups.get(key) ?? [];
    g.push(s);
    syncGroups.set(key, g);
  }
  for (const [key, rows] of syncGroups) {
    const resolved = rows.map((r) => vidLink.get(r.coupangVid)).filter((x): x is { skuKey: string; multiplier: number } => !!x);
    if (resolved.length === 0) {
      issues.push({ kind: 'sync_link_unresolved', ref: key, detail: `쿠팡 vid ${rows.map((r) => r.coupangVid).join(',')}를 초안에서 찾지 못했다` });
      continue;
    }
    const first = rows[0];
    listings.set(key, { key, channel: first.channel, externalProductId: String(first.productId), externalOptionKey: first.optionKey, altProductId: null, label: first.label });
    if (rows.length > 1) issues.push({ kind: 'multi_vid_listing', ref: key, detail: `쿠팡 옵션 ${rows.length}개가 이 리스팅 하나에 붙어 있다` });
    for (const r of resolved) {
      // 같은 SKU에 여러 vid(예: 1개·2개 옵션)가 붙으면 가장 작은 배수를 쓴다 — 채널 옵션 1개는 1단위로 판다
      const k = `${key}→${r.skuKey}`;
      const prev = links.get(k);
      if (!prev || r.multiplier < prev.multiplier) addLink({ listingKey: key, skuKey: r.skuKey, multiplier: r.multiplier });
    }
  }

  // 5~6. 레거시 대조
  const skuLegacy = new Map<string, Set<string>>();
  const pcSkus = new Map<string, Set<string>>();
  const note = (pc: string, skuKey: string) => {
    (skuLegacy.get(skuKey) ?? skuLegacy.set(skuKey, new Set()).get(skuKey)!).add(pc);
    (pcSkus.get(pc) ?? pcSkus.set(pc, new Set()).get(pc)!).add(skuKey);
  };
  const pcByVid = new Map<number, string>();
  for (const c of input.legacyChannels) {
    if (c.channelType === 'naver') continue;
    pcByVid.set(c.externalId, c.productCostId);
    const key = listingKey(c.channelType, c.externalId);
    const found = vidLink.get(c.externalId);
    if (!found) {
      issues.push({ kind: 'legacy_listing_unresolved', ref: key, detail: `product_cost ${c.productCostId}의 매핑이 현재 쿠팡 상품에 없다` });
      continue;
    }
    note(c.productCostId, found.skuKey);
    if (found.multiplier !== c.unitMultiplier) {
      issues.push({ kind: 'legacy_multiplier_mismatch', ref: key, detail: `레거시 배수 ${c.unitMultiplier} / 초안 배수 ${found.multiplier}` });
    }
  }
  for (const pc of input.legacyProductCosts) {
    if (pc.vendorItemId && vidLink.has(pc.vendorItemId)) note(pc.id, vidLink.get(pc.vendorItemId)!.skuKey);
  }
  for (const [pc, set] of pcSkus) {
    if (set.size > 1) issues.push({ kind: 'legacy_spans_skus', ref: pc, detail: `SKU ${[...set].join(', ')}에 걸친다 — 입고 lot을 옵션별로 나눌 수 없어 기초 재고는 실사로 잡는다` });
  }
  for (const s of input.saleAttributions) {
    const mapped = pcByVid.get(s.vid);
    if (mapped && mapped !== s.productCostId) {
      const channel = vidLink.has(s.vid) && [...listings.values()].some((l) => l.key === listingKey('coupang_rg', s.vid)) ? 'coupang_rg' : 'coupang_wing';
      issues.push({ kind: 'sale_attribution_mismatch', ref: listingKey(channel, s.vid), detail: `판매 ${s.rows}행은 ${s.productCostId}, 매핑은 ${mapped}` });
    }
  }
  const dupGroups = new Map<string, string[]>();
  for (const pc of input.legacyProductCosts) {
    const k = `${pc.productName}|${pc.sellerProductId}`;
    dupGroups.set(k, [...(dupGroups.get(k) ?? []), pc.id]);
  }
  for (const ids of dupGroups.values()) {
    if (ids.length > 1) issues.push({ kind: 'legacy_duplicate', ref: ids.join(','), detail: '이름과 seller_product_id가 같은 product_cost가 여러 개다' });
  }
  for (const [skuKey, set] of skuLegacy) {
    const s = skus.get(skuKey);
    if (s) s.legacyProductCostIds = [...set].sort();
  }

  return { skus: [...skus.values()], listings: [...listings.values()], links: [...links.values()], issues };
}

export function applyOverrides(draft: Draft, o: Overrides): Draft {
  const skus = new Map(draft.skus.map((s) => [s.key, { ...s, legacyProductCostIds: [...s.legacyProductCostIds] }]));
  let links = draft.links.map((l) => ({ ...l }));
  let listings = draft.listings.map((l) => ({ ...l }));
  const must = (k: string) => {
    if (!skus.has(k)) throw new Error(`overrides가 없는 SKU를 가리킨다: ${k}`);
  };

  for (const [keep, ...absorb] of o.mergeSkus) {
    must(keep);
    for (const a of absorb) {
      must(a);
      const target = skus.get(keep)!;
      target.legacyProductCostIds = [...new Set([...target.legacyProductCostIds, ...skus.get(a)!.legacyProductCostIds])].sort();
      skus.delete(a);
      links = links.map((l) => (l.skuKey === a ? { ...l, skuKey: keep } : l));
    }
  }
  const dedup = new Map<string, (typeof links)[number]>();
  for (const l of links) {
    const k = `${l.listingKey}→${l.skuKey}`;
    const prev = dedup.get(k);
    if (!prev || l.multiplier < prev.multiplier) dedup.set(k, l);
  }
  links = [...dedup.values()];

  for (const m of o.setMultiplier) {
    must(m.skuKey);
    const hit = links.find((l) => l.listingKey === m.listingKey && l.skuKey === m.skuKey);
    if (!hit) throw new Error(`overrides가 없는 연결을 가리킨다: ${m.listingKey}→${m.skuKey}`);
    hit.multiplier = m.multiplier;
  }
  const excluded = new Set(o.excludeListings);
  listings = listings.filter((l) => !excluded.has(l.key));
  links = links.filter((l) => !excluded.has(l.listingKey));
  for (const [k, name] of Object.entries(o.rename)) { must(k); skus.get(k)!.name = name; }
  for (const [k, unit] of Object.entries(o.baseUnit)) { must(k); skus.get(k)!.baseUnitLabel = unit; }
  for (const k of o.archive) { must(k); skus.get(k)!.status = 'archived'; }

  return { skus: [...skus.values()], listings, links, issues: draft.issues };
}
