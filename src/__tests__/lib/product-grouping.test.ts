import { describe, it, expect } from 'vitest';
import { buildTableItems } from '@/lib/cost-management/product-grouping';

// 최소한의 ProductRow 형태 (실제 타입은 CostManagementTab.tsx:13-39 참조)
type MinProduct = {
  id: string;
  product_name: string;
  seller_product_id: number | null;
  current_stock: number;
  stock_value: number;
  total_realized_profit: number;
  total_sales_amount: number;
  margin_rate: number;
  weighted_avg_cost: number;
  weighted_avg_shipping: number;
  weighted_avg_rg_shipping: number;
  [key: string]: unknown;
};

function makeProduct(overrides: Partial<MinProduct>): MinProduct {
  return {
    id: 'id-1',
    product_name: '테스트',
    seller_product_id: null,
    current_stock: 10,
    stock_value: 50000,
    total_realized_profit: 20000,
    total_sales_amount: 100000,
    margin_rate: 20,
    weighted_avg_cost: 5000,
    weighted_avg_shipping: 0,
    weighted_avg_rg_shipping: 0,
    ...overrides,
  };
}

describe('buildTableItems', () => {
  it('seller_product_id가 null인 상품은 standalone으로 처리', () => {
    const p = makeProduct({ id: 'p1', seller_product_id: null });
    const result = buildTableItems([p] as never[]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('standalone');
  });

  it('옵션이 1개뿐인 그룹은 standalone으로 평탄화', () => {
    const p = makeProduct({ id: 'p1', seller_product_id: 111 });
    const result = buildTableItems([p] as never[]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('standalone');
  });

  it('같은 seller_product_id 2개는 group으로 묶임', () => {
    const p1 = makeProduct({ id: 'p1', seller_product_id: 111, current_stock: 10, stock_value: 50000, total_realized_profit: 20000, total_sales_amount: 100000 });
    const p2 = makeProduct({ id: 'p2', seller_product_id: 111, current_stock: 20, stock_value: 80000, total_realized_profit: 30000, total_sales_amount: 120000 });
    const result = buildTableItems([p1, p2] as never[]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('group');
    if (result[0].kind === 'group') {
      expect(result[0].children).toHaveLength(2);
      expect(result[0].totalStock).toBe(30);
      // avgCost = (50000+80000) / (10+20) = 4333.33
      expect(result[0].avgCost).toBeCloseTo(4333.33, 1);
      // groupMarginRate = (20000+30000) / (100000+120000) * 100 = 22.72...
      expect(result[0].groupMarginRate).toBeCloseTo(22.72, 1);
    }
  });

  it('totalStock이 0이면 avgCost는 0', () => {
    const p1 = makeProduct({ id: 'p1', seller_product_id: 222, current_stock: 0, stock_value: 0 });
    const p2 = makeProduct({ id: 'p2', seller_product_id: 222, current_stock: 0, stock_value: 0 });
    const result = buildTableItems([p1, p2] as never[]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('group');  // silent-pass 방어
    if (result[0].kind === 'group') {
      expect(result[0].avgCost).toBe(0);
    }
  });

  it('totalSalesAmount가 0이면 groupMarginRate는 0', () => {
    const p1 = makeProduct({ id: 'p1', seller_product_id: 333, total_sales_amount: 0 });
    const p2 = makeProduct({ id: 'p2', seller_product_id: 333, total_sales_amount: 0 });
    const result = buildTableItems([p1, p2] as never[]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('group');  // silent-pass 방어
    if (result[0].kind === 'group') {
      expect(result[0].groupMarginRate).toBe(0);
    }
  });

  it('다른 seller_product_id는 각각 별도 그룹', () => {
    const p1 = makeProduct({ id: 'p1', seller_product_id: 111 });
    const p2 = makeProduct({ id: 'p2', seller_product_id: 111 });
    const p3 = makeProduct({ id: 'p3', seller_product_id: 222 });
    const p4 = makeProduct({ id: 'p4', seller_product_id: 222 });
    const result = buildTableItems([p1, p2, p3, p4] as never[]);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.kind === 'group')).toBe(true);
  });
});

describe('buildTableItems — 가상 ID (음수)', () => {
  it('seller_product_id < 0 인 상품은 항상 standalone으로 처리', () => {
    const products = [
      makeProduct({ id: 'va', seller_product_id: -1, product_name: '가상상품A' }),
      makeProduct({ id: 'vb', seller_product_id: -2, product_name: '가상상품B' }),
    ];
    const result = buildTableItems(products as never[]);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.kind === 'standalone')).toBe(true);
  });

  it('양수 seller_product_id 2개↑이면 GroupRow로 그룹화', () => {
    const products = [
      makeProduct({ id: 'ca', seller_product_id: 100, product_name: '쿠팡 옵션A' }),
      makeProduct({ id: 'cb', seller_product_id: 100, product_name: '쿠팡 옵션B' }),
    ];
    const result = buildTableItems(products as never[]);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('group');
  });
});
