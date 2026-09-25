/**
 * 기존 데이터 → SKU 마스터 초안. 순수 함수라 DB·API 없이 시험한다.
 *
 * 초안은 「제안」이다. 레거시와 어긋나는 곳은 고치지 않고 issues로 올려
 * 사용자가 점검 보고서에서 정한 뒤(overrides) 적재한다.
 */
import { optionKeyOf, type ItemAttribute } from './option-key';

export type ListingChannel = 'coupang_wing' | 'coupang_rg' | 'naver' | 'toss';
export type LinkMode = 'single' | 'bundle' | 'any_of';

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
  /**
   * single=SKU 1개. bundle=연결된 SKU 전부를 소비한다(세트, 현재 생성기는 만들지 않는다).
   * any_of=연결된 SKU 중 하나를 판다 — 네이버 단일상품 하나가 서로 다른 실물 옵션을 함께 파는 경우(컬럼비아).
   * 번들(전부 소비)이 아니라 「그중 하나」라는 뜻이므로 재고 전송(1-D)은 연결 SKU 가용 합계를 쓰고,
   * 판매 SKU는 주문 옵션으로 가린다(1-C).
   */
  linkMode: LinkMode;
  /**
   * 같은 쿠팡 item의 Wing·RG 짝 리스팅 키. buildDraft가 item을 만들 때 직접 기록한다 —
   * altProductId·label이 같다고 라벨로 추정하면 itemName이 우연히 같은 다른 item과 잘못 짝지어질 수 있다.
   * item에 Wing·RG 둘 다 있을 때만 있고, 한쪽만 있으면(RG 없음 등) undefined다.
   */
  pairKey?: string;
}

export interface DraftLink {
  listingKey: string;
  skuKey: string;
  multiplier: number;
}

export type IssueKind =
  | 'uneven_multiplier'
  | 'multi_vid_listing'
  | 'any_of_listing'
  | 'sync_link_unresolved'
  | 'channel_quantity_mismatch'
  | 'legacy_multiplier_mismatch'
  | 'legacy_listing_unresolved'
  | 'legacy_spans_skus'
  | 'legacy_vid_multi_mapped'
  | 'sale_attribution_mismatch'
  | 'legacy_duplicate'
  | 'suspect_merge'
  | 'quantity_invalid';

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
  mergeSkus?: string[][];
  setMultiplier?: { listingKey: string; skuKey: string; multiplier: number }[];
  excludeListings?: string[];
  rename?: Record<string, string>;
  baseUnit?: Record<string, string>;
  archive?: string[];
  /** 리스팅의 모든 연결을 toSkuKey 하나로 옮긴다. toSkuKey가 아직 없으면 새로 만든다(name/optionLabel은 인자 또는 원 SKU 값). */
  splitListing?: { listingKey: string; toSkuKey: string; name?: string; optionLabel?: string }[];
}

export const listingKey = (channel: ListingChannel, productId: string | number, optionKey = '') =>
  `${channel}|${productId}|${optionKey}`;

