'use client';

import React, { useState } from 'react';
import { ChevronRight, ChevronDown, MoreHorizontal } from 'lucide-react';
import { WinnerBadge } from '@/components/ui';
import ChannelCell from '../ChannelCell';
import { OverstockBadge } from './OverstockBadge';

interface RowProduct {
  id: string;
  product_name: string;
  total_sales_amount: number;
  sale_quantity: number;
  total_realized_profit: number;
  sale_count: number;
  margin_rate: number;
  ad_roas: number;
  breakeven_roas: number;
  winner_status: 'winner' | 'watch' | 'normal';
  fifo_error?: boolean;
  hidden: boolean;
  entry_count?: number;
  [key: string]: unknown;
}

interface Props {
  product: RowProduct;
  isChild: boolean;
  expanded: boolean;
  colCount: number;
  onToggleDetail: (productId: string) => void;
  onOpenDrawer: (productId: string) => void;
  onHide: (product: RowProduct) => void;
  onDelete: (product: RowProduct) => void;
  onEditChannel: (product: RowProduct, anchorEl: HTMLElement) => void;
  onProductUpdate: (productId: string, updates: Record<string, unknown>) => void;
  isEditablePeriod: boolean;
  channelFilter: 'all' | 'rg' | 'wing' | 'naver';
  rgInventory: Map<string, number | null>;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

export default function ProductRow(props: Props) {
  const {
    product: p,
    isChild,
    expanded,
    onToggleDetail,
    onHide,
    onDelete,
    onEditChannel,
    onProductUpdate,
  } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const firstPadLeft = isChild ? '22px' : '12px';

  return (
    <tr
      style={{
        borderBottom: '1px solid #f0f0f0',
        background: p.hidden ? '#f9fafb' : '#fff',
        opacity: p.hidden ? 0.55 : 1,
      }}
    >
      {/* 1: 채널 — 전파 차단 */}
      <td
        style={{ padding: `10px ${firstPadLeft}`, textAlign: 'center', whiteSpace: 'nowrap' }}
        onClick={(e) => e.stopPropagation()}
      >
        <ChannelCell
          product={p as any}
          onEditChannel={(anchorEl: HTMLElement) => onEditChannel(p, anchorEl)}
          onProductUpdate={(updates: any) => onProductUpdate(p.id, updates)}
        />
      </td>
      {/* 2: 상품명 + 위너 배지 + chevron */}
      <td style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            aria-label={expanded ? '상세 접기' : '상세 펼치기'}
            onClick={() => onToggleDetail(p.id)}
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
              color: '#a1a1aa',
            }}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <span
            style={{
              fontWeight: 500,
              color: p.entry_count === 0 ? '#999' : '#18181b',
            }}
          >
            {p.product_name}
          </span>
          <WinnerBadge status={p.winner_status} />
          {p.fifo_error && <OverstockBadge />}
        </div>
      </td>
      {/* 3: 매출(수량) */}
      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
        <div style={{ fontSize: 12, color: '#18181b' }}>
          {p.sale_count === 0 ? '—' : `${fmt(p.total_sales_amount)}원`}
        </div>
        {p.sale_count > 0 && (
          <div style={{ fontSize: 10, color: '#a1a1aa' }}>{fmt(p.sale_quantity)}개 판매</div>
        )}
      </td>
      {/* 4: 실현손익 */}
      <td
        style={{
          padding: '10px 12px',
          textAlign: 'right',
          fontWeight: 600,
          color: p.total_realized_profit >= 0 ? '#16a34a' : '#ef4444',
        }}
      >
        {p.fifo_error ? (
          <span style={{ color: '#dc2626' }}>확인 필요</span>
        ) : p.sale_count === 0 ? (
          <span style={{ color: '#ccc' }}>—</span>
        ) : (
          `${fmt(p.total_realized_profit)}원`
        )}
      </td>
      {/* 5: 마진율 */}
      <td
        style={{
          padding: '10px 12px',
          textAlign: 'right',
          color: p.margin_rate > 0 ? '#2563eb' : '#ccc',
        }}
      >
        {p.margin_rate > 0 ? `${(p.margin_rate * 100).toFixed(1)}%` : '—'}
      </td>
      {/* 6: ROAS */}
      <td
        style={{
          padding: '10px 12px',
          textAlign: 'right',
          color:
            p.ad_roas > 0
              ? p.ad_roas >= p.breakeven_roas
                ? '#16a34a'
                : '#ef4444'
              : '#ccc',
        }}
      >
        {p.ad_roas > 0 ? `${Math.round(p.ad_roas)}%` : '—'}
      </td>
      {/* 7: ⋯ 메뉴 */}
      <td
        style={{ padding: '10px 8px', textAlign: 'right', position: 'relative' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          aria-label="행 메뉴"
          onClick={() => setMenuOpen((v) => !v)}
          style={{
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            padding: 4,
            color: '#71717a',
          }}
        >
          <MoreHorizontal size={16} />
        </button>
        {menuOpen && (
          <div
            style={{
              position: 'absolute',
              right: 8,
              top: '100%',
              zIndex: 50,
              background: '#fff',
              border: '1px solid #e4e4e7',
              borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              minWidth: 100,
            }}
          >
            <button
              onClick={() => {
                setMenuOpen(false);
                onHide(p);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: 12,
                color: '#3f3f46',
              }}
            >
              {p.hidden ? '복원' : '숨기기'}
            </button>
            <button
              onClick={() => {
                setMenuOpen(false);
                onDelete(p);
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: 12,
                color: '#ef4444',
              }}
            >
              삭제
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
