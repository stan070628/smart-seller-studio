'use client';

import type { SkuRoiData } from '@/lib/roi/types';
import { WinnerBadge } from '@/components/ui';

type Filter = 'all' | 'winner' | 'purchase-signal' | 'stock-warning';

interface Props {
  skus: SkuRoiData[];
  filter: Filter;
  onFilterChange: (f: Filter) => void;
  onSkuClick: (sku: SkuRoiData) => void;
}

const FILTERS: { key: Filter; label: string; disabled?: boolean }[] = [
  { key: 'all', label: '전체' },
  { key: 'winner', label: '위너만' },
  { key: 'purchase-signal', label: '사입권고' },
  { key: 'stock-warning', label: '재고경고', disabled: true },
];


function roasColor(adjusted: number, breakeven: number): string {
  if (breakeven === Infinity || adjusted === Infinity) return 'text-zinc-400';
  return adjusted >= breakeven ? 'text-green-400' : 'text-red-400';
}

function stockColor(status: 'danger' | 'warning' | 'ok'): string {
  if (status === 'danger') return 'text-red-400';
  if (status === 'warning') return 'text-yellow-400';
  return 'text-green-400';
}

export function SkuTable({ skus, filter, onFilterChange, onSkuClick }: Props) {
  const filtered = skus.filter((s) => {
    if (filter === 'winner') return s.winnerStatus === 'winner';
    if (filter === 'purchase-signal') return s.winnerStatus === 'winner' && s.netProfit > 0;
    if (filter === 'stock-warning') return s.stockTurnover.status !== 'ok';
    return true;
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => !f.disabled && onFilterChange(f.key)}
            disabled={f.disabled}
            title={f.disabled ? '재고 데이터 미연동 — 추후 지원 예정' : undefined}
            className={`px-3 py-1 rounded-full text-sm transition-colors ${
              f.disabled
                ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                : filter === f.key
                ? 'bg-red-600 text-white'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-zinc-500 self-center">{filtered.length}개 상품</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-800 text-zinc-400 text-left">
              <th className="px-4 py-3">상품명</th>
              <th className="px-4 py-3 text-right">판매가</th>
              <th className="px-4 py-3 text-right">마진율</th>
              <th className="px-4 py-3 text-right">광고비(보정)</th>
              <th className="px-4 py-3 text-right">ROAS(보정)</th>
              <th className="px-4 py-3 text-right">순이익</th>
              <th className="px-4 py-3 text-center">위너</th>
              <th className="px-4 py-3 text-center">재고회전</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">
                  해당 조건의 상품이 없습니다
                </td>
              </tr>
            )}
            {filtered.map((sku) => (
              <tr
                key={sku.productId}
                onClick={() => onSkuClick(sku)}
                className="border-t border-zinc-700 hover:bg-zinc-800 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3 text-white max-w-[200px] truncate">{sku.productName}</td>
                <td className="px-4 py-3 text-right text-zinc-300">
                  {sku.sellingPrice.toLocaleString()}원
                </td>
                <td className="px-4 py-3 text-right text-zinc-300">
                  {(sku.marginRate * 100).toFixed(1)}%
                </td>
                <td className="px-4 py-3 text-right text-zinc-300">
                  {sku.adSpend.toLocaleString()}원
                </td>
                <td className={`px-4 py-3 text-right font-medium ${roasColor(sku.adjustedRoas, sku.breakEvenRoas)}`}>
                  {sku.adjustedRoas === Infinity ? '—' : `${Math.round(sku.adjustedRoas)}%`}
                </td>
                <td className="px-4 py-3 text-right text-zinc-300">
                  {sku.netProfit.toLocaleString()}원
                </td>
                <td className="px-4 py-3 text-center">
                  <WinnerBadge status={sku.winnerStatus} />
                </td>
                <td className="px-4 py-3 text-center text-zinc-600">
                  —
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
