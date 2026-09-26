import { describe, it, expect } from 'vitest';
import { blockedLines, linesNeedingPhone, preOpeningNotice, splitSum, toSkuSplits, type LineSkuOptions } from '@/components/receipt/sku-split';

const c = (skuId: number, option: string) => ({ skuId, key: `k${skuId}`, name: '라운드티', option });

describe('toSkuSplits', () => {
  const options: Record<number, LineSkuOptions> = {
    1: { source: 'learned', candidates: [c(11, '블랙')], expectedQty: { qty: 2, approx: false } },
    2: { source: 'product', candidates: [c(21, 'S'), c(22, 'L')], expectedQty: { qty: 3, approx: false } },
    3: { source: 'none', candidates: [], expectedQty: { qty: 1, approx: false } },
    4: { source: 'none', candidates: [], expectedQty: null },
  };

  it('후보 1개는 생략(서버 자동) · 여럿은 옵션별 수량 · 고른 SKU 1개는 전부(null) · 고르지 않았으면 생략', () => {
    expect(toSkuSplits(options, {
      2: { picked: [], qty: { 21: '2', 22: '1' } },
      3: { picked: [c(31, '')], qty: {} },
    })).toEqual({
      2: [{ sku_id: 21, qty: 2 }, { sku_id: 22, qty: 1 }],
      3: [{ sku_id: 31, qty: null }],
    });
  });

  it('고른 SKU가 여럿이면 옵션별 수량', () => {
    expect(toSkuSplits({ 3: options[3] }, { 3: { picked: [c(31, 'S'), c(32, 'L')], qty: { 31: '1' } } }))
      .toEqual({ 3: [{ sku_id: 31, qty: 1 }, { sku_id: 32, qty: 0 }] });
  });

  it('🔴 후보 1개 줄에서 「다른 SKU로 바꾸기」를 고르면 manual 표시로 보낸다', () => {
    expect(toSkuSplits({ 1: options[1] }, { 1: { picked: [], qty: {}, override: c(99, '') } }))
      .toEqual({ 1: [{ sku_id: 99, qty: null, manual: true }] });
  });

  it('나눈 합', () => {
    expect(splitSum([c(21, 'S'), c(22, 'L')], { picked: [], qty: { 21: '2', 22: 'x' } })).toBe(2);
  });
});

describe('blockedLines — 확정 전 검사', () => {
  const opt = (candidates: ReturnType<typeof c>[], qty: number | null, approx = false): LineSkuOptions =>
    ({ source: candidates.length ? 'product' : 'none', candidates, expectedQty: qty === null ? null : { qty, approx } });

  it('옵션별 합이 입고 수량과 다르거나, 후보 없는 줄을 고르지 않았으면 그 줄 번호', () => {
    const options = {
      1: opt([c(11, '블랙')], 2),               // 자동 — 통과
      2: opt([c(21, 'S'), c(22, 'L')], 3),     // 합 2 ≠ 3 — 막힘
      3: opt([], 1),                            // 고르지 않음 — 막힘
      4: opt([c(41, 'S'), c(42, 'L')], 2),     // 합 2 = 2 — 통과
      5: opt([c(51, 'S'), c(52, 'L')], 4, true), // 소분 추정 — 서버가 판단
      6: opt([], 2),                            // 하나 고름 — 통과
    };
    expect(blockedLines(options, {
      2: { picked: [], qty: { 21: '2' } },
      4: { picked: [], qty: { 41: '1', 42: '1' } },
      6: { picked: [c(61, '')], qty: {} },
    })).toEqual([2, 3]);
  });

  it('추정 수량이어도 후보 없는 줄을 고르지 않았으면 막는다', () => {
    expect(blockedLines({ 1: opt([], 3, true) }, {})).toEqual([1]);
  });
});

describe('linesNeedingPhone (PC 모달이 확정을 막을 줄)', () => {
  it('🔴 후보가 0개이거나 2개 이상인 줄 — 나눌 수량을 모르는 소분 추정 줄도 포함한다', () => {
    const options: Record<number, LineSkuOptions> = {
      1: { source: 'learned', candidates: [c(11, '블랙')], expectedQty: { qty: 2, approx: false } },
      2: { source: 'product', candidates: [c(21, 'S'), c(22, 'L')], expectedQty: { qty: 3, approx: false } },
      3: { source: 'none', candidates: [], expectedQty: { qty: 1, approx: false } },
      4: { source: 'product', candidates: [c(41, 'S'), c(42, 'L')], expectedQty: { qty: 6, approx: true } },
    };
    expect(linesNeedingPhone(options)).toEqual([2, 3, 4]);
    // 나누기·고르기 전 blockedLines와 같다(소분 추정 줄은 blockedLines가 서버에 맡기지만 PC에는 나누기 화면이 없다)
    expect(blockedLines(options, {})).toEqual([2, 3]);
  });
  it('후보 하나뿐이면 빈 배열', () => {
    expect(linesNeedingPhone({ 1: { source: 'learned', candidates: [c(11, '블랙')], expectedQty: null } })).toEqual([]);
  });
});

describe('preOpeningNotice', () => {
  it('실사 이전 구매로 건너뛴 SKU 이름을 한 줄로', () => {
    expect(preOpeningNotice([{ name: '라운드티 · 블랙' }, { name: '머그컵' }])).toBe('실사 이전 구매라 원장 입고는 건너뜀: 라운드티 · 블랙, 머그컵');
    expect(preOpeningNotice([])).toBeNull();
    expect(preOpeningNotice(undefined)).toBeNull();
  });
});
