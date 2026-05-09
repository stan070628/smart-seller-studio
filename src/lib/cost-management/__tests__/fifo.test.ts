import { describe, it, expect } from 'vitest';
import { calculateFifo } from '../fifo';

describe('calculateFifo', () => {
  it('판매 없음 → current_stock = 입고 합계, realized_profit = 0', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 30, unit_cost: 15000, unit_shipping_fee: 800 },
      { id: 'b2', received_at: '2026-04-10', quantity: 20, unit_cost: 14500, unit_shipping_fee: 800 },
    ];
    const result = calculateFifo(batches, [], 0.108);
    expect(result.current_stock).toBe(50);
    expect(result.stock_value).toBe(30 * 15000 + 20 * 14500);
    expect(result.total_realized_profit).toBe(0);
    expect(result.sale_details).toHaveLength(0);
  });

  it('FIFO: 오래된 배치부터 소진됨', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 15000, unit_shipping_fee: 0 },
      { id: 'b2', received_at: '2026-04-10', quantity: 10, unit_cost: 20000, unit_shipping_fee: 0 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 10, selling_price: 30000 },
    ];
    const result = calculateFifo(batches, sales, 0);
    // b1이 먼저 소진되어야 함
    expect(result.sale_details[0].fifo_cost_per_unit).toBe(15000);
    expect(result.current_stock).toBe(10); // b2 잔여
    expect(result.stock_value).toBe(10 * 20000);
  });

  it('배치 걸친 판매 → 가중평균 원가', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 5, unit_cost: 10000, unit_shipping_fee: 0 },
      { id: 'b2', received_at: '2026-04-10', quantity: 5, unit_cost: 20000, unit_shipping_fee: 0 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 10, selling_price: 30000 },
    ];
    const result = calculateFifo(batches, sales, 0);
    // (10000*5 + 20000*5) / 10 = 15000
    expect(result.sale_details[0].fifo_cost_per_unit).toBe(15000);
    expect(result.current_stock).toBe(0);
    expect(result.stock_value).toBe(0);
  });

  it('수수료 포함 실현손익 계산', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 10000, unit_shipping_fee: 0 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 10, selling_price: 20000 },
    ];
    const result = calculateFifo(batches, sales, 0.1);
    // profit_per_unit = 20000 - 10000 - round(20000*0.1) = 20000 - 10000 - 2000 = 8000
    expect(result.sale_details[0].realized_profit_per_unit).toBe(8000);
    expect(result.total_realized_profit).toBe(80000);
  });

  it('배송비 포함 원가로 FIFO', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 14000, unit_shipping_fee: 1000 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 5, selling_price: 25000 },
    ];
    const result = calculateFifo(batches, sales, 0);
    // fifo cost = (14000 + 1000) = 15000/unit
    expect(result.sale_details[0].fifo_cost_per_unit).toBe(15000);
    expect(result.current_stock).toBe(5);
  });
});
