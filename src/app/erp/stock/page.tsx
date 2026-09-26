import StockClient from '@/components/erp/stock/StockClient';

export const metadata = {
  title: '재고현황 — SmartSellerStudio',
  description: 'SKU별 원장 재고 · 재고 수정 · RG 실재고 대조 · 기초재고',
};

export default function ErpStockPage() {
  return <StockClient />;
}
