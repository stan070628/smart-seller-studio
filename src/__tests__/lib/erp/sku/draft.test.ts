import { describe, it, expect } from 'vitest';
import { buildDraft, applyOverrides, type DraftInput, type Draft } from '@/lib/erp/sku/draft';

const base: DraftInput = {
  coupangProducts: [
    {
      sellerProductId: 100,
      productName: '다슈 왁스',
      items: [
        { itemName: '1개', wingVid: 11, rgVid: 21 },
        { itemName: '2개', wingVid: 12, rgVid: 22 },
        { itemName: '3개', wingVid: 13, rgVid: null },
      ],
    },
    {
      sellerProductId: 200,
      productName: '콜맨 왜건',
      items: [
        { itemName: '블랙', wingVid: 31, rgVid: null },
        { itemName: '레드', wingVid: 32, rgVid: null },
      ],
    },
  ],
  syncLinks: [
    { coupangVid: 31, channel: 'naver', productId: 900, optionKey: '5001', label: '왜건 · 블랙' },
    { coupangVid: 31, channel: 'toss', productId: 800, optionKey: '블랙 / 1개', label: '왜건 · 블랙 / 1개' },
    { coupangVid: 11, channel: 'naver', productId: 901, optionKey: '', label: '다슈 단일' },
    { coupangVid: 12, channel: 'naver', productId: 901, optionKey: '', label: '다슈 단일' },
    { coupangVid: 99, channel: 'naver', productId: 902, optionKey: '', label: '모르는 상품' },
  ],
  legacyChannels: [
    { productCostId: 'pc-dasu', channelType: 'coupang_wing', externalId: 12, unitMultiplier: 2 },
    { productCostId: 'pc-dasu', channelType: 'coupang_wing', externalId: 13, unitMultiplier: 2 },
    { productCostId: 'pc-wagon', channelType: 'coupang_wing', externalId: 31, unitMultiplier: 1 },
    { productCostId: 'pc-wagon', channelType: 'coupang_wing', externalId: 32, unitMultiplier: 1 },
    { productCostId: 'pc-ghost', channelType: 'coupang_rg', externalId: 777, unitMultiplier: 1 },
  ],
  legacyProductCosts: [
    { id: 'pc-dasu', productName: '다슈', sellerProductId: 100, vendorItemId: null },
    { id: 'pc-wagon', productName: '왜건', sellerProductId: 200, vendorItemId: null },
    { id: 'pc-dup1', productName: '도미나스', sellerProductId: 300, vendorItemId: null },
    { id: 'pc-dup2', productName: '도미나스', sellerProductId: 300, vendorItemId: null },
  ],
  saleAttributions: [
    { vid: 31, productCostId: 'pc-wagon', rows: 5 },
    { vid: 32, productCostId: 'pc-dasu', rows: 2 },
  ],
};

