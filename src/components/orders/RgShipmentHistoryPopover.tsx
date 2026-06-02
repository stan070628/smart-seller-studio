'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface ShipmentEventItem {
  product_name: string;
  quantity: number;
  unit_rg_fee: number;
}

interface ShipmentEvent {
  id: string;
  shipped_at: string;
  total_shipping_fee: number;
  created_at: string;
  items: ShipmentEventItem[];
}

interface Props {
  onClose: () => void;
}

function fmt(n: number): string {
  return n.toLocaleString('ko-KR');
}

export default function RgShipmentHistoryPopover({ onClose }: Props) {
  const [events, setEvents] = useState<ShipmentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/cost-management/rg-shipments?limit=20')
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setEvents(json.data as ShipmentEvent[]);
        else setError(json.error ?? '조회 실패');
      })
      .catch(() => setError('네트워크 오류'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: '6px',
        width: '340px', background: '#fff', borderRadius: '12px',
        border: '1px solid #bae6fd', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        overflow: 'hidden',
      }}
    >
      {/* 헤더 */}
      <div style={{ padding: '12px 16px', background: '#f0f9ff', borderBottom: '1px solid #bae6fd', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#0369a1' }}>📋 로켓그로스 입고 이력</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '10px', color: '#7dd3fc' }}>최근 20건</span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}>
            <X size={14} color="#7dd3fc" />
          </button>
        </div>
      </div>

      {/* 본문 */}
      <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
        {loading && (
          <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: '#71717a' }}>
            불러오는 중...
          </div>
        )}
        {error && (
          <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: '#ef4444' }}>
            {error}
          </div>
        )}
        {!loading && !error && events.length === 0 && (
          <div style={{ padding: '32px', textAlign: 'center', fontSize: '12px', color: '#a1a1aa' }}>
            아직 등록된 입고 이력이 없습니다
          </div>
        )}
        {!loading && !error && events.map((event, idx) => {
          const totalQty = event.items.reduce((s, i) => s + i.quantity, 0);
          return (
            <div
              key={event.id}
              style={{ padding: '12px 16px', borderBottom: idx < events.length - 1 ? '1px solid #f0f9ff' : 'none' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#0284c7' }}>{event.shipped_at}</span>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#0369a1', background: '#e0f2fe', padding: '2px 8px', borderRadius: '10px' }}>
                  총 {fmt(event.total_shipping_fee)}원
                </span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px', color: '#52525b' }}>
                <thead>
                  <tr style={{ color: '#a1a1aa', borderBottom: '1px solid #f0f9ff' }}>
                    <th style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 500 }}>상품명</th>
                    <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 500 }}>수량</th>
                    <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 500 }}>단위배송비</th>
                  </tr>
                </thead>
                <tbody>
                  {event.items.map((item, i) => (
                    <tr key={i}>
                      <td style={{ padding: '3px 4px' }}>{item.product_name}</td>
                      <td style={{ textAlign: 'right', padding: '3px 4px', fontWeight: 600, color: '#0369a1' }}>{fmt(item.quantity)}개</td>
                      <td style={{ textAlign: 'right', padding: '3px 4px', color: '#0369a1' }}>{fmt(item.unit_rg_fee)}원</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ textAlign: 'right', fontSize: '10px', color: '#71717a', marginTop: '6px' }}>
                총 {fmt(totalQty)}개
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
