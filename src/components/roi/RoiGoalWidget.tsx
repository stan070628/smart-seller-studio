'use client';

import { calcRequiredRevenue, calcBreakevenRoas } from '@/lib/roi/calculations';

interface Props {
  targetProfit: number;
  marginRate: number;
  avgSellingPrice?: number;
  avgMarginAmount?: number;
  onTargetProfitChange: (v: number) => void;
  onMarginRateChange: (v: number) => void;
}

const PROFIT_OPTIONS = [1000000, 2000000, 3000000, 5000000, 10000000];
const MARGIN_OPTIONS = [0.2, 0.25, 0.3, 0.35, 0.4, 0.5];

export function RoiGoalWidget({
  targetProfit,
  marginRate,
  avgSellingPrice,
  avgMarginAmount,
  onTargetProfitChange,
  onMarginRateChange,
}: Props) {
  const requiredRevenue = calcRequiredRevenue(targetProfit, marginRate);
  const breakEvenRoas =
    avgSellingPrice != null && avgMarginAmount != null
      ? calcBreakevenRoas(avgSellingPrice, avgMarginAmount)
      : null;

  return (
    <div className="flex flex-wrap gap-4 items-center rounded-xl border border-zinc-700 bg-zinc-800 px-5 py-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-400">목표 순이익</span>
        <select
          value={targetProfit}
          onChange={(e) => onTargetProfitChange(Number(e.target.value))}
          className="rounded-md bg-zinc-700 px-2 py-1 text-sm text-white border border-zinc-600"
        >
          {PROFIT_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {(v / 10000).toLocaleString()}만원
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-400">기준 마진율</span>
        <select
          value={marginRate}
          onChange={(e) => onMarginRateChange(Number(e.target.value))}
          className="rounded-md bg-zinc-700 px-2 py-1 text-sm text-white border border-zinc-600"
        >
          {MARGIN_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {(v * 100).toFixed(0)}%
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <span className="text-sm text-zinc-400">필요 매출</span>
        <span className="text-lg font-bold text-white">
          {requiredRevenue === Infinity
            ? '—'
            : `${Math.round(requiredRevenue / 10000).toLocaleString()}만원`}
        </span>
      </div>

      {breakEvenRoas !== null && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-zinc-400">ROAS 손익분기</span>
          <span className="text-lg font-bold text-white">
            {breakEvenRoas === Infinity ? '—' : `${Math.round(breakEvenRoas)}%`}
          </span>
        </div>
      )}
    </div>
  );
}