describe('buildDraft', () => {
  const d = buildDraft(base);
  const sku = (k: string) => d.skus.find((s) => s.key === k)!;
  const link = (channel: string, pid: string, opt = '') =>
    d.links.filter((l) => l.listingKey === `${channel}|${pid}|${opt}`);

  it('수량만 다른 옵션을 SKU 하나로 묶고 최소 수량을 배수 1로 둔다', () => {
    expect(sku('cp:100:')).toMatchObject({ name: '다슈 왁스', optionLabel: '' });
    expect(link('coupang_wing', '11')).toEqual([{ listingKey: 'coupang_wing|11|', skuKey: 'cp:100:', multiplier: 1 }]);
    expect(link('coupang_wing', '12')[0].multiplier).toBe(2);
    expect(link('coupang_wing', '13')[0].multiplier).toBe(3);
  });

  it('Wing과 RG 리스팅이 같은 SKU·배수를 가진다', () => {
    expect(link('coupang_rg', '22')).toEqual([{ listingKey: 'coupang_rg|22|', skuKey: 'cp:100:', multiplier: 2 }]);
    const rg = d.listings.find((l) => l.key === 'coupang_rg|22|')!;
    expect(rg).toMatchObject({ channel: 'coupang_rg', externalProductId: '22', externalOptionKey: '', altProductId: '100', linkMode: 'single' });
  });

  it('색상 옵션은 SKU가 따로다', () => {
    expect(d.skus.map((s) => s.key)).toEqual(expect.arrayContaining(['cp:200:블랙', 'cp:200:레드']));
  });

  it('네이버·토스 리스팅이 쿠팡 SKU와 배수를 이어받는다', () => {
    expect(link('naver', '900', '5001')).toEqual([{ listingKey: 'naver|900|5001', skuKey: 'cp:200:블랙', multiplier: 1 }]);
    expect(link('toss', '800', '블랙 / 1개')[0].skuKey).toBe('cp:200:블랙');
  });

  it('같은 SKU를 가리키는 N:1 리스팅은 연결을 합치고 linkMode single로 두고 정보성 이슈를 남긴다', () => {
    const l = link('naver', '901');
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ skuKey: 'cp:100:', multiplier: 1 });
    expect(d.issues).toContainEqual(expect.objectContaining({ kind: 'multi_vid_listing', ref: 'naver|901|' }));
    expect(d.listings.find((x) => x.key === 'naver|901|')?.linkMode).toBe('single');
  });

  it('레거시 대조 이슈를 만든다', () => {
    const kinds = (k: string) => d.issues.filter((i) => i.kind === k).map((i) => i.ref);
    expect(kinds('sync_link_unresolved')).toEqual(['naver|902|']);
    expect(kinds('legacy_multiplier_mismatch')).toEqual(['coupang_wing|13|']);
    expect(kinds('legacy_listing_unresolved')).toEqual(['coupang_rg|777|']);
    expect(kinds('legacy_spans_skus')).toEqual(['pc-wagon']);
    expect(kinds('sale_attribution_mismatch')).toEqual(['coupang_wing|32|']);
    expect(kinds('legacy_duplicate')).toEqual(['pc-dup1,pc-dup2']);
  });

  it('SKU에 레거시 product_cost를 역참조로 단다', () => {
    expect(sku('cp:100:').legacyProductCostIds).toEqual(['pc-dasu']);
    expect(sku('cp:200:블랙').legacyProductCostIds).toEqual(['pc-wagon']);
  });

  it('나누어떨어지지 않는 수량은 원래 수량을 배수로 두고 이슈를 남긴다', () => {
    const d2 = buildDraft({
      ...base,
      coupangProducts: [{ sellerProductId: 1, productName: 'p', items: [
        { itemName: '2개', wingVid: 1, rgVid: null }, { itemName: '3개', wingVid: 2, rgVid: null },
      ] }],
      syncLinks: [], legacyChannels: [], legacyProductCosts: [], saleAttributions: [],
    });
    expect(d2.links.find((l) => l.listingKey === 'coupang_wing|2|')!.multiplier).toBe(3);
    expect(d2.issues).toContainEqual(expect.objectContaining({ kind: 'uneven_multiplier', ref: 'cp:1:' }));
  });

  // --- 코드 리뷰 반영: Critical(any_of) ---
  it('[리뷰 Critical] 리스팅이 서로 다른 SKU를 가리키면 linkMode any_of로 두고 정보성 이슈를 남긴다', () => {
    const d3 = buildDraft({
      ...base,
      syncLinks: [
        ...base.syncLinks,
        { coupangVid: 11, channel: 'naver', productId: 903, optionKey: '', label: '다슈+왜건 묶음' },
        { coupangVid: 31, channel: 'naver', productId: 903, optionKey: '', label: '다슈+왜건 묶음' },
      ],
    });
    const listing = d3.listings.find((l) => l.key === 'naver|903|')!;
    expect(listing.linkMode).toBe('any_of');
    const skusOfListing = d3.links.filter((l) => l.listingKey === 'naver|903|').map((l) => l.skuKey).sort();
    expect(skusOfListing).toEqual(['cp:100:', 'cp:200:블랙']);
    expect(d3.issues).toContainEqual(expect.objectContaining({ kind: 'any_of_listing', ref: 'naver|903|' }));
    // any_of는 multi_vid_listing(같은 SKU 여러 vid)과는 다른 의미이므로 이 리스팅에는 남지 않는다
    expect(d3.issues.filter((i) => i.kind === 'multi_vid_listing' && i.ref === 'naver|903|')).toEqual([]);
  });

  // --- I1: sync 그룹 부분 해결 ---
  it('[리뷰 I1] sync 그룹의 vid 일부만 못 찾으면 리스팅은 만들고 이슈 detail에 (일부)를 남긴다', () => {
    const d4 = buildDraft({
      ...base,
      syncLinks: [
        ...base.syncLinks,
        { coupangVid: 11, channel: 'naver', productId: 904, optionKey: '', label: '부분 해결' },
        { coupangVid: 12345, channel: 'naver', productId: 904, optionKey: '', label: '부분 해결' },
      ],
    });
    expect(d4.listings.find((l) => l.key === 'naver|904|')).toBeDefined();
    expect(d4.links.find((l) => l.listingKey === 'naver|904|')).toMatchObject({ skuKey: 'cp:100:', multiplier: 1 });
    const issue = d4.issues.find((i) => i.kind === 'sync_link_unresolved' && i.ref === 'naver|904|');
    expect(issue?.detail).toContain('(일부)');
    // 전부 못 찾는 기존 케이스는 여전히 (일부) 없이 남고 리스팅도 안 만든다
    const allUnresolved = d4.issues.find((i) => i.kind === 'sync_link_unresolved' && i.ref === 'naver|902|');
    expect(allUnresolved?.detail).not.toContain('(일부)');
    expect(d4.listings.find((l) => l.key === 'naver|902|')).toBeUndefined();
  });

  // --- I2: 토스 옵션 수량 대조 ---
  it('[리뷰 I2] 토스 옵션 수량이 쿠팡 수량과 다르면 channel_quantity_mismatch를 남긴다', () => {
    const d5 = buildDraft({
      ...base,
      syncLinks: [
        ...base.syncLinks,
        { coupangVid: 12, channel: 'toss', productId: 801, optionKey: '3개', label: '토스 수량 불일치' },
      ],
    });
    expect(d5.issues).toContainEqual(expect.objectContaining({ kind: 'channel_quantity_mismatch', ref: 'toss|801|3개' }));
    // 일치하는 기존 토스 리스팅(800)에는 안 남는다
    expect(d5.issues.filter((i) => i.kind === 'channel_quantity_mismatch' && i.ref.startsWith('toss|800|'))).toEqual([]);
  });

  // --- I3: pcByVid 재구성 · legacy_vid_multi_mapped ---
  it('[리뷰 I3] 쿠팡 옵션 하나를 옛 원가 행 여러 개가 가리키면 legacy_vid_multi_mapped를 남긴다', () => {
    const d6 = buildDraft({
      ...base,
      legacyChannels: [...base.legacyChannels, { productCostId: 'pc-dasu2', channelType: 'coupang_wing', externalId: 12, unitMultiplier: 2 }],
    });
    expect(d6.issues).toContainEqual(expect.objectContaining({ kind: 'legacy_vid_multi_mapped', ref: 'coupang_wing|12|' }));
  });

  // --- M2: 수량 0 보정 ---
  it('[리뷰 M2] 수량이 0으로 파싱되면 quantity_invalid를 남기고 1로 보정한다', () => {
    const d7 = buildDraft({
      coupangProducts: [{ sellerProductId: 501, productName: 'zero', items: [{ itemName: '0개', wingVid: 501, rgVid: null }] }],
      syncLinks: [], legacyChannels: [], legacyProductCosts: [], saleAttributions: [],
    });
    expect(d7.issues).toContainEqual(expect.objectContaining({ kind: 'quantity_invalid', ref: 'cp:501:' }));
    expect(d7.links.find((l) => l.listingKey === 'coupang_wing|501|')?.multiplier).toBe(1);
  });

  // --- suspect_merge ---
  it('[리뷰] 속성 기반 그룹의 itemName 잔여가 2종 이상이면 suspect_merge를 남긴다', () => {
    const d8 = buildDraft({
      coupangProducts: [{
        sellerProductId: 601,
        productName: 'x',
        items: [
          { itemName: '블랙 1개', attributes: [{ attributeTypeName: '색상', attributeValueName: '블랙' }, { attributeTypeName: '수량', attributeValueName: '1개' }], wingVid: 611, rgVid: null },
          { itemName: '네이비 2개', attributes: [{ attributeTypeName: '색상', attributeValueName: '블랙' }, { attributeTypeName: '수량', attributeValueName: '2개' }], wingVid: 612, rgVid: null },
        ],
      }],
      syncLinks: [], legacyChannels: [], legacyProductCosts: [], saleAttributions: [],
    });
    expect(d8.issues).toContainEqual(expect.objectContaining({ kind: 'suspect_merge', ref: 'cp:601:블랙' }));
  });

  it('[리뷰] 그룹 안 수량이 중복되면 suspect_merge를 남긴다', () => {
    const d9 = buildDraft({
      coupangProducts: [{
        sellerProductId: 701,
        productName: 'y',
        items: [
          { itemName: '1개', wingVid: 711, rgVid: null },
          { itemName: '1개', wingVid: 712, rgVid: null },
        ],
      }],
      syncLinks: [], legacyChannels: [], legacyProductCosts: [], saleAttributions: [],
    });
    expect(d9.issues).toContainEqual(expect.objectContaining({ kind: 'suspect_merge', ref: 'cp:701:' }));
  });
});

