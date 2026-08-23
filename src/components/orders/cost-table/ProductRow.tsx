'use client';

import React, { useState } from 'react';
import { ChevronRight, ChevronDown, MoreHorizontal } from 'lucide-react';
import { WinnerBadge } from '@/components/ui';
import { E } from '@/lib/design-tokens';
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
  current_stock: number;
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
  /** RG 실재고 조회가 아직 끝나지 않았으면 true — 재고 칸에 …를 띄운다. */
  rgInventoryLoading?: boolean;
  /** 짝수 행 배경 — ERP 격자의 얼룩무늬 */
  striped?: boolean;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

/** 숫자 셀 공통 — 우측 정렬 + 자릿수 고정 */
const numCell: React.CSSProperties = {
  padding: '4px 8px',
  textAlign: 'right',
  fontFamily: E.mono,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  borderRight: `1px solid ${E.lineSoft}`,
};

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
    rgInventory,
    rgInventoryLoading,
    striped,
  } = props;
  const [menuOpen, setMenuOpen] = useState(false);

  const bg = p.hidden ? E.chrome2 : striped ? E.chrome2 : E.surface;
  const cell: React.CSSProperties = {
    padding: '4px 8px',
    borderRight: `1px solid ${E.lineSoft}`,
    verticalAlign: 'middle',
  };

  // RG 실재고는 채널 필터가 rg일 때만 조회된다(CostManagementTab). 없으면 장부 재고만 보인다.
  const rgStock = rgInventory.get(p.id);
  const hasRgStock = rgStock !== undefined;

  return (
    <tr
      style={{
        borderBottom: `1px solid ${E.lineSoft}`,
        background: bg,
        opacity: p.hidden ? 0.55 : 1,
      }}
    >
      {/* 1: 채널 — 전파 차단 */}
      <td style={{ ...cell, textAlign: 'center', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
        <ChannelCell
          // ChannelCell은 자기 필드만 선언한 좁은 타입을 받는다. 행 타입은 인덱스
          // 시그니처를 가진 넓은 타입이라 구조적으로 겹치지 않아 단언이 필요하다.
          product={p as unknown as React.ComponentProps<typeof ChannelCell>['product']}
          onEditChannel={(anchorEl: HTMLElement) => onEditChannel(p, anchorEl)}
          onProductUpdate={(updates) => onProductUpdate(p.id, updates as Record<string, unknown>)}
        />
      </td>

      {/* 2: 상품명 + 배지 — maxWidth:0은 table-layout:auto에서 셀이 내용만큼
          늘어나는 것을 막는 표준 수단이다. 이게 없으면 안쪽 말줄임이 걸리지 않는다. */}
      <td style={{ ...cell, paddingLeft: isChild ? 22 : 8, maxWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <button
            aria-label={expanded ? '상세 접기' : '상세 펼치기'}
            onClick={() => onToggleDetail(p.id)}
            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: E.inkMute }}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <span
            title={p.product_name}
            style={{
              fontWeight: 500,
              color: p.entry_count === 0 ? E.inkMute : E.ink,
              // 쿠팡 등록명은 옵션까지 붙어 100자를 넘는 일이 흔하다. 한 줄로 자르고
              // 전체는 title로 넘긴다 — 자르지 않으면 이 컬럼이 표 전체를 지배한다.
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {p.product_name}
          </span>
          <WinnerBadge status={p.winner_status} variant="compact" />
          {p.fifo_error && <OverstockBadge />}
        </div>
      </td>

      {/* 3: 매출(수량) */}
      <td style={numCell}>
        <div style={{ color: p.sale_count === 0 ? E.inkMute : E.ink }}>
          {p.sale_count === 0 ? '—' : fmt(p.total_sales_amount)}
        </div>
        {p.sale_count > 0 && (
          <div style={{ fontSize: 10, color: E.inkMute }}>{fmt(p.sale_quantity)}개</div>
        )}
      </td>

      {/* 4: 실현손익 */}
      <td style={{
        ...numCell,
        fontWeight: 600,
        color: p.total_realized_profit >= 0 ? E.profit : E.loss,
      }}>
        {p.fifo_error ? (
          <span style={{ color: E.loss }}>확인 필요</span>
        ) : p.sale_count === 0 ? (
          <span style={{ color: E.inkMute, fontWeight: 400 }}>—</span>
        ) : (
          `${p.total_realized_profit >= 0 ? '+' : '−'}${fmt(Math.abs(p.total_realized_profit))}`
        )}
      </td>

      {/* 5: 마진율 — 숫자 + 막대 */}
      <td style={{ ...numCell, color: p.margin_rate > 0 ? E.profit : p.margin_rate < 0 ? E.loss : E.inkMute }}>
        {p.margin_rate === 0 ? '—' : `${(p.margin_rate * 100).toFixed(1)}%`}
        {p.margin_rate !== 0 && (
          <div style={{
            height: 3, background: E.lineSoft, marginTop: 2, position: 'relative',
            // 셀이 넓어져도 막대는 88px에서 멈춘다. 늘어난 막대는 길이 비교를 흐린다.
            maxWidth: 88, marginLeft: 'auto',
          }}>
            <i style={{
              position: 'absolute', inset: '0 auto 0 0',
              width: `${Math.min(100, Math.abs(p.margin_rate) * 100 * 2)}%`,
              background: p.margin_rate > 0 ? E.profit : E.loss,
            }} />
          </div>
        )}
      </td>

      {/* 6: ROAS — 손익분기 대비 */}
      <td style={{
        ...numCell,
        color: p.ad_roas > 0 ? (p.ad_roas >= p.breakeven_roas ? E.profit : E.loss) : E.inkMute,
      }}>
        {p.ad_roas > 0 ? `${Math.round(p.ad_roas)}%` : '—'}
      </td>

      {/* 7: 재고 — 장부 재고(즉시) 위, RG 실재고(늦게 도착) 아래 */}
      <td style={numCell} title="위: 입고·판매로 계산한 장부 재고 / 아래: 로켓그로스 창고 실재고">
        <div style={{ color: p.current_stock > 0 ? E.ink : E.inkMute }}>{fmt(p.current_stock)}</div>
        {hasRgStock ? (
          <div style={{ fontSize: 10, color: rgStock === null ? E.inkMute : rgStock !== p.current_stock ? E.warn : E.inkMute }}>
            RG {rgStock === null ? '—' : fmt(rgStock)}
          </div>
        ) : rgInventoryLoading ? (
          <div style={{ fontSize: 10, color: E.inkMute }}>RG …</div>
        ) : null}
      </td>

      {/* 8: ⋯ 메뉴 */}
      <td style={{ padding: '4px 6px', textAlign: 'center', position: 'relative' }} onClick={(e) => e.stopPropagation()}>
        <button
          aria-label="행 메뉴"
          onClick={() => setMenuOpen((v) => !v)}
          style={{
            border: `1px solid ${E.line}`, background: E.surface, cursor: 'pointer',
            padding: '0 5px', height: 20, color: E.inkSub, display: 'inline-flex', alignItems: 'center',
          }}
        >
          <MoreHorizontal size={13} />
        </button>
        {menuOpen && (
          <div style={{
            position: 'absolute', right: 6, top: '100%', zIndex: 50,
            background: E.surface, border: `1px solid ${E.line}`,
            boxShadow: '0 4px 12px rgba(22,32,42,0.16)', minWidth: 96,
          }}>
            <button
              onClick={() => { setMenuOpen(false); onHide(p); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
                border: 'none', borderBottom: `1px solid ${E.lineSoft}`, background: 'none',
                cursor: 'pointer', fontSize: 11.5, color: E.ink, font: 'inherit', fontFamily: 'inherit',
              }}
            >
              {p.hidden ? '복원' : '숨기기'}
            </button>
            <button
              onClick={() => { setMenuOpen(false); onDelete(p); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
                border: 'none', background: 'none', cursor: 'pointer', fontSize: 11.5, color: E.loss,
                font: 'inherit', fontFamily: 'inherit',
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
