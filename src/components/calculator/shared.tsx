'use client';

import React from 'react';
import type { CalcResult } from '@/lib/calculator/calculate';

// ─── 숫자 입력 필드 ───────────────────────────────────────────
export function NumberInput({
  label,
  value,
  onChange,
  suffix = '원',
  placeholder = '0',
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-[#52525b]">{label}</label>
      <div className="flex items-center rounded-lg border border-[#e5e5e5] bg-[#fafafa] transition-colors focus-within:border-[#a1a1aa] focus-within:bg-white">
        <input
          type="text"
          inputMode="numeric"
          value={value || ''}
          placeholder={placeholder}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9]/g, '');
            onChange(raw ? parseInt(raw, 10) : 0);
          }}
          className="w-full bg-transparent px-3 py-2.5 text-sm text-[#18181b] outline-none placeholder:text-[#c4c4c4]"
        />
        <span className="pr-3 text-xs text-[#a1a1aa]">{suffix}</span>
      </div>
    </div>
  );
}

// ─── 셀렉트 필드 ─────────────────────────────────────────────
export function SelectInput<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: readonly T[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-[#52525b]">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-3 py-2.5 text-sm text-[#18181b] outline-none transition-colors focus:border-[#a1a1aa] focus:bg-white"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── 라디오 그룹 ─────────────────────────────────────────────
export function RadioGroup<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-[#52525b]">{label}</label>
      <div className="flex gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
              value === opt.value
                ? 'border-[#18181b] bg-[#18181b] text-white'
                : 'border-[#e5e5e5] bg-white text-[#71717a] hover:border-[#d4d4d8]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── 결과 패널 ────────────────────────────────────────────────
export function ResultPanel({ result, isAdRunning = false }: {
  result: CalcResult | null;
  isAdRunning?: boolean;
}) {
  if (!result) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-dashed border-[#e5e5e5] bg-white p-8">
        <p className="text-sm text-[#a1a1aa]">금액을 입력하면 결과가 표시됩니다</p>
      </div>
    );
  }

  const isProfit = result.netProfit >= 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-sm">
      {/* 수수료 항목 */}
      <div className="border-b border-[#f4f4f5] p-4">
        <h3 className="mb-3 text-xs font-semibold text-[#71717a]">수수료 내역</h3>
        <div className="flex flex-col gap-2">
          {result.items
            .filter((item) => item.amount > 0)
            .map((item, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-xs text-[#71717a]">
                  {item.label}
                  {item.rate != null && item.rate > 0 && (
                    <span className="ml-1 text-[#a1a1aa]">
                      ({(item.rate * 100).toFixed(1)}%)
                    </span>
                  )}
                </span>
                <span className="text-sm font-medium text-[#ef4444]">
                  -{item.amount.toLocaleString()}원
                </span>
              </div>
            ))}
        </div>
      </div>

      {/* 합계 */}
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#71717a]">총 비용</span>
          <span className="text-sm font-semibold text-[#ef4444]">
            -{result.totalFees.toLocaleString()}원
          </span>
        </div>

        <div className="h-px bg-[#f4f4f5]" />

        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-[#18181b]">순이익</span>
          <span
            className={`text-lg font-bold ${isProfit ? 'text-[#16a34a]' : 'text-[#ef4444]'}`}
          >
            {result.netProfit >= 0 ? '+' : ''}
            {result.netProfit.toLocaleString()}원
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-[#71717a]">마진율</span>
          <span
            className={`text-sm font-bold ${isProfit ? 'text-[#16a34a]' : 'text-[#ef4444]'}`}
          >
            {result.marginRate.toFixed(1)}%
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-[#71717a]">손익분기 원가</span>
          <span className="text-sm font-medium text-[#18181b]">
            {result.breakEvenCost.toLocaleString()}원
          </span>
        </div>

        {/* 마진율 바 */}
        <div className="mt-1 overflow-hidden rounded-full bg-[#f4f4f5]">
          <div
            className="h-2 rounded-full transition-all duration-500"
            style={{
              width: `${Math.max(0, Math.min(100, result.marginRate))}%`,
              backgroundColor: isProfit ? '#16a34a' : '#ef4444',
            }}
          />
        </div>
      </div>

      {/* 광고 시뮬레이션 */}
      {isAdRunning && result.breakEvenRoas != null && (
        <div className="border-t border-[#f4f4f5] p-4">
          <h3 className="mb-3 text-xs font-semibold text-[#71717a]">광고 시뮬레이션</h3>
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#71717a]">광고 전 마진</span>
              <span className={`text-sm font-medium ${result.profitBeforeAd >= 0 ? 'text-[#16a34a]' : 'text-[#ef4444]'}`}>
                {result.profitBeforeAd >= 0 ? '+' : ''}{result.profitBeforeAd.toLocaleString()}원
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#71717a]" title="이 이하로 광고하면 적자">
                손익분기 ROAS
              </span>
              <span className="text-sm font-bold text-[#f59e0b]">
                {result.breakEvenRoas}%
              </span>
            </div>
            {result.targetRoas != null && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#71717a]" title="손익분기 ROAS + 200%">
                  권장 목표 ROAS
                </span>
                <span className="text-sm font-bold text-[#2563eb]">
                  {result.targetRoas}%
                </span>
              </div>
            )}
            {result.maxCpc != null && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#71717a]" title="이 금액 이하로 입찰해야 광고 흑자">
                  최대 CPC
                </span>
                <span className="text-sm font-bold text-[#7c3aed]">
                  {result.maxCpc.toLocaleString()}원
                </span>
              </div>
            )}
            <div className="mt-1 rounded-lg bg-[#fafafa] px-3 py-2">
              <p className="text-[11px] leading-relaxed text-[#a1a1aa]">
                ROAS {result.breakEvenRoas}% 미만 → 광고할수록 손해<br />
                권장: 광고비는 광고 전 마진의 30~40% 이내
                {result.profitBeforeAd > 0 && (
                  <> ({Math.round(result.profitBeforeAd * 0.3).toLocaleString()}~{Math.round(result.profitBeforeAd * 0.4).toLocaleString()}원)</>
                )}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 카드 래퍼 ────────────────────────────────────────────────
export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#e5e5e5] bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-xs font-semibold text-[#71717a]">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  );
}
