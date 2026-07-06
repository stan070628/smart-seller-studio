'use client';

import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { GroupRow as GroupRowData, GroupableProduct } from '@/lib/cost-management/product-grouping';
import { OverstockBadge } from './OverstockBadge';

interface Props<T extends GroupableProduct> {
  group: GroupRowData<T>;
  expanded: boolean;
  colCount: number;
  onToggleGroup: (sellerProductId: string) => void;
  onToggleGroupHide: (group: GroupRowData<T>) => void;
}

const fmt = (n: number) => n.toLocaleString('ko-KR');

export default function GroupRow<T extends GroupableProduct>({ group, expanded, colCount, onToggleGroup, onToggleGroupHide }: Props<T>) {
  const allHidden = group.children.every((c) => (c as { hidden?: boolean }).hidden);
  const totalQty = group.children.reduce((s, c) => s + ((c as { sale_quantity?: number }).sale_quantity ?? 0), 0);
  const hasOverstock = group.children.some((c) => c.fifo_error);

  return (
    <tr
      style={{ background: '#fff7f7', cursor: 'pointer', borderLeft: '3px solid #be0014', borderBottom: expanded ? 'none' : '2px solid #fca5a5' }}
      onClick={() => onToggleGroup(group.sellerProductId)}
    >
      {/* 1: 채널/식별 */}
      <td style={{ padding: '8px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
        <span style={{ background: '#fef2f2', color: '#be0014', padding: '1px 5px', borderRadius: 3, fontSize: 8, fontWeight: 700 }}>쿠팡</span>
      </td>
      {/* 2: 상품명 + 옵션 수 */}
      <td style={{ padding: '8px 12px' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#18181b', display: 'flex', alignItems: 'center', gap: 6 }}>
          {group.productName}
          {hasOverstock && <OverstockBadge />}
        </div>
        <div style={{ fontSize: 10, color: '#a1a1aa' }}>{expanded ? '▴' : '▾'} 옵션 {group.children.length}개</div>
      </td>
      {/* 3: 매출(수량) */}
      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
        <div style={{ fontSize: 12, color: '#18181b' }}>{fmt(Math.round(group.totalSalesAmount))}원</div>
        {totalQty > 0 && <div style={{ fontSize: 8, color: '#a1a1aa' }}>{fmt(totalQty)}개 · 합계</div>}
      </td>
      {/* 4: 실현손익 (재고초과 자식 포함 시 과소집계 → * 마커) */}
      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: group.totalProfit >= 0 ? '#16a34a' : '#ef4444' }}>
        {fmt(Math.round(group.totalProfit))}원{hasOverstock && <span title="재고초과 옵션이 있어 실제보다 낮게 집계됨" style={{ color: '#dc2626' }}>*</span>}
      </td>
      {/* 5: 마진율 */}
      <td style={{ padding: '8px 12px', textAlign: 'right', color: '#2563eb' }}>{group.groupMarginRate.toFixed(1)}%</td>
      {/* 6: ROAS — 그룹 빈칸 */}
      <td style={{ padding: '8px 12px' }} />
      {/* 7: 그룹 ⋯ (전체 숨기기) — 전파 차단 */}
      <td style={{ padding: '8px 8px', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
        <button
          aria-label={allHidden ? '그룹 복원' : '그룹 전체 숨기기'}
          onClick={() => onToggleGroupHide(group)}
          style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, opacity: 0.5 }}
        >
          {allHidden ? <EyeOff size={13} color="#71717a" /> : <Eye size={13} color="#71717a" />}
        </button>
      </td>
    </tr>
  );
}
