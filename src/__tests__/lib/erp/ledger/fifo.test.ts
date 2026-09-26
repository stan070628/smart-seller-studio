import { describe, it, expect } from 'vitest';
import { allocateFifo, InsufficientStockError, type LotBalance } from '@/lib/erp/ledger/fifo';

const lots: LotBalance[] = [
  { lotId: 20, qty: 5, unitCost: 1200, lotAt: 2000 },
  { lotId: 10, qty: 10, unitCost: 1000, lotAt: 1000 },
  { lotId: 30, qty: 0, unitCost: 900, lotAt: 500 },
];

describe('allocateFifo', () => {
  it('오래된 lot부터 소진한다', () => {
    expect(allocateFifo(lots, 12)).toEqual([
      { lotId: 10, qty: 10, unitCost: 1000 },
      { lotId: 20, qty: 2, unitCost: 1200 },
    ]);
  });

  it('lot 시각이 같으면 lot 번호 순이다', () => {
    const same: LotBalance[] = [
      { lotId: 7, qty: 1, unitCost: 1, lotAt: 1000 },
      { lotId: 3, qty: 1, unitCost: 2, lotAt: 1000 },
    ];
    expect(allocateFifo(same, 1)).toEqual([{ lotId: 3, qty: 1, unitCost: 2 }]);
  });

  it('잔량 0 lot은 건너뛴다', () => {
    expect(allocateFifo(lots, 1)[0].lotId).toBe(10);
  });

  it('가용보다 많으면 InsufficientStockError(필요·가용)', () => {
    try {
      allocateFifo(lots, 16);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientStockError);
      expect((e as InsufficientStockError).need).toBe(16);
      expect((e as InsufficientStockError).have).toBe(15);
    }
  });

  it.each([0, -1, 1.5, Number.NaN])('수량 %s는 RangeError', (q) => {
    expect(() => allocateFifo(lots, q)).toThrow(RangeError);
  });
});
