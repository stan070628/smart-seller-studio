import { describe, it, expect } from 'vitest';
import { buildDraft, applyOverrides, type DraftInput } from '@/lib/erp/sku/draft';

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
    expect(rg).toMatchObject({ channel: 'coupang_rg', externalProductId: '22', externalOptionKey: '', altProductId: '100' });
  });

  it('색상 옵션은 SKU가 따로다', () => {
    expect(d.skus.map((s) => s.key)).toEqual(expect.arrayContaining(['cp:200:블랙', 'cp:200:레드']));
  });

  it('네이버·토스 리스팅이 쿠팡 SKU와 배수를 이어받는다', () => {
    expect(link('naver', '900', '5001')).toEqual([{ listingKey: 'naver|900|5001', skuKey: 'cp:200:블랙', multiplier: 1 }]);
    expect(link('toss', '800', '블랙 / 1개')[0].skuKey).toBe('cp:200:블랙');
  });

  it('N:1 리스팅은 이어받은 연결을 합치고 정보성 이슈를 남긴다', () => {
    const l = link('naver', '901');
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ skuKey: 'cp:100:', multiplier: 1 });
    expect(d.issues).toContainEqual(expect.objectContaining({ kind: 'multi_vid_listing', ref: 'naver|901|' }));
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
});

describe('applyOverrides', () => {
  it('SKU 병합·배수 지정·리스팅 제외·이름·기준 단위·보관을 적용한다', () => {
    const d = applyOverrides(buildDraft(base), {
      mergeSkus: [['cp:200:블랙', 'cp:200:레드']],
      setMultiplier: [{ listingKey: 'coupang_wing|13|', skuKey: 'cp:100:', multiplier: 2 }],
      excludeListings: ['naver|902|'],
      rename: { 'cp:100:': '다슈 울트라 홀딩 왁스' },
      baseUnit: { 'cp:100:': '1개' },
      archive: [],
    });
    expect(d.skus.find((s) => s.key === 'cp:200:레드')).toBeUndefined();
    expect(d.links.find((l) => l.listingKey === 'coupang_wing|32|')!.skuKey).toBe('cp:200:블랙');
    expect(d.links.find((l) => l.listingKey === 'coupang_wing|13|')!.multiplier).toBe(2);
    expect(d.listings.find((l) => l.key === 'naver|902|')).toBeUndefined();
    expect(d.skus.find((s) => s.key === 'cp:100:')).toMatchObject({ name: '다슈 울트라 홀딩 왁스', baseUnitLabel: '1개' });
  });

  it('없는 키를 가리키면 오류를 던진다', () => {
    expect(() => applyOverrides(buildDraft(base), {
      mergeSkus: [['cp:200:블랙', 'cp:없음']], setMultiplier: [], excludeListings: [], rename: {}, baseUnit: {}, archive: [],
    })).toThrow('cp:없음');
  });
});