export function buildDraft(input: DraftInput): Draft {
  const skus = new Map<string, DraftSku>();
  const listings = new Map<string, DraftListing>();
  const links = new Map<string, DraftLink>(); // key: listingKey + '→' + skuKey
  const issues: DraftIssue[] = [];
  const vidLink = new Map<number, { skuKey: string; multiplier: number; quantity: number }>();

  const addLink = (l: DraftLink) => links.set(`${l.listingKey}→${l.skuKey}`, l);

  // 1~3. 쿠팡 상품 → SKU · Wing/RG 리스팅
  for (const p of input.coupangProducts) {
    const groups = new Map<string, { item: DraftInput['coupangProducts'][number]['items'][number]; quantity: number }[]>();
    for (const item of p.items) {
      const parsed = optionKeyOf(item);
      const option = parsed.option;
      let quantity = parsed.quantity;
      if (quantity === 0) {
        issues.push({ kind: 'quantity_invalid', ref: `cp:${p.sellerProductId}:${option}`, detail: `itemName '${item.itemName}' 수량이 0으로 파싱됐다 — 1로 보정` });
        quantity = 1;
      }
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

      // 그룹 안 실물이 진짜로 같은지 의심되는 징후: itemName만으로 다시 갈랐을 때 남는 옵션이 갈리거나(속성 그룹핑이
      // itemName과 다른 실물을 하나로 묶었을 수 있다), 수량이 중복된다(수량만 다른 옵션이라면 보통 수량이 다 다르다).
      if (members.length > 1) {
        // itemName 잔여에 그 member 수량과 같은 곱셈 표기(`330ml x 6`처럼 수량을 다시 적어둔 것)가 남으면
        // 수량만 다른 정상 옵션인데도 잔여 문자열이 갈려 오탐한다 — 비교 전에 지운다.
        const stripQtyNotation = (residual: string, qty: number) =>
          residual
            .replace(new RegExp(`\\s*[x×*]\\s*${qty}(?=\\s*\\)|\\s|$)`, 'gi'), '')
            .replace(/\(\s*\)/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        const itemNameOptions = new Set(
          members.map((m) => stripQtyNotation(optionKeyOf({ itemName: m.item.itemName }).option, m.quantity)),
        );
        const qtyCounts = new Map<number, number>();
        for (const m of members) qtyCounts.set(m.quantity, (qtyCounts.get(m.quantity) ?? 0) + 1);
        const dupQty = [...qtyCounts.values()].some((c) => c > 1);
        if (itemNameOptions.size >= 2 || dupQty) {
          issues.push({
            kind: 'suspect_merge',
            ref: skuKey,
            detail: `itemName 잔여 [${[...itemNameOptions].join(', ')}] · 수량 [${members.map((m) => m.quantity).join(',')}] — 서로 다른 실물일 수 있다`,
          });
        }
      }

      for (const { item, quantity } of members) {
        const multiplier = uneven ? quantity : quantity / minQty;
        // 이 item의 Wing·RG 짝을 여기서 직접 정한다(라벨로 나중에 추정하지 않는다) — item에 둘 다 있을 때만 짝이다.
        const wingKey = item.wingVid ? listingKey('coupang_wing', item.wingVid) : undefined;
        const rgKey = item.rgVid ? listingKey('coupang_rg', item.rgVid) : undefined;
        for (const [channel, vid] of [['coupang_wing', item.wingVid], ['coupang_rg', item.rgVid]] as const) {
          if (!vid) continue;
          const key = listingKey(channel, vid);
          const pairKey = channel === 'coupang_wing' ? rgKey : wingKey;
          listings.set(key, { key, channel, externalProductId: String(vid), externalOptionKey: '', altProductId: String(p.sellerProductId), label: `${p.productName} · ${item.itemName}`.trim(), linkMode: 'single', pairKey });
          addLink({ listingKey: key, skuKey, multiplier });
          vidLink.set(vid, { skuKey, multiplier, quantity });
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
    const pairs = rows.map((r) => ({ r, hit: vidLink.get(r.coupangVid) }));
    const resolved = pairs.filter(
      (p): p is { r: (typeof rows)[number]; hit: { skuKey: string; multiplier: number; quantity: number } } => !!p.hit,
    );
    const unresolvedVids = pairs.filter((p) => !p.hit).map((p) => p.r.coupangVid);

    if (resolved.length === 0) {
      issues.push({ kind: 'sync_link_unresolved', ref: key, detail: `쿠팡 vid ${unresolvedVids.join(',')}를 초안에서 찾지 못했다` });
      continue;
    }
    if (unresolvedVids.length > 0) {
      issues.push({ kind: 'sync_link_unresolved', ref: key, detail: `쿠팡 vid ${unresolvedVids.join(',')}를 초안에서 찾지 못했다(일부)` });
    }

    const first = rows[0];
    const distinctSkus = new Set(resolved.map((p) => p.hit.skuKey));
    const linkMode: LinkMode = distinctSkus.size >= 2 ? 'any_of' : 'single';
    listings.set(key, { key, channel: first.channel, externalProductId: String(first.productId), externalOptionKey: first.optionKey, altProductId: null, label: first.label, linkMode });

    if (distinctSkus.size >= 2) {
      // 번들(전부 소비)이 아니라 그중 하나를 파는 관계다 — 재고 전송은 연결 SKU 합계, 판매 SKU는 주문 옵션으로 가린다(1-C/1-D)
      issues.push({ kind: 'any_of_listing', ref: key, detail: `SKU ${[...distinctSkus].join(', ')} 중 하나를 판다` });
    } else if (resolved.length > 1) {
      const multipliers = resolved.map((p) => p.hit.multiplier);
      issues.push({ kind: 'multi_vid_listing', ref: key, detail: `쿠팡 옵션 ${resolved.length}개(배수 ${multipliers.join('/')}) 중 최소 배수 ${Math.min(...multipliers)}를 적용했다` });
    }

    for (const p of resolved) {
      // 같은 SKU에 여러 vid(예: 1개·2개 옵션)가 붙으면 가장 작은 배수를 쓴다 — 채널 옵션 1개는 1단위로 판다
      const k = `${key}→${p.hit.skuKey}`;
      const prev = links.get(k);
      if (!prev || p.hit.multiplier < prev.multiplier) addLink({ listingKey: key, skuKey: p.hit.skuKey, multiplier: p.hit.multiplier });
    }

    if (first.channel === 'toss') {
      const parsedQty = optionKeyOf({ itemName: first.optionKey }).quantity;
      const mismatch = resolved.some((p) => p.hit.quantity !== parsedQty);
      if (mismatch) {
        issues.push({
          kind: 'channel_quantity_mismatch',
          ref: key,
          detail: `토스 옵션 수량 ${parsedQty} / 쿠팡 수량 ${resolved.map((p) => p.hit.quantity).join(',')}`,
        });
      }
    }
  }

  // 5~6. 레거시 대조
  const skuLegacy = new Map<string, Set<string>>();
  const pcSkus = new Map<string, Set<string>>();
  const note = (pc: string, skuKey: string) => {
    (skuLegacy.get(skuKey) ?? skuLegacy.set(skuKey, new Set()).get(skuKey)!).add(pc);
    (pcSkus.get(pc) ?? pcSkus.set(pc, new Set()).get(pc)!).add(skuKey);
  };
  const pcByVid = new Map<number, { pcs: Set<string>; channelType: 'coupang_wing' | 'coupang_rg' }>();
  for (const c of input.legacyChannels) {
    if (c.channelType === 'naver') continue;
    const entry = pcByVid.get(c.externalId) ?? { pcs: new Set<string>(), channelType: c.channelType };
    entry.pcs.add(c.productCostId);
    pcByVid.set(c.externalId, entry);

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
  for (const [vid, entry] of pcByVid) {
    if (entry.pcs.size > 1) {
      issues.push({
        kind: 'legacy_vid_multi_mapped',
        ref: listingKey(entry.channelType, vid),
        detail: `product_cost ${[...entry.pcs].join(', ')}가 같은 쿠팡 옵션(vid ${vid})을 가리킨다`,
      });
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
    if (mapped && !mapped.pcs.has(s.productCostId)) {
      issues.push({
        kind: 'sale_attribution_mismatch',
        ref: listingKey(mapped.channelType, s.vid),
        detail: `판매 ${s.rows}행은 ${s.productCostId}, 매핑은 ${[...mapped.pcs].join(',')}`,
      });
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

/**
 * 초안 + 사용자 보정 → 최종 초안. **`buildDraft`의 결과에만 적용한다.**
 * 이 함수의 결과를 다시 이 함수에 넣지 않는다 — 두 번째 적용은 이미 지워진 SKU·리스팅을
 * overrides가 가리키는 형태가 되어 오류를 내거나(대상 없음) 조용히 아무 일도 하지 않는다.
 */
export function applyOverrides(draft: Draft, o: Overrides): Draft {
  const mergeSkus = o.mergeSkus ?? [];
  const setMultiplier = o.setMultiplier ?? [];
  const excludeListings = o.excludeListings ?? [];
  const rename = o.rename ?? {};
  const baseUnit = o.baseUnit ?? {};
  const archive = o.archive ?? [];
  const splitListing = o.splitListing ?? [];

  const skus = new Map(draft.skus.map((s) => [s.key, { ...s, legacyProductCostIds: [...s.legacyProductCostIds] }]));
  let links = draft.links.map((l) => ({ ...l }));
  let listings = draft.listings.map((l) => ({ ...l }));
  const must = (k: string) => {
    if (!skus.has(k)) throw new Error(`overrides가 없는 SKU를 가리킨다: ${k}`);
  };
  // 병합·분리 뒤 같은 리스팅→SKU 연결이 배수가 다른 채로 여럿 남으면 조용히 최소값을 고르지 않고 던진다 —
  // 그 자체가 「둘을 하나로 합쳐도 되는가」에 대한 사용자 확인이 필요하다는 신호다.
  const dedupLinks = (ls: typeof links) => {
    const map = new Map<string, (typeof links)[number]>();
    for (const l of ls) {
      const k = `${l.listingKey}→${l.skuKey}`;
      const prev = map.get(k);
      if (prev && prev.multiplier !== l.multiplier) {
        throw new Error(`병합 후 같은 리스팅→SKU 연결의 배수가 다르다: ${k} (${prev.multiplier} vs ${l.multiplier})`);
      }
      if (!prev) map.set(k, l);
    }
    return [...map.values()];
  };

  // mergeSkus로 지워진 키를 splitListing이 toSkuKey로 되살리면 legacyProductCostIds 등
  // 병합 시 누적한 정보가 조용히 사라진다 — 기억해두고 되살리기를 막는다.
  const absorbed = new Set<string>();

  for (const [keep, ...absorb] of mergeSkus) {
    must(keep);
    for (const a of absorb) {
      if (a === keep) throw new Error(`SKU를 자기 자신으로 병합할 수 없다: ${keep}`);
      must(a);
      const target = skus.get(keep)!;
      target.legacyProductCostIds = [...new Set([...target.legacyProductCostIds, ...skus.get(a)!.legacyProductCostIds])].sort();
      skus.delete(a);
      absorbed.add(a);
      links = links.map((l) => (l.skuKey === a ? { ...l, skuKey: keep } : l));
    }
  }
  links = dedupLinks(links);

  for (const sp of splitListing) {
    if (absorbed.has(sp.toSkuKey)) throw new Error(`흡수된 SKU를 되살리려 한다: ${sp.toSkuKey}`);
    const targetLinks = links.filter((l) => l.listingKey === sp.listingKey);
    if (targetLinks.length === 0) throw new Error(`overrides가 없는 리스팅을 가리킨다: ${sp.listingKey}`);
    if (!skus.has(sp.toSkuKey)) {
      const origin = skus.get(targetLinks[0].skuKey)!;
      skus.set(sp.toSkuKey, {
        key: sp.toSkuKey,
        name: sp.name ?? origin.name,
        optionLabel: sp.optionLabel ?? origin.optionLabel,
        baseUnitLabel: null,
        status: 'active',
        // 분리 전 SKU가 참조하던 옛 원가 행을 그대로 물려받는다 — 두 SKU가 같은 옛 행을 공유하는
        // 상태는 legacy_spans_skus와 같은 상황이라 여기서 끊지 않는다.
        legacyProductCostIds: [...origin.legacyProductCostIds],
      });
    }
    links = links.map((l) => (l.listingKey === sp.listingKey ? { ...l, skuKey: sp.toSkuKey } : l));
  }
  links = dedupLinks(links);

  for (const m of setMultiplier) {
    must(m.skuKey);
    if (!Number.isInteger(m.multiplier) || m.multiplier <= 0) {
      throw new Error(`overrides의 배수가 올바르지 않다(양의 정수여야 한다): ${m.listingKey}→${m.skuKey} = ${m.multiplier}`);
    }
    const hit = links.find((l) => l.listingKey === m.listingKey && l.skuKey === m.skuKey);
    if (!hit) throw new Error(`overrides가 없는 연결을 가리킨다: ${m.listingKey}→${m.skuKey}`);
    hit.multiplier = m.multiplier;
  }

  for (const k of excludeListings) {
    if (!listings.some((l) => l.key === k)) throw new Error(`overrides가 없는 리스팅을 가리킨다: ${k}`);
  }
  const excluded = new Set(excludeListings);
  listings = listings.filter((l) => !excluded.has(l.key));
  links = links.filter((l) => !excluded.has(l.listingKey));

  for (const [k, name] of Object.entries(rename)) { must(k); skus.get(k)!.name = name; }
  for (const [k, unit] of Object.entries(baseUnit)) { must(k); skus.get(k)!.baseUnitLabel = unit; }
  for (const k of archive) { must(k); skus.get(k)!.status = 'archived'; }

  // 병합·분리로 리스팅이 가리키는 SKU 수가 바뀌었을 수 있다 — linkMode를 다시 센다.
  // bundle은 사용자가 정하는 값이라 건드리지 않는다.
  const skuCountByListing = new Map<string, number>();
  for (const l of links) skuCountByListing.set(l.listingKey, (skuCountByListing.get(l.listingKey) ?? 0) + 1);
  listings = listings.map((l) => {
    if (l.linkMode === 'bundle') return l;
    const count = skuCountByListing.get(l.key) ?? 0;
    if (count === 1 && l.linkMode !== 'single') return { ...l, linkMode: 'single' };
    if (count >= 2 && l.linkMode === 'single') return { ...l, linkMode: 'any_of' };
    return l;
  });

  // Wing·RG 짝 검증: buildDraft가 기록한 pairKey로 짝을 찾는다(altProductId·label로 추정하지 않는다 —
  // itemName이 우연히 같은 다른 item의 리스팅과 잘못 짝지어질 수 있었다). 짝은 항상 같은 SKU를 가리켜야
  // 한다 — splitListing 등으로 한쪽만 옮기면 재고 이관이 반쪽만 된다. 한쪽이 excludeListings로 빠졌으면
  // 비교 대상이 없으므로 건너뛴다.
  const listingByKey = new Map(listings.map((l) => [l.key, l]));
  const linksOfListing = (key: string) => links.filter((l) => l.listingKey === key);
  for (const l of listings) {
    if (!l.pairKey) continue;
    const other = listingByKey.get(l.pairKey);
    if (!other) continue;
    const aLinks = linksOfListing(l.key);
    const bLinks = linksOfListing(other.key);
    const aSkus = new Set(aLinks.map((x) => x.skuKey));
    const bSkus = new Set(bLinks.map((x) => x.skuKey));
    const same = aSkus.size === bSkus.size && [...aSkus].every((k) => bSkus.has(k));
    if (!same) throw new Error(`Wing·RG 짝이 다른 SKU를 가리킨다: ${l.key} / ${other.key} — 두 리스팅을 같은 SKU로 옮긴다`);
    // 같은 SKU를 가리키더라도 배수가 다르면 재고 이관 시 한쪽만 맞는 값이 된다 — 반드시 같은 배수여야 한다.
    for (const skuKey of aSkus) {
      const am = aLinks.find((x) => x.skuKey === skuKey)!.multiplier;
      const bm = bLinks.find((x) => x.skuKey === skuKey)!.multiplier;
      if (am !== bm) throw new Error(`Wing·RG 짝의 배수가 다르다: ${l.key} ×${am} / ${other.key} ×${bm} — 둘 다 같은 배수로 setMultiplier 한다`);
    }
  }

  return { skus: [...skus.values()], listings, links, issues: draft.issues };
}
