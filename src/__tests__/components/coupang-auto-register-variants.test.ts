import { describe, it, expect } from 'vitest';
import { buildVariantsFromOptions } from '@/components/listing/workflow/CoupangAutoRegisterPanel';
import type { ProductOptions } from '@/types/product-option';

// 헬퍼: 기본 옵션 픽스처 생성
function makeOptions(overrides?: Partial<ProductOptions>): ProductOptions {
  return {
    hasOptions: true,
    groups: [{ order: 0, groupName: '사이즈', values: ['M', 'L'] }],
    variants: [
      {
        variantId: 'v_00',
        optionValues: ['M'],
        sourceHash: 'hash1',
        costPrice: 30000,
        salePrices: { coupang: 20000, naver: 19000 },
        stock: 50,
        soldOut: false,
        hidden: false,
        enabled: true,
      },
      {
        variantId: 'v_01',
        optionValues: ['L'],
        sourceHash: 'hash2',
        costPrice: 30000,
        salePrices: { coupang: 21000, naver: 20000 },
        stock: 30,
        soldOut: false,
        hidden: false,
        enabled: true,
      },
    ],
    ...overrides,
  };
}

describe('buildVariantsFromOptions', () => {
  it('options가 null이면 undefined 반환', () => {
    expect(buildVariantsFromOptions(null)).toBeUndefined();
  });

  it('options가 undefined이면 undefined 반환', () => {
    expect(buildVariantsFromOptions(undefined)).toBeUndefined();
  });

  it('enabled variant가 없으면 undefined 반환', () => {
    const options = makeOptions({
      variants: [
        {
          variantId: 'v_00',
          optionValues: ['M'],
          sourceHash: null,
          costPrice: 30000,
          salePrices: { coupang: 20000, naver: 19000 },
          stock: 0,
          soldOut: true,
          hidden: false,
          enabled: false,
        },
      ],
    });
    expect(buildVariantsFromOptions(options)).toBeUndefined();
  });

  it('enabled variants를 DraftVariant[]로 변환한다', () => {
    const options = makeOptions();
    const result = buildVariantsFromOptions(options);

    expect(result).toHaveLength(2);

    expect(result![0]).toEqual({
      itemName: 'M',
      attributes: [{ attributeTypeName: '사이즈', attributeValueName: 'M' }],
      salePrice: 20000,
      originalPrice: 25000, // ceil(20000 * 1.25 / 1000) * 1000 = 25000
      stock: 50,
    });

    expect(result![1]).toEqual({
      itemName: 'L',
      attributes: [{ attributeTypeName: '사이즈', attributeValueName: 'L' }],
      salePrice: 21000,
      originalPrice: 27000, // ceil(21000 * 1.25 / 1000) * 1000 = 27000 (26250 → 1000단위 올림)
      stock: 30,
    });
  });

  it('enabled=false인 variant는 제외한다', () => {
    const options = makeOptions({
      variants: [
        {
          variantId: 'v_00',
          optionValues: ['M'],
          sourceHash: null,
          costPrice: 30000,
          salePrices: { coupang: 20000, naver: 19000 },
          stock: 50,
          soldOut: false,
          hidden: false,
          enabled: true,
        },
        {
          variantId: 'v_01',
          optionValues: ['L'],
          sourceHash: null,
          costPrice: 30000,
          salePrices: { coupang: 21000, naver: 20000 },
          stock: 0,
          soldOut: true,
          hidden: false,
          enabled: false,
        },
      ],
    });
    const result = buildVariantsFromOptions(options);
    expect(result).toHaveLength(1);
    expect(result![0].itemName).toBe('M');
  });

  it('2축 옵션(색상+사이즈)의 itemName은 슬래시로 조합된다', () => {
    const options: ProductOptions = {
      hasOptions: true,
      groups: [
        { order: 0, groupName: '색상', values: ['블랙', '화이트'] },
        { order: 1, groupName: '사이즈', values: ['M', 'L'] },
      ],
      variants: [
        {
          variantId: 'v_00_00',
          optionValues: ['블랙', 'M'],
          sourceHash: null,
          costPrice: 30000,
          salePrices: { coupang: 20000, naver: 19000 },
          stock: 50,
          soldOut: false,
          hidden: false,
          enabled: true,
        },
      ],
    };
    const result = buildVariantsFromOptions(options);
    expect(result![0].itemName).toBe('블랙/M');
    expect(result![0].attributes).toEqual([
      { attributeTypeName: '색상', attributeValueName: '블랙' },
      { attributeTypeName: '사이즈', attributeValueName: 'M' },
    ]);
  });
});
