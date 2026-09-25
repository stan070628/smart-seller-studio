import { describe, it, expect } from 'vitest';
import { optionKeyOf } from '@/lib/erp/sku/option-key';

describe('optionKeyOf', () => {
  it('속성의 수량 값을 수량으로, 나머지를 옵션으로 본다', () => {
    expect(optionKeyOf({
      itemName: '블랙 1개',
      attributes: [
        { attributeTypeName: '색상', attributeValueName: '블랙' },
        { attributeTypeName: '수량', attributeValueName: '1개' },
      ],
    })).toEqual({ option: '블랙', quantity: 1 });
  });

  it('속성이 없으면 itemName 끝의 N개·N팩을 뗀다', () => {
    expect(optionKeyOf({ itemName: '2개' })).toEqual({ option: '', quantity: 2 });
    expect(optionKeyOf({ itemName: '12팩' })).toEqual({ option: '', quantity: 12 });
    expect(optionKeyOf({ itemName: '750ml 2개' })).toEqual({ option: '750ml', quantity: 2 });
  });

  it('N개입·용량·중량은 내용물 표시라 옵션에 남긴다', () => {
    expect(optionKeyOf({ itemName: '1개 2개입' })).toEqual({ option: '2개입', quantity: 1 });
    expect(optionKeyOf({ itemName: '45g 7팩' })).toEqual({ option: '45g', quantity: 7 });
  });

  it('수량을 뗀 뒤 남은 구분자를 걷어낸다', () => {
    expect(optionKeyOf({ itemName: '네이비 / L(100) / 1개' })).toEqual({ option: '네이비 / L(100)', quantity: 1 });
  });

  it('수량이 없으면 1이고 옵션은 공백을 정리한 itemName이다', () => {
    expect(optionKeyOf({ itemName: '  L(100)   네이비 ' })).toEqual({ option: 'L(100) 네이비', quantity: 1 });
    expect(optionKeyOf({ itemName: '' })).toEqual({ option: '', quantity: 1 });
  });

  it('여러 속성은 속성명 순서가 아니라 들어온 순서대로 / 로 잇는다', () => {
    expect(optionKeyOf({
      itemName: 'x',
      attributes: [
        { attributeTypeName: '사이즈', attributeValueName: 'L' },
        { attributeTypeName: '색상', attributeValueName: '네이비' },
        { attributeTypeName: '총 수량', attributeValueName: '3개' },
      ],
    })).toEqual({ option: 'L / 네이비', quantity: 3 });
  });

  it('수량 속성 값에 숫자가 없으면 1로 본다', () => {
    expect(optionKeyOf({
      itemName: 'x',
      attributes: [{ attributeTypeName: '수량', attributeValueName: '단품' }],
    })).toEqual({ option: '', quantity: 1 });
  });

  it('정확히 「수량」인 속성을 다른 수량류 속성보다 우선한다', () => {
    expect(optionKeyOf({
      itemName: 'x',
      attributes: [
        { attributeTypeName: '총 수량', attributeValueName: '20매' },
        { attributeTypeName: '색상', attributeValueName: '블랙' },
        { attributeTypeName: '수량', attributeValueName: '2개' },
      ],
    })).toEqual({ option: '20매 / 블랙', quantity: 2 });
  });

  it('수량 앞의 x·×·*·+ 구분자를 걷어낸다', () => {
    expect(optionKeyOf({ itemName: '500ml x 2개' })).toEqual({ option: '500ml', quantity: 2 });
    expect(optionKeyOf({ itemName: '500ml × 2개' })).toEqual({ option: '500ml', quantity: 2 });
    expect(optionKeyOf({ itemName: '사이즈 2X' })).toEqual({ option: '사이즈 2X', quantity: 1 });
  });
});
