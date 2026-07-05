import { describe, it, expect } from 'vitest';
import { calculateFifo } from '../fifo';

describe('calculateFifo', () => {
  it('판매 없음 → current_stock = 입고 합계, realized_profit = 0', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 30, unit_cost: 15000, unit_shipping_fee: 800, unit_rg_shipping_fee: 0 },
      { id: 'b2', received_at: '2026-04-10', quantity: 20, unit_cost: 14500, unit_shipping_fee: 800, unit_rg_shipping_fee: 0 },
    ];
    const result = calculateFifo(batches, [], 0.108);
    expect(result.current_stock).toBe(50);
    expect(result.stock_value).toBe(30 * 15000 + 20 * 14500);
    expect(result.total_realized_profit).toBe(0);
    expect(result.sale_details).toHaveLength(0);
  });

  it('FIFO: 오래된 배치부터 소진됨', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 15000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0 },
      { id: 'b2', received_at: '2026-04-10', quantity: 10, unit_cost: 20000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0 },
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
      { id: 'b1', received_at: '2026-04-01', quantity: 5, unit_cost: 10000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0 },
      { id: 'b2', received_at: '2026-04-10', quantity: 5, unit_cost: 20000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0 },
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
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 10000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0 },
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
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 14000, unit_shipping_fee: 1000, unit_rg_shipping_fee: 0 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 5, selling_price: 25000 },
    ];
    const result = calculateFifo(batches, sales, 0);
    // fifo cost = (14000 + 1000) = 15000/unit
    expect(result.sale_details[0].fifo_cost_per_unit).toBe(15000);
    expect(result.current_stock).toBe(5);
  });

  it('복수 판매 시 total_realized_profit 누적', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 20, unit_cost: 10000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 5, selling_price: 20000 },
      { id: 's2', sold_at: '2026-05-10', quantity: 5, selling_price: 25000 },
    ];
    const result = calculateFifo(batches, sales, 0);
    // s1: (20000 - 10000) * 5 = 50000
    // s2: (25000 - 10000) * 5 = 75000
    expect(result.total_realized_profit).toBe(125000);
    expect(result.current_stock).toBe(10);
  });

  it('RG배송비 포함 원가로 FIFO', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 14000, unit_shipping_fee: 1000, unit_rg_shipping_fee: 650 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 5, selling_price: 25000 },
    ];
    const result = calculateFifo(batches, sales, 0);
    // fifo cost = 14000 + 1000 + 650 = 15650/unit
    expect(result.sale_details[0].fifo_cost_per_unit).toBe(15650);
    expect(result.current_stock).toBe(5);
  });

  it('RG배송비 0인 배치와 혼합 FIFO', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 5, unit_cost: 10000, unit_shipping_fee: 0, unit_rg_shipping_fee: 500 },
      { id: 'b2', received_at: '2026-04-10', quantity: 5, unit_cost: 10000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 10, selling_price: 20000 },
    ];
    const result = calculateFifo(batches, sales, 0);
    // (5*(10000+500) + 5*(10000+0)) / 10 = (52500 + 50000) / 10 = 10250
    expect(result.sale_details[0].fifo_cost_per_unit).toBe(10250);
  });

  it('stock_value는 RG배송비 제외', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 15000, unit_shipping_fee: 800, unit_rg_shipping_fee: 650 },
    ];
    const result = calculateFifo(batches, [], 0);
    // stock_value = unit_cost × qty 만 (배송비·RG배송비 제외)
    expect(result.stock_value).toBe(10 * 15000);
  });

  it('coupon_discount → effective_price 기준 수수료·손익 계산', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 10000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 1, selling_price: 35800, coupon_discount: 6000 },
    ];
    // effective_price = 35800 - 6000 = 29800
    // fee = round(29800 * 0.108) = round(3218.4) = 3218
    // profit = 29800 - 10000 - 3218 = 16582
    const result = calculateFifo(batches, sales, 0.108);
    expect(result.sale_details[0].realized_profit_per_unit).toBe(16582);
  });

  it('coupon_discount 없으면 기존 동작 유지', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 10000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 1, selling_price: 20000 },
    ];
    // coupon_discount undefined → effective_price = 20000, fee = 2000, profit = 8000
    const result = calculateFifo(batches, sales, 0.1);
    expect(result.sale_details[0].realized_profit_per_unit).toBe(8000);
  });

  it('택배비는 건당 1회만 차감 (수량 2개 × 배송비 3500 → 3500 한 번)', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 10000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 2, selling_price: 20000, shipping_fee: 3500 },
    ];
    const result = calculateFifo(batches, sales, 0.1);
    // per-unit(배송 제외): 20000 - 10000 - round(20000*0.1)=2000 = 8000
    expect(result.sale_details[0].realized_profit_per_unit).toBe(8000);
    // 건당: 8000*2 - 3500 = 12500  (개당 차감이었다면 (8000-3500)*2 = 9000)
    expect(result.sale_details[0].realized_profit).toBe(12500);
    expect(result.total_realized_profit).toBe(12500);
  });

  it('배송비 없는 판매는 realized_profit = per_unit × quantity', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 10000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 10, selling_price: 20000 },
    ];
    const result = calculateFifo(batches, sales, 0.1);
    expect(result.sale_details[0].realized_profit).toBe(80000);
    expect(result.total_realized_profit).toBe(80000);
  });

  it('수량 0 판매는 배송비를 차감하지 않고 realized_profit = 0', () => {
    const batches = [
      { id: 'b1', received_at: '2026-04-01', quantity: 10, unit_cost: 10000, unit_shipping_fee: 0, unit_rg_shipping_fee: 0 },
    ];
    const sales = [
      { id: 's1', sold_at: '2026-05-01', quantity: 0, selling_price: 20000, shipping_fee: 3500 },
    ];
    const result = calculateFifo(batches, sales, 0.1);
    expect(result.sale_details[0].realized_profit).toBe(0);
    expect(result.total_realized_profit).toBe(0);
  });

});
