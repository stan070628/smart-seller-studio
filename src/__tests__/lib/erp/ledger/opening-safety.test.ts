import { describe, it, expect } from 'vitest';
import {
  carryCounts, checkCountedAt, groupSkus, parseCountCsv, resolveOpeningCosts, rgOutsideActive, toCsv,
  type CountRow, type LegacyFacts, type OpeningSku,
} from '@/lib/erp/ledger/opening';

const row = (skuId: number, over: Partial<CountRow> = {}): CountRow => ({
  skuId, skuKey: `k${skuId}`, name: `n${skuId}`, option: '', group: `g${skuId}`, rgActual: 0,
  selfEstimate: null, selfCount: 0, rgInbound: 0, unitCost: null, note: '', ...over,
});

describe('carryCounts', () => {
  it('sku_id로 self_count·rg_inbound·unit_cost·note를 옮기고 새 행은 미리 채운 값을 둔다', () => {
    const fresh = [row(1, { selfCount: 5, rgActual: 3, unitCost: 100, note: '새 메모' }), row(2, { selfCount: null, unitCost: 900 }), row(4, { selfCount: 7 })];
    const prev = [row(1, { selfCount: 2, rgInbound: 1, unitCost: 120, note: '사람 메모', rgActual: 9 }), row(2, { selfCount: 3, unitCost: null }), row(3, { selfCount: 1 })];
    const r = carryCounts(fresh, prev);
    expect(r.rows).toEqual([
      row(1, { selfCount: 2, rgInbound: 1, unitCost: 120, note: '사람 메모', rgActual: 3 }),
      row(2, { selfCount: 3, unitCost: null }),
      row(4, { selfCount: 7 }),
    ]);
    expect(r.carried).toBe(2);
    expect(r.added.map((x) => x.skuId)).toEqual([4]);
    expect(r.dropped.map((x) => x.skuId)).toEqual([3]);
  });
  it('입력 배열을 바꾸지 않는다', () => {
    const fresh = [row(1, { selfCount: 5 })];
    carryCounts(fresh, [row(1, { selfCount: 2 })]);
    expect(fresh[0].selfCount).toBe(5);
  });
});

describe('parseCountCsv 중복 sku_id', () => {
  it('같은 sku_id가 두 번 나오면 던진다', () => {
    expect(() => parseCountCsv(toCsv([row(1), row(2), row(1)]))).toThrow(/sku_id 1.*중복/);
  });
});

describe('toCsv 줄바꿈', () => {
  it('값 안의 \\r·\\n은 공백으로 바꿔 한 줄을 지킨다', () => {
    const text = toCsv([row(1, { note: '첫줄\r\n둘째줄\n셋째' })]);
    expect(text.split('\n').filter((l) => l !== '')).toHaveLength(2);
    expect(parseCountCsv(text)[0].note).toBe('첫줄  둘째줄 셋째');
  });
});

describe('checkCountedAt', () => {
  const now = new Date('2026-09-27T10:00:00+09:00');
  it('없으면 오류', () => expect(checkCountedAt(undefined, now)).toMatch(/countedAt/));
  it('오프셋 없는 ISO는 오류', () => expect(checkCountedAt('2026-09-27T09:00:00', now)).toMatch(/오프셋/));
  it('24시간 넘으면 오류', () => expect(checkCountedAt('2026-09-26T09:59:00+09:00', now)).toMatch(/24시간/));
  it('미래 시각은 오류', () => expect(checkCountedAt('2026-09-27T11:00:00+09:00', now)).toMatch(/미래/));
  it('24시간 이내면 null', () => {
    expect(checkCountedAt('2026-09-26T10:00:00+09:00', now)).toBeNull();
    expect(checkCountedAt('2026-09-27T00:30:00Z', now)).toBeNull();
  });
});

describe('rgOutsideActive', () => {
  it('활성 SKU 밖의 RG 재고를 SKU id 순으로', () => {
    expect(rgOutsideActive(new Map([[9, 2], [1, 3], [5, 1]]), new Set([1]))).toEqual([{ skuId: 5, qty: 1 }, { skuId: 9, qty: 2 }]);
  });
});

describe('resolveOpeningCosts', () => {
  const skus: OpeningSku[] = [
    { id: 1, key: 'a', name: 'A', optionLabel: '', legacyProductCostIds: ['pc-a'] },
    { id: 2, key: 'b1', name: 'B', optionLabel: '1', legacyProductCostIds: ['pc-b'], baseUnitLabel: '6개입 1팩' },
    { id: 3, key: 'b2', name: 'B', optionLabel: '2', legacyProductCostIds: ['pc-b'], baseUnitLabel: '6개입 1팩' },
    { id: 4, key: 'c', name: 'C', optionLabel: '', legacyProductCostIds: [] },
    { id: 5, key: 'd', name: 'D', optionLabel: '', legacyProductCostIds: [] },
  ];
  const legacy: LegacyFacts[] = [
    { productCostId: 'pc-a', entries: [{ receivedAt: '2026-01-01', quantity: 10, unitCost: 100 }, { receivedAt: '2026-02-01', quantity: 2, unitCost: 160 }], soldQty: 0, voidedQty: 0 },
    { productCostId: 'pc-b', entries: [{ receivedAt: '2026-01-01', quantity: 10, unitCost: 500 }], soldQty: 0, voidedQty: 0 },
  ];
  const rows = [
    row(1, { skuKey: 'a', selfCount: 3, unitCost: 999 }),
    row(2, { skuKey: 'b1', selfCount: 1, rgInbound: 1, unitCost: 500 }),
    row(3, { skuKey: 'b2', selfCount: 0, unitCost: 500 }),
    row(4, { skuKey: 'c', selfCount: 2, unitCost: 700 }),
    row(5, { skuKey: 'd', selfCount: 1, unitCost: null }),
  ];
  const r = resolveOpeningCosts(skus, groupSkus(skus), legacy, rows, new Map([[1, 1], [3, 2]]), { b2: 450 });

  it('단가 우선순위: 덮어쓰기 > 이력(실사 보유 수량 기준) > CSV', () => {
    const by = new Map(r.costs.map((c) => [c.skuId, c]));
    // SKU 1: 보유 3+1=4 → 최근 2개 160 + 다음 2개 100 = 130
    expect(by.get(1)).toMatchObject({ unitCost: 130, source: 'history', csvCost: 999, onHand: 4 });
    expect(by.get(2)).toMatchObject({ unitCost: 500, source: 'history' });
    expect(by.get(3)).toMatchObject({ unitCost: 450, source: 'override' });
    expect(by.get(4)).toMatchObject({ unitCost: 700, source: 'csv' });
    expect(by.get(5)).toMatchObject({ unitCost: null, source: 'none', onHand: 1 });
  });
  it('CSV와 다른 단가 목록 · 기준 단위 확인 목록 · 단가 없는 재고', () => {
    expect(r.changed.map((c) => c.skuId)).toEqual([1, 3]);
    expect(r.baseUnitCheck.map((c) => c.skuId)).toEqual([2]);
    expect(r.missing.map((c) => c.skuId)).toEqual([5]);
  });
});
