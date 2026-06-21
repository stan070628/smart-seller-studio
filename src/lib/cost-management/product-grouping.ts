// ProductRow의 핵심 필드만 의존 (CostManagementTab.tsx:13-39 참조)
export interface GroupableProduct {
  id: string;
  product_name: string;
  seller_product_id: number;
  current_stock: number;
  stock_value: number;
  total_realized_profit: number;
  total_sales_amount: number;
  [key: string]: unknown;
}

export interface GroupRow<T extends GroupableProduct = GroupableProduct> {
  kind: 'group';
  sellerProductId: string;
  productName: string;
  children: T[];
  totalStock: number;
  totalStockValue: number;
  totalProfit: number;
  totalSalesAmount: number;
  avgCost: number;
  groupMarginRate: number;
}

export interface StandaloneRow<T extends GroupableProduct = GroupableProduct> {
  kind: 'standalone';
  product: T;
}

export type TableItem<T extends GroupableProduct = GroupableProduct> =
  | GroupRow<T>
  | StandaloneRow<T>;

export function buildTableItems<T extends GroupableProduct>(
  products: T[],
): TableItem<T>[] {
  const grouped = new Map<string, T[]>();
  const standalone: T[] = [];

  for (const p of products) {
    if (p.seller_product_id > 0) {
      const key = String(p.seller_product_id);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(p);
    } else {
      standalone.push(p);
    }
  }

  const result: TableItem<T>[] = [];

  for (const [sellerProductId, children] of grouped) {
    // 옵션 1개짜리 그룹은 standalone으로 평탄화
    if (children.length === 1) {
      standalone.push(children[0]);
      continue;
    }

    const totalStock = children.reduce((s, c) => s + (c.current_stock ?? 0), 0);
    const totalStockValue = children.reduce((s, c) => s + (c.stock_value ?? 0), 0);
    const avgCost = totalStock > 0 ? totalStockValue / totalStock : 0;
    const totalProfit = children.reduce((s, c) => s + (c.total_realized_profit ?? 0), 0);
    const totalSalesAmount = children.reduce((s, c) => s + (c.total_sales_amount ?? 0), 0);
    const groupMarginRate =
      totalSalesAmount > 0 ? (totalProfit / totalSalesAmount) * 100 : 0;

    result.push({
      kind: 'group',
      sellerProductId,
      productName: children[0].product_name ?? '',
      children,
      totalStock,
      totalStockValue,
      totalProfit,
      totalSalesAmount,
      avgCost,
      groupMarginRate,
    });
  }

  for (const p of standalone) {
    result.push({ kind: 'standalone', product: p });
  }

  return result;
}
