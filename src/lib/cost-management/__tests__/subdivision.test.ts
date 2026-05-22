import { describe, it, expect } from 'vitest';
import { calculateSubdivision } from '@/lib/cost-management/subdivision';

describe('calculateSubdivision', () => {
  it('이월 없는 첫 입고 — 3팩 + 6개 이월', () => {
    const result = calculateSubdivision({
      purchaseQuantity: 36,
      totalPurchaseCost: 21490,
      subdivisionUnit: 10,
      carryoverQuantity: 0,
      carryoverUnitCost: 0,
    });
    expect(result.sellablePacks).toBe(3);
    expect(result.newCarryoverQuantity).toBe(6);
    expect(result.totalAvailable).toBe(36);
    expect(result.packUnitCost).toBe(5969); // round(21490/36*10) = round(5969.44) = 5969
    expect(result.newCarryoverUnitCost).toBe(597); // round(21490/36)
  });

  it('이월 6개 + 신규 36개 — 4팩 + 2개 이월', () => {
    const result = calculateSubdivision({
      purchaseQuantity: 36,
      totalPurchaseCost: 21490,
      subdivisionUnit: 10,
      carryoverQuantity: 6,
      carryoverUnitCost: 597,
    });
    expect(result.sellablePacks).toBe(4);
    expect(result.newCarryoverQuantity).toBe(2);
    expect(result.totalAvailable).toBe(42);
    // (6*597 + 21490) / 42 * 10 = 25072/42*10 = 5969.52 → round = 5970
    expect(result.packUnitCost).toBe(5970);
    expect(result.newCarryoverUnitCost).toBe(597);
  });

  it('나머지 없음 — 30개, 10개 소분 → 3팩, 0 이월', () => {
    const result = calculateSubdivision({
      purchaseQuantity: 30,
      totalPurchaseCost: 18000,
      subdivisionUnit: 10,
      carryoverQuantity: 0,
      carryoverUnitCost: 0,
    });
    expect(result.sellablePacks).toBe(3);
    expect(result.newCarryoverQuantity).toBe(0);
    expect(result.packUnitCost).toBe(6000);
  });

  it('사입 수량이 소분 갯수보다 작음 — 0팩, 전량 이월', () => {
    const result = calculateSubdivision({
      purchaseQuantity: 5,
      totalPurchaseCost: 3000,
      subdivisionUnit: 10,
      carryoverQuantity: 0,
      carryoverUnitCost: 0,
    });
    expect(result.sellablePacks).toBe(0);
    expect(result.newCarryoverQuantity).toBe(5);
    expect(result.packUnitCost).toBe(0);
  });

  it('이월만으로 팩 완성 — 이월 12개, 소분 10개 → 1팩 + 2개 이월', () => {
    const result = calculateSubdivision({
      purchaseQuantity: 0,
      totalPurchaseCost: 0,
      subdivisionUnit: 10,
      carryoverQuantity: 12,
      carryoverUnitCost: 600,
    });
    expect(result.sellablePacks).toBe(1);
    expect(result.newCarryoverQuantity).toBe(2);
    expect(result.packUnitCost).toBe(6000); // 600*10
  });
});
