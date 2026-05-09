import { describe, it, expect } from 'vitest';
import {
  calculateWeightedAvg,
  calculateProductMetrics,
  distributeShippingFee,
  type CostEntryRow,
} from '@/lib/cost-management/calculations';

const makeEntry = (overrides: Partial<CostEntryRow>): CostEntryRow => ({
  id: 'e1',
  product_cost_id: 'p1',
  received_at: '2026-05-01',
  quantity: 10,
  unit_cost: 10000,
  unit_shipping_fee: 1000,
  shipping_group_id: null,
  ...overrides,
});

describe('calculateWeightedAvg', () => {
  it('단일 건 → 해당 값 그대로', () => {
    const entries = [makeEntry({ unit_cost: 15000, quantity: 5 })];
    expect(calculateWeightedAvg(entries, 'unit_cost')).toBe(15000);
  });

  it('두 건 수량 가중 평균', () => {
    const entries = [
      makeEntry({ id: 'e1', unit_cost: 10000, quantity: 3 }),
      makeEntry({ id: 'e2', unit_cost: 20000, quantity: 7 }),
    ];
    // (10000×3 + 20000×7) / 10 = 17000
    expect(calculateWeightedAvg(entries, 'unit_cost')).toBe(17000);
  });

  it('빈 배열 → 0', () => {
    expect(calculateWeightedAvg([], 'unit_cost')).toBe(0);
  });
});

describe('calculateProductMetrics', () => {
  it('정상 계산 — 가중평균·총수량·총매입금액', () => {
    const entries = [
      makeEntry({ unit_cost: 10000, unit_shipping_fee: 1000, quantity: 10 }),
    ];
    const metrics = calculateProductMetrics(entries);
    // weighted_avg_cost = 10000, weighted_avg_shipping = 1000
    // total_quantity = 10, total_purchase_amount = 100000
    expect(metrics.weighted_avg_cost).toBe(10000);
    expect(metrics.weighted_avg_shipping).toBe(1000);
    expect(metrics.total_quantity).toBe(10);
    expect(metrics.total_purchase_amount).toBe(100000);
  });

  it('두 건 수량 가중 평균', () => {
    const entries = [
      makeEntry({ id: 'e1', unit_cost: 10000, unit_shipping_fee: 500, quantity: 3 }),
      makeEntry({ id: 'e2', unit_cost: 20000, unit_shipping_fee: 1500, quantity: 7 }),
    ];
    const metrics = calculateProductMetrics(entries);
    // weighted_avg_cost = (10000×3 + 20000×7) / 10 = 17000
    // total_purchase_amount = 10000×3 + 20000×7 = 170000
    expect(metrics.weighted_avg_cost).toBe(17000);
    expect(metrics.total_quantity).toBe(10);
    expect(metrics.total_purchase_amount).toBe(170000);
  });

  it('빈 entries → 모두 0', () => {
    const metrics = calculateProductMetrics([]);
    expect(metrics.weighted_avg_cost).toBe(0);
    expect(metrics.weighted_avg_shipping).toBe(0);
    expect(metrics.total_quantity).toBe(0);
    expect(metrics.total_purchase_amount).toBe(0);
  });
});

describe('distributeShippingFee', () => {
  it('수량 비례 배분 후 합계가 총 배송비와 같음', () => {
    const entries = [
      { id: 'e1', quantity: 20 },
      { id: 'e2', quantity: 10 },
    ];
    const dist = distributeShippingFee(entries, 54000);
    const total = [...dist.values()].reduce((s, v) => s + v, 0);
    expect(total).toBe(54000);
  });

  it('반올림 오차는 첫 번째 entry에 흡수', () => {
    const entries = [
      { id: 'e1', quantity: 3 },
      { id: 'e2', quantity: 7 },
    ];
    const dist = distributeShippingFee(entries, 100);
    expect(dist.get('e1')! + dist.get('e2')!).toBe(100);
  });

  it('빈 배열 → 빈 Map', () => {
    expect(distributeShippingFee([], 10000).size).toBe(0);
  });
});
