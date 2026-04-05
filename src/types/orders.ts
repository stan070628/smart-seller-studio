/**
 * 주문/매출 관리 타입 정의
 */

export type OrderPlatform = 'coupang' | 'naver' | 'gmarket' | 'elevenst' | 'shopee';

export type OrderStatus =
  | 'new'          // 신규 주문
  | 'processing'   // 처리 중
  | 'ordered'      // 공급처 발주 완료
  | 'shipping'     // 배송 중
  | 'delivered'    // 배송 완료
  | 'cancelled'    // 취소
  | 'returned';    // 반품

export interface Order {
  id: string;
  platform: OrderPlatform;
  platformOrderId: string;
  productTitle: string;
  quantity: number;
  sellingPrice: number;
  costPrice: number;
  profit: number;
  status: OrderStatus;
  supplier: string | null;
  supplierOrderId: string | null;
  trackingNumber: string | null;
  orderedAt: string;
  shippedAt: string | null;
  deliveredAt: string | null;
}

export interface SalesChannel {
  id: string;
  platform: OrderPlatform;
  isConnected: boolean;
  syncEnabled: boolean;
  lastSyncedAt: string | null;
}

export interface OrderRule {
  id: string;
  name: string;
  channelPlatform: OrderPlatform;
  action: 'auto_order' | 'notify_only' | 'manual';
  isActive: boolean;
}

export interface DailySalesSummary {
  date: string;
  platform: OrderPlatform;
  totalOrders: number;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  returnCount: number;
}

export interface SalesSummaryTotals {
  totalRevenue: number;
  totalProfit: number;
  totalOrders: number;
  avgMarginRate: number;
  revenueChange: number; // 전기 대비 %
}

// 플랫폼 표시 정보
export const PLATFORM_INFO: Record<OrderPlatform, { label: string; color: string }> = {
  coupang: { label: '쿠팡', color: '#be0014' },
  naver: { label: '네이버', color: '#03c75a' },
  gmarket: { label: 'G마켓', color: '#6dbe46' },
  elevenst: { label: '11번가', color: '#ff0038' },
  shopee: { label: 'Shopee', color: '#ee4d2d' },
};

export const ORDER_STATUS_INFO: Record<OrderStatus, { label: string; color: string; bg: string }> = {
  new: { label: '신규', color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  processing: { label: '처리중', color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  ordered: { label: '발주됨', color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
  shipping: { label: '배송중', color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
  delivered: { label: '완료', color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
  cancelled: { label: '취소', color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
  returned: { label: '반품', color: '#9ca3af', bg: 'rgba(156,163,175,0.08)' },
};
