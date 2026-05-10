import { describe, expect, it } from 'vitest';
import { extractSalesUnitInfo, normalizeSalesUnitSpecs } from '../sales-unit';

describe('sales-unit', () => {
  it('extracts split-sale count, total amount, and per-unit weight', () => {
    const info = extractSalesUnitInfo([
      { label: '구성', value: '44개입' },
      { label: '총 용량', value: '4.1kg' },
    ]);

    expect(info?.display).toBe('44개입 (총 4.1kg) / 개당 93.2g');
  });

  it('prepends sales unit and prioritizes it in amount-like specs', () => {
    const specs = normalizeSalesUnitSpecs([
      { label: '원재료/함량', value: '총 4.1kg 기준 상세페이지 참조' },
      { label: '입수량', value: '44개입' },
    ]);

    expect(specs[0]).toEqual({ label: '판매 단위', value: '44개입 (총 4.1kg) / 개당 93.2g' });
    expect(specs[1].value).toContain('44개입 (총 4.1kg) / 개당 93.2g 기준');
  });
});
