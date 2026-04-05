import OrdersClient from '@/components/orders/OrdersClient';

export const metadata = {
  title: '주문/매출 — SmartSellerStudio',
  description: '주문 라우팅, 매출 분석, 채널 관리',
};

export default function OrdersPage() {
  return <OrdersClient />;
}
