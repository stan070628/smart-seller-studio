import { describe, it, expect } from 'vitest';
import { getTariffRate, calcImportTax, DEFAULT_TARIFF_RATE } from '@/lib/sourcing/tariff';

describe('getTariffRate', () => {
  it('의류는 13%다', () => {
    expect(getTariffRate('의류')).toBe(0.13);
    expect(getTariffRate('수영복')).toBe(0.13);
    expect(getTariffRate('신발류')).toBe(0.13);
  });

  it('장갑·가방·액세서리는 8%다', () => {
    expect(getTariffRate('장갑')).toBe(0.08);
    expect(getTariffRate('가방')).toBe(0.08);
    expect(getTariffRate('액세서리')).toBe(0.08);
  });

  it('부분 문자열로도 매칭된다', () => {
    expect(getTariffRate('방한 장갑')).toBe(0.08);
    expect(getTariffRate('겨울 의류 세트')).toBe(0.13);
  });

  it('모르는 카테고리는 기본값 8%다', () => {
    expect(getTariffRate('캠핑용품')).toBe(DEFAULT_TARIFF_RATE);
    expect(getTariffRate(null)).toBe(DEFAULT_TARIFF_RATE);
  });
});

describe('calcImportTax', () => {
  it('과세가격에 운임이 포함된다', () => {
    // 상품가 10,000 + 운임 322 = 과세가격 10,322
    const r = calcImportTax({ goodsKrw: 10000, dutiableFreightKrw: 322, tariffRate: 0.08 });
    expect(r.dutiableValueKrw).toBe(10322);
  });

  it('장갑 8% — 관세 826원, 부가세 1,115원', () => {
    const r = calcImportTax({ goodsKrw: 10000, dutiableFreightKrw: 322, tariffRate: 0.08 });
    expect(r.tariffKrw).toBe(826);
    expect(r.importVatKrw).toBe(1115);
    expect(r.totalKrw).toBe(12263);
  });

  it('의류 13% — 관세 1,342원, 부가세 1,166원', () => {
    const r = calcImportTax({ goodsKrw: 10000, dutiableFreightKrw: 322, tariffRate: 0.13 });
    expect(r.tariffKrw).toBe(1342);
    expect(r.importVatKrw).toBe(1166);
    expect(r.totalKrw).toBe(12830);
  });

  it('운임이 0이면 상품가만 과세된다', () => {
    const r = calcImportTax({ goodsKrw: 10000, dutiableFreightKrw: 0, tariffRate: 0.08 });
    expect(r.dutiableValueKrw).toBe(10000);
    expect(r.tariffKrw).toBe(800);
  });
});
