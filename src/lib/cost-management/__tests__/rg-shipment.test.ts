import { describe, it, expect } from 'vitest';
import { computeFifoBatchOps, distributeRgFee } from '../rg-shipment';

describe('computeFifoBatchOps', () => {
  it('단일 배치 전량 소진 → UPDATE 오퍼레이션', () => {
    const batches = [{ id: 'b1', quantity: 30 }];
    const ops = computeFifoBatchOps(batches, 30, 650);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ type: 'update', batchId: 'b1', take: 30, remainder: 0, unitRgFee: 650 });
  });

  it('단일 배치 일부 소진 → SPLIT 오퍼레이션 (remainder > 0)', () => {
    const batches = [{ id: 'b1', quantity: 30 }];
    const ops = computeFifoBatchOps(batches, 20, 650);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({ type: 'split', batchId: 'b1', take: 20, remainder: 10, unitRgFee: 650 });
  });

  it('두 배치 걸친 소진 → 첫 배치 UPDATE + 두 번째 배치 SPLIT', () => {
    const batches = [
      { id: 'b1', quantity: 10 },
      { id: 'b2', quantity: 30 },
    ];
    const ops = computeFifoBatchOps(batches, 25, 500);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toEqual({ type: 'update', batchId: 'b1', take: 10, remainder: 0, unitRgFee: 500 });
    expect(ops[1]).toEqual({ type: 'split', batchId: 'b2', take: 15, remainder: 15, unitRgFee: 500 });
  });

  it('두 배치 합계와 정확히 일치 → 모두 UPDATE', () => {
    const batches = [
      { id: 'b1', quantity: 10 },
      { id: 'b2', quantity: 20 },
    ];
    const ops = computeFifoBatchOps(batches, 30, 300);
    expect(ops).toHaveLength(2);
    expect(ops.every((o) => o.type === 'update')).toBe(true);
    expect(ops[0].take).toBe(10);
    expect(ops[1].take).toBe(20);
  });

  it('rgQty 0 → 빈 오퍼레이션 목록', () => {
    const batches = [{ id: 'b1', quantity: 30 }];
    const ops = computeFifoBatchOps(batches, 0, 650);
    expect(ops).toHaveLength(0);
  });

  it('배치 3개 중 첫 2개로만 소진됨 → 세 번째 배치 미포함', () => {
    const batches = [
      { id: 'b1', quantity: 5 },
      { id: 'b2', quantity: 5 },
      { id: 'b3', quantity: 100 },
    ];
    const ops = computeFifoBatchOps(batches, 10, 200);
    expect(ops).toHaveLength(2);
    expect(ops.map((o) => o.batchId)).toEqual(['b1', 'b2']);
  });
});

describe('distributeRgFee', () => {
  it('상품 1개 + 나눠떨어지는 금액 → 정확한 unit fee', () => {
    const items = [{ id: 'p1', qty: 20 }];
    const fees = distributeRgFee(items, 13000);
    expect(fees.get('p1')).toBe(650); // 13000 / 20 = 650
  });

  it('상품 2개 동일 수량 → 균등 배분', () => {
    const items = [
      { id: 'p1', qty: 10 },
      { id: 'p2', qty: 10 },
    ];
    const fees = distributeRgFee(items, 10000);
    expect(fees.get('p1')).toBe(500); // 5000 / 10
    expect(fees.get('p2')).toBe(500);
  });

  it('2개 상품 비례 배분 (22750원, 20개+15개)', () => {
    // p2_total = round(22750 * 15/35) = round(9750) = 9750
    // p1_total = 22750 - 9750 = 13000
    // p1_unit = round(13000/20) = 650
    // p2_unit = round(9750/15) = 650
    const items = [
      { id: 'p1', qty: 20 },
      { id: 'p2', qty: 15 },
    ];
    const fees = distributeRgFee(items, 22750);
    expect(fees.get('p1')).toBe(650);
    expect(fees.get('p2')).toBe(650);
  });

  it('반올림 오차가 있을 때 sum(unit*qty)와 totalFee 차이 ≤ totalQty', () => {
    // total=10001, 3개+3개 → 정수 나눗셈 오차 발생
    const items = [
      { id: 'p1', qty: 3 },
      { id: 'p2', qty: 3 },
    ];
    const fees = distributeRgFee(items, 10001);
    const p1Fee = fees.get('p1') ?? 0;
    const p2Fee = fees.get('p2') ?? 0;
    const computed = p1Fee * 3 + p2Fee * 3;
    expect(Math.abs(computed - 10001)).toBeLessThanOrEqual(6); // ≤ totalQty
  });

  it('배송비 0 → 빈 Map 반환', () => {
    const items = [
      { id: 'p1', qty: 10 },
      { id: 'p2', qty: 5 },
    ];
    const fees = distributeRgFee(items, 0);
    expect(fees.size).toBe(0);
  });

  it('빈 items → 빈 Map 반환', () => {
    const fees = distributeRgFee([], 10000);
    expect(fees.size).toBe(0);
  });

  it('단가가 나눠떨어지지 않을 때 첫 번째 상품이 나머지 흡수', () => {
    // total=10, qty=3 → unit = round(10/3) = 3, computed = 9 ≠ 10
    const items = [{ id: 'p1', qty: 3 }];
    const fees = distributeRgFee(items, 10);
    // 단일 상품이므로 전체 배분 후 per-unit 반올림
    expect(fees.get('p1')).toBe(3); // round(10/3) = 3
  });
});