describe('applyOverrides', () => {
  it('SKU 병합·배수 지정·리스팅 제외·이름·기준 단위·보관을 적용한다', () => {
    const d = applyOverrides(buildDraft(base), {
      mergeSkus: [['cp:200:블랙', 'cp:200:레드']],
      setMultiplier: [{ listingKey: 'coupang_wing|13|', skuKey: 'cp:100:', multiplier: 2 }],
      // naver|902|는 vid99가 초안에서 끝내 못 찾아 리스팅으로 만들어진 적이 없다(sync_link_unresolved 전체 미해결) —
      // 리뷰 I4로 excludeListings가 "존재하지 않는 리스팅"을 던지게 되어, 실제 존재하는 리스팅으로 바꿔 검증한다.
      excludeListings: ['toss|800|블랙 / 1개'],
      rename: { 'cp:100:': '다슈 울트라 홀딩 왁스' },
      baseUnit: { 'cp:100:': '1개' },
      archive: [],
    });
    expect(d.skus.find((s) => s.key === 'cp:200:레드')).toBeUndefined();
    expect(d.links.find((l) => l.listingKey === 'coupang_wing|32|')!.skuKey).toBe('cp:200:블랙');
    expect(d.links.find((l) => l.listingKey === 'coupang_wing|13|')!.multiplier).toBe(2);
    expect(d.listings.find((l) => l.key === 'toss|800|블랙 / 1개')).toBeUndefined();
    expect(d.skus.find((s) => s.key === 'cp:100:')).toMatchObject({ name: '다슈 울트라 홀딩 왁스', baseUnitLabel: '1개' });
  });

  it('없는 키를 가리키면 오류를 던진다', () => {
    expect(() => applyOverrides(buildDraft(base), {
      mergeSkus: [['cp:200:블랙', 'cp:없음']], setMultiplier: [], excludeListings: [], rename: {}, baseUnit: {}, archive: [],
    })).toThrow('cp:없음');
  });

  // --- I4: 검증 강화 ---
  it('[리뷰 I4] mergeSkus에서 SKU를 자기 자신으로 병합하면 던진다', () => {
    expect(() => applyOverrides(buildDraft(base), {
      mergeSkus: [['cp:200:블랙', 'cp:200:블랙']], setMultiplier: [], excludeListings: [], rename: {}, baseUnit: {}, archive: [],
    })).toThrow();
  });

  it('[리뷰 I4] excludeListings가 없는 리스팅을 가리키면 던진다', () => {
    expect(() => applyOverrides(buildDraft(base), {
      mergeSkus: [], setMultiplier: [], excludeListings: ['naver|없음|'], rename: {}, baseUnit: {}, archive: [],
    })).toThrow('naver|없음|');
  });

  it('[리뷰 I4] setMultiplier 값이 양의 정수가 아니면 던진다', () => {
    expect(() => applyOverrides(buildDraft(base), {
      mergeSkus: [], setMultiplier: [{ listingKey: 'coupang_wing|13|', skuKey: 'cp:100:', multiplier: 0 }], excludeListings: [], rename: {}, baseUnit: {}, archive: [],
    })).toThrow();
    expect(() => applyOverrides(buildDraft(base), {
      mergeSkus: [], setMultiplier: [{ listingKey: 'coupang_wing|13|', skuKey: 'cp:100:', multiplier: 1.5 }], excludeListings: [], rename: {}, baseUnit: {}, archive: [],
    })).toThrow();
  });

  // --- I5: 병합 후 배수 충돌은 조용히 min을 고르지 않는다 ---
  it('[리뷰 I5] 병합 후 같은 리스팅→SKU 연결의 배수가 다르면 던진다', () => {
    const manual: Draft = {
      skus: [
        { key: 'a', name: 'A', optionLabel: '', baseUnitLabel: null, status: 'active', legacyProductCostIds: [] },
        { key: 'b', name: 'B', optionLabel: '', baseUnitLabel: null, status: 'active', legacyProductCostIds: [] },
      ],
      listings: [{ key: 'naver|1|', channel: 'naver', externalProductId: '1', externalOptionKey: '', altProductId: null, label: null, linkMode: 'any_of' }],
      links: [
        { listingKey: 'naver|1|', skuKey: 'a', multiplier: 1 },
        { listingKey: 'naver|1|', skuKey: 'b', multiplier: 2 },
      ],
      issues: [],
    };
    expect(() => applyOverrides(manual, { mergeSkus: [['a', 'b']], setMultiplier: [], excludeListings: [], rename: {}, baseUnit: {}, archive: [] }))
      .toThrow(/배수가 다르다/);
  });

  // --- 항목 9: splitListing · 필드 누락 기본값 ---
  it('[리뷰 9] splitListing으로 리스팅의 연결을 다른 SKU로 옮긴다(없으면 새로 만든다)', () => {
    const raw = buildDraft({
      ...base,
      syncLinks: [
        ...base.syncLinks,
        { coupangVid: 11, channel: 'naver', productId: 903, optionKey: '', label: '다슈+왜건 묶음' },
        { coupangVid: 31, channel: 'naver', productId: 903, optionKey: '', label: '다슈+왜건 묶음' },
      ],
    });
    expect(raw.issues).toContainEqual(expect.objectContaining({ kind: 'any_of_listing', ref: 'naver|903|' }));

    const d = applyOverrides(raw, {
      splitListing: [{ listingKey: 'naver|903|', toSkuKey: 'cp:200:블랙-단독', name: '왜건 블랙 단독', optionLabel: '블랙' }],
    });
    expect(d.links.filter((l) => l.listingKey === 'naver|903|').map((l) => l.skuKey)).toEqual(['cp:200:블랙-단독']);
    expect(d.skus.find((s) => s.key === 'cp:200:블랙-단독')).toMatchObject({ name: '왜건 블랙 단독', optionLabel: '블랙' });
  });

  it('[리뷰 후속] any_of 리스팅을 splitListing으로 한 SKU로 모으면 linkMode가 single로 재계산된다', () => {
    const raw = buildDraft({
      ...base,
      syncLinks: [
        ...base.syncLinks,
        { coupangVid: 11, channel: 'naver', productId: 903, optionKey: '', label: '다슈+왜건 묶음' },
        { coupangVid: 31, channel: 'naver', productId: 903, optionKey: '', label: '다슈+왜건 묶음' },
      ],
    });
    expect(raw.listings.find((l) => l.key === 'naver|903|')?.linkMode).toBe('any_of');

    const d = applyOverrides(raw, {
      splitListing: [{ listingKey: 'naver|903|', toSkuKey: 'cp:200:블랙-단독', name: '왜건 블랙 단독', optionLabel: '블랙' }],
    });
    expect(d.listings.find((l) => l.key === 'naver|903|')?.linkMode).toBe('single');
  });

  it('[리뷰 9] overrides 필드가 없으면 빈 배열·객체로 취급해 원본을 그대로 돌려준다', () => {
    const raw = buildDraft(base);
    const d = applyOverrides(raw, {});
    expect(d.skus).toEqual(raw.skus);
    expect(d.links).toEqual(raw.links);
    expect(d.listings).toEqual(raw.listings);
  });
});
