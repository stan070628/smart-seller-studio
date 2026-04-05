'use client';

import React from 'react';
import { Package, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { ORDER_STATUS_INFO, PLATFORM_INFO } from '@/types/orders';
import type { Order } from '@/types/orders';

// 목업 데이터 — API 연동 전까지 사용
const MOCK_ORDERS: Order[] = [
  { id: '1', platform: 'coupang', platformOrderId: 'COU-2026040501', productTitle: '실리콘 주방매트 대형', quantity: 2, sellingPrice: 19800, costPrice: 8500, profit: 2800, status: 'new', supplier: '도매꾹', supplierOrderId: null, trackingNumber: null, orderedAt: '2026-04-05T09:30:00Z', shippedAt: null, deliveredAt: null },
  { id: '2', platform: 'naver', platformOrderId: 'NAV-2026040502', productTitle: '접이식 스테인리스 빨래건조대', quantity: 1, sellingPrice: 32000, costPrice: 15000, profit: 12000, status: 'ordered', supplier: '도매꾹', supplierOrderId: 'DG-78901', trackingNumber: null, orderedAt: '2026-04-05T08:15:00Z', shippedAt: null, deliveredAt: null },
  { id: '3', platform: 'coupang', platformOrderId: 'COU-2026040403', productTitle: '무선 헤어드라이기 접이식', quantity: 1, sellingPrice: 45000, costPrice: 22000, profit: 15000, status: 'shipping', supplier: '도매꾹', supplierOrderId: 'DG-78850', trackingNumber: '6012345678901', orderedAt: '2026-04-04T14:00:00Z', shippedAt: '2026-04-04T18:00:00Z', deliveredAt: null },
  { id: '4', platform: 'gmarket', platformOrderId: 'GM-2026040301', productTitle: '천연 대나무 도마 세트', quantity: 3, sellingPrice: 28000, costPrice: 12000, profit: 10000, status: 'delivered', supplier: '도매꾹', supplierOrderId: 'DG-78700', trackingNumber: '6012345678902', orderedAt: '2026-04-03T10:00:00Z', shippedAt: '2026-04-03T16:00:00Z', deliveredAt: '2026-04-05T11:00:00Z' },
];

export default function OrdersTab() {
  const formatPrice = (n: number) => n.toLocaleString() + '원';

  return (
    <div>
      {/* 안내 배너 */}
      <div style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '12px', padding: '14px 18px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <Package size={16} color="#d97706" />
        <p style={{ fontSize: '13px', color: '#92400e', margin: 0 }}>
          아래는 미리보기 데이터입니다. <Link href="/orders" onClick={(e) => { e.preventDefault(); }} style={{ fontWeight: 600, color: '#d97706' }}>채널설정</Link>에서 플랫폼을 연동하면 실제 주문이 표시됩니다.
        </p>
      </div>

      {/* 상태 요약 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '20px' }}>
        {(['new', 'processing', 'ordered', 'shipping', 'delivered'] as const).map((status) => {
          const info = ORDER_STATUS_INFO[status];
          const count = MOCK_ORDERS.filter((o) => o.status === status).length;
          return (
            <div key={status} style={{ backgroundColor: '#fff', borderRadius: '10px', border: '1px solid #e5e5e5', padding: '12px 14px', textAlign: 'center' }}>
              <p style={{ fontSize: '20px', fontWeight: 700, color: info.color, margin: 0 }}>{count}</p>
              <p style={{ fontSize: '11px', color: '#71717a', margin: '4px 0 0' }}>{info.label}</p>
            </div>
          );
        })}
      </div>

      {/* 주문 테이블 */}
      <div style={{ backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #e5e5e5', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ backgroundColor: '#f9f9f9', borderBottom: '1px solid #e5e5e5' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#71717a', fontSize: '12px' }}>주문번호</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#71717a', fontSize: '12px' }}>채널</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#71717a', fontSize: '12px' }}>상품명</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: '#71717a', fontSize: '12px' }}>수량</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: '#71717a', fontSize: '12px' }}>금액</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: '#71717a', fontSize: '12px' }}>순이익</th>
              <th style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: '#71717a', fontSize: '12px' }}>상태</th>
              <th style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: '#71717a', fontSize: '12px' }}>액션</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_ORDERS.map((order) => {
              const platformInfo = PLATFORM_INFO[order.platform];
              const statusInfo = ORDER_STATUS_INFO[order.status];
              return (
                <tr key={order.id} style={{ borderBottom: '1px solid #f4f4f5' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 500, color: '#18181b' }}>{order.platformOrderId}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: platformInfo.color, backgroundColor: `${platformInfo.color}10`, padding: '2px 8px', borderRadius: '100px' }}>
                      {platformInfo.label}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', color: '#18181b', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.productTitle}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', color: '#71717a' }}>{order.quantity}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 500, color: '#18181b' }}>{formatPrice(order.sellingPrice)}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#16a34a' }}>+{formatPrice(order.profit)}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '100px', color: statusInfo.color, backgroundColor: statusInfo.bg }}>
                      {statusInfo.label}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                    {order.status === 'new' && (
                      <button style={{ fontSize: '12px', fontWeight: 500, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        발주 <ArrowRight size={11} />
                      </button>
                    )}
                    {order.status === 'shipping' && order.trackingNumber && (
                      <span style={{ fontSize: '11px', color: '#71717a' }}>🚚 추적</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
