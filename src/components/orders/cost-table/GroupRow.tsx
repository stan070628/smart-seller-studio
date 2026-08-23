'use client';

import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { GroupRow as GroupRowData, GroupableProduct } from '@/lib/cost-management/product-grouping';
import { E } from '@/lib/design-tokens';
import { OverstockBadge } from './OverstockBadge';

interface Props<T extends GroupableProduct> {
  group: GroupRowData<T>;
  expanded: boolean;
  colCount: number;
  onToggleGroup: (sellerProductId: string) => void;
  onToggleGroupHide: (group: GroupRowData<T>) => void;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

const numCell: React.CSSProperties = {
  padding: '4px 8px',
  textAlign: 'right',
  fontFamily: E.mono,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
  borderRight: `1px solid ${E.lineSoft}`,
};

export default function GroupRow<T extends GroupableProduct>({
  group, expanded, onToggleGroup, onToggleGroupHide,
}: Props<T>) {
  const allHidden = group.children.every((c) => (c as { hidden?: boolean }).hidden);
  const totalQty = group.children.reduce((s, c) => s + ((c as { sale_quantity?: number }).sale_quantity ?? 0), 0);
  const totalStock = group.children.reduce((s, c) => s + ((c as { current_stock?: number }).current_stock ?? 0), 0);
  const hasOverstock = group.children.some((c) => c.fifo_error);

  const cell: React.CSSProperties = {
    padding: '4px 8px',
    borderRight: `1px solid ${E.lineSoft}`,
    verticalAlign: 'middle',
  };

  return (
    <tr
      style={{
        background: E.chrome,
        cursor: 'pointer',
        boxShadow: `inset 3px 0 0 ${E.accent}`,
        borderBottom: `1px solid ${E.line}`,
        fontWeight: 600,
      }}
      onClick={() => onToggleGroup(group.sellerProductId)}
    >
      {/* 1: 채널 */}
      <td style={{ ...cell, textAlign: 'center', whiteSpace: 'nowrap' }}>
        <span style={{
          fontSize: 9.5, fontWeight: 700, padding: '1px 4px',
          border: `1px solid ${E.accentLine}`, background: E.accentSoft, color: E.accent,
        }}>
          쿠팡
        </span>
      </td>

      {/* 2: 상품명 + 옵션 수 — maxWidth:0은 ProductRow와 같은 이유다 */}
      <td style={{ ...cell, maxWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: E.ink, minWidth: 0 }}>
          <span style={{ color: E.inkMute, fontFamily: E.mono, fontSize: 11, width: 10, textAlign: 'center', flexShrink: 0 }}>
            {expanded ? '▾' : '▸'}
          </span>
          <span
            title={group.productName}
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
          >
            {group.productName}
          </span>
          <span style={{ fontSize: 10, color: E.inkMute, fontWeight: 400, flexShrink: 0 }}>옵션 {group.children.length}</span>
          {hasOverstock && <OverstockBadge />}
        </div>
      </td>

      {/* 3: 매출(수량) */}
      <td style={numCell}>
        <div style={{ color: E.ink }}>{fmt(Math.round(group.totalSalesAmount))}</div>
        {totalQty > 0 && <div style={{ fontSize: 10, color: E.inkMute, fontWeight: 400 }}>{fmt(totalQty)}개</div>}
      </td>

      {/* 4: 실현손익 — 재고초과 자식이 있으면 과소집계라 * 마커 */}
      <td style={{ ...numCell, color: group.totalProfit >= 0 ? E.profit : E.loss }}>
        {group.totalProfit >= 0 ? '+' : '−'}{fmt(Math.abs(Math.round(group.totalProfit)))}
        {hasOverstock && (
          <span title="재고초과 옵션이 있어 실제보다 낮게 집계됨" style={{ color: E.loss }}>*</span>
        )}
      </td>

      {/* 5: 마진율 */}
      <td style={{ ...numCell, color: group.groupMarginRate >= 0 ? E.profit : E.loss }}>
        {group.groupMarginRate.toFixed(1)}%
      </td>

      {/* 6: ROAS — 그룹 단위 광고비는 집계하지 않는다 */}
      <td style={{ ...numCell, color: E.inkMute, fontWeight: 400 }}>—</td>

      {/* 7: 재고 합계 */}
      <td style={{ ...numCell, color: totalStock > 0 ? E.ink : E.inkMute }}>{fmt(totalStock)}</td>

      {/* 8: 그룹 전체 숨기기 — 전파 차단 */}
      <td style={{ padding: '4px 6px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
        <button
          aria-label={allHidden ? '그룹 복원' : '그룹 전체 숨기기'}
          onClick={() => onToggleGroupHide(group)}
          style={{
            border: `1px solid ${E.line}`, background: E.surface, cursor: 'pointer',
            padding: '0 5px', height: 20, display: 'inline-flex', alignItems: 'center', color: E.inkSub,
          }}
        >
          {allHidden ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
      </td>
    </tr>
  );
}
