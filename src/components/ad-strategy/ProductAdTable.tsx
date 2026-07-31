'use client';

import React, { useState, useEffect } from 'react';
import type { ProductAdGrade, AdGrade } from '@/lib/ad-strategy/types';
import { useCostStore } from '@/lib/ad-strategy/use-cost-store';

const SALES_LS_KEY = 'ad_strategy_sales_overrides';
const WINNER_LS_KEY = 'ad_strategy_winner_overrides';

function loadSalesOverrides(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SALES_LS_KEY) ?? '{}'); } catch { return {}; }
}

function loadWinnerOverrides(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(WINNER_LS_KEY) ?? '{}'); } catch { return {}; }
}

function SalesInput({ name, fallback, overrides, onSave }: {
  name: string;
  fallback: number;
  overrides: Record<string, number>;
  onSave: (name: string, qty: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const value = overrides[name] ?? fallback;
  const [draft, setDraft] = useState(String(value || ''));

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(String(value || '')); setEditing(true); }}
        style={{
          background: 'none',
          border: '1px dashed #d1d5db',
          borderRadius: '4px',
          padding: '3px 8px',
          fontSize: '12px',
          color: value > 0 ? '#111' : '#6b7280',
          fontWeight: value > 0 ? 600 : 400,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {value > 0 ? `${fmt(value)}건` : '입력'}
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
      <input
        autoFocus
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const v = parseInt(draft, 10);
            if (!isNaN(v) && v >= 0) { onSave(name, v); setEditing(false); }
          }
          if (e.key === 'Escape') setEditing(false);
        }}
        placeholder="판매건수"
        style={{ width: '70px', padding: '3px 6px', fontSize: '12px', border: '1px solid #6366f1', borderRadius: '4px', outline: 'none' }}
      />
      <button
        onClick={() => {
          const v = parseInt(draft, 10);
          if (!isNaN(v) && v >= 0) { onSave(name, v); setEditing(false); }
        }}
        style={{ padding: '3px 8px', fontSize: '11px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
      >
        저장
      </button>
    </div>
  );
}
import { resolveRgShippingFee, RG_SIZE_SPECS, RG_SIZE_TYPES, type RgSizeType } from '@/lib/roi/rg-fees';
import { effectiveFeeRate } from '@/lib/tax';
import {
  calcMarginPerUnit,
  calcBreakEvenRoas,
  calcNetProfit,
} from '@/lib/ad-strategy/net-profit';

const GRADE_COLOR: Record<AdGrade, string> = {
  A: '#059669',
  B: '#2563eb',
  C: '#d97706',
  HOLD: '#6b7280',
};

function fmt(n: number) {
  return n.toLocaleString('ko-KR');
}

function ProfitCell({ value, monthly }: { value: number; monthly: number }) {
  const color = value >= 0 ? '#059669' : '#dc2626';
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontWeight: 700, color, fontSize: '13px' }}>
        {value >= 0 ? '+' : ''}{fmt(value)}원
      </div>
      <div style={{ fontSize: '11px', color: '#9ca3af' }}>
        월 {monthly >= 0 ? '+' : ''}{fmt(monthly)}원
      </div>
    </div>
  );
}

function RoasCell({ actual, breakEven }: { actual?: number; breakEven: number }) {
  if (breakEven === Infinity) {
    return <span style={{ color: '#dc2626', fontSize: '12px' }}>마진 없음</span>;
  }
  if (!actual) {
    return (
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: '11px', color: '#9ca3af' }}>실ROAS 미집계</div>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>
          손익기준 {fmt(Math.round(breakEven))}%
        </div>
      </div>
    );
  }
  const ok = actual >= breakEven;
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontWeight: 700, color: ok ? '#059669' : '#dc2626', fontSize: '13px' }}>
        {fmt(actual)}%
      </div>
      <div style={{ fontSize: '11px', color: '#9ca3af' }}>손익기준 {fmt(Math.round(breakEven))}%</div>
    </div>
  );
}

/**
 * 로켓그로스 사이즈 유형 선택.
 * 지정하면 사이즈별 물류비(입출고비+배송비)가 마진에서 자동 차감된다.
 * 미지정 시 물류비 0으로 계산되어 마진이 과대평가되므로 경고색으로 표시한다.
 */
function RgSizeSelect({
  value,
  onChange,
}: {
  value: RgSizeType | null;
  onChange: (v: RgSizeType | null) => void;
}) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange((e.target.value || null) as RgSizeType | null)}
      title="로켓그로스 사이즈 유형 — 물류비가 마진에서 차감됩니다"
      style={{
        marginTop: '4px',
        display: 'block',
        width: '100%',
        border: `1px solid ${value ? '#d1d5db' : '#f0b100'}`,
        borderRadius: '4px',
        padding: '2px 4px',
        fontSize: '11px',
        color: value ? '#374151' : '#a16207',
        background: value ? '#fff' : '#fffbeb',
        cursor: 'pointer',
      }}
    >
      <option value="">사이즈 미지정 (물류비 0)</option>
      {RG_SIZE_TYPES.map((tp) => (
        <option key={tp} value={tp}>
          {RG_SIZE_SPECS[tp].label} · {fmt(resolveRgShippingFee(null, tp))}원
        </option>
      ))}
    </select>
  );
}

function CostInput({
  initialCost,
  onSave,
}: {
  initialCost?: number;
  onSave: (cost: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialCost ? String(initialCost) : '');

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        style={{
          background: 'none',
          border: '1px dashed #d1d5db',
          borderRadius: '4px',
          padding: '3px 8px',
          fontSize: '12px',
          color: initialCost ? '#374151' : '#6b7280',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {initialCost ? `${fmt(initialCost)}원` : '원가 입력'}
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
      <input
        autoFocus
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const v = parseInt(draft, 10);
            if (!isNaN(v) && v > 0) { onSave(v); setEditing(false); }
          }
          if (e.key === 'Escape') setEditing(false);
        }}
        placeholder="VAT포함 원가"
        style={{
          width: '90px',
          padding: '3px 6px',
          fontSize: '12px',
          border: '1px solid #6366f1',
          borderRadius: '4px',
          outline: 'none',
        }}
      />
      <button
        onClick={() => {
          const v = parseInt(draft, 10);
          if (!isNaN(v) && v > 0) { onSave(v); setEditing(false); }
        }}
        style={{
          padding: '3px 8px',
          fontSize: '11px',
          background: '#6366f1',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      >
        저장
      </button>
    </div>
  );
}

export default function ProductAdTable({ products }: { products: ProductAdGrade[] }) {
  const { get, upsert, setRgSizeType, DEFAULT_FEE_RATE } = useCostStore();
  const [salesOverrides, setSalesOverrides] = useState<Record<string, number>>({});
  const [winnerOverrides, setWinnerOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setSalesOverrides(loadSalesOverrides());
    setWinnerOverrides(loadWinnerOverrides());
  }, []);

  function handleSalesOverride(name: string, qty: number) {
    const next = { ...salesOverrides, [name]: qty };
    setSalesOverrides(next);
    localStorage.setItem(SALES_LS_KEY, JSON.stringify(next));
  }

  function handleWinnerToggle(name: string, current: boolean) {
    const next = { ...winnerOverrides, [name]: !current };
    setWinnerOverrides(next);
    localStorage.setItem(WINNER_LS_KEY, JSON.stringify(next));
  }

  if (products.length === 0) {
    return <p style={{ color: '#9ca3af', fontSize: '13px', margin: 0 }}>등급 데이터 없음</p>;
  }

  const headers = [
    '등급', '상품명', '위너', '30일 판매', '재고',
    '원가 입력', '건당 순이익', '실ROAS/손익기준', '권장 일예산', '이유',
  ];

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
            {headers.map((h) => (
              <th
                key={h}
                style={{
                  padding: '10px 12px',
                  textAlign: 'left',
                  fontWeight: 600,
                  color: '#374151',
                  whiteSpace: 'nowrap',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {products.map((p, i) => {
            const entry = get(p.name);
            const costPrice = entry?.costPrice;
            // 저장값(feeRate)은 쿠팡이 고지하는 요율(VAT 별도)이다. 이 화면에서는
            // 표시·편집되지 않는 값이라 저장 시점에 바꿀 이유가 없고, 이미 localStorage에
            // 고지 요율로 저장된 기존 항목과 의미가 섞이는 것도 피해야 한다. 간이과세자는
            // 매입세액 공제를 받지 못해 수수료 VAT가 그대로 비용이 되므로, 계산 시점에만
            // effectiveFeeRate로 변환해 마진 계산에 넣는다.
            const feeRate = entry?.feeRate ?? DEFAULT_FEE_RATE;
            // 로켓그로스 물류비: 사이즈 유형이 지정된 경우에만 차감된다.
            // 미지정 시 0이므로 마진이 과대평가되고 손익분기 ROAS가 과소평가된다.
            // CostEntry에는 실측 정산액 필드가 없으므로 measuredFee는 항상 null —
            // 사이즈 유형 기본값에 VAT를 반영한 실질 부담액이 쓰인다. 간이과세자는
            // 매입세액 공제를 받지 못해 물류비 VAT가 그대로 원가가 되기 때문이다.
            const rgShippingFee = resolveRgShippingFee(null, entry?.rgSizeType);
            const monthlySales = salesOverrides[p.name] ?? p.monthlySales;
            const isWinner = winnerOverrides[p.name] ?? p.isItemWinner;
            const winnerOverridden = p.name in winnerOverrides;

            let profitCell: React.ReactNode = (
              <span style={{ color: '#6b7280', fontSize: '12px' }}>원가 입력 후 계산</span>
            );
            let roasCell: React.ReactNode = <span style={{ color: '#9ca3af' }}>-</span>;

            if (costPrice !== undefined) {
              const margin = calcMarginPerUnit(
                p.currentPrice, costPrice, effectiveFeeRate(feeRate), rgShippingFee,
              );
              const breakEven = calcBreakEvenRoas(p.currentPrice, margin);
              const { perUnit, monthly } = calcNetProfit({
                monthlySales,
                monthlyAdSpend: p.adSpend ?? 0,
                marginPerUnit: margin,
              });
              profitCell = <ProfitCell value={perUnit} monthly={monthly} />;
              roasCell = <RoasCell actual={p.adRoas} breakEven={breakEven} />;
            }

            return (
              <tr
                key={p.name + i}
                style={{
                  borderBottom: '1px solid #f3f4f6',
                  background: i % 2 === 0 ? '#fff' : '#fafafa',
                }}
              >
                <td style={{ padding: '10px 12px' }}>
                  <span
                    style={{
                      fontWeight: 700,
                      color: GRADE_COLOR[p.grade],
                      background: `${GRADE_COLOR[p.grade]}18`,
                      padding: '3px 10px',
                      borderRadius: '4px',
                      fontSize: '12px',
                    }}
                  >
                    {p.grade}
                  </span>
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    color: '#111',
                    fontWeight: 500,
                    maxWidth: '200px',
                    wordBreak: 'keep-all',
                  }}
                >
                  {p.name}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <button
                    onClick={() => handleWinnerToggle(p.name, isWinner)}
                    title={winnerOverridden ? '직접 수정됨 (클릭해서 토글)' : '클릭해서 수정'}
                    style={{
                      background: 'none',
                      border: winnerOverridden ? '1px solid' : 'none',
                      borderColor: isWinner ? '#059669' : '#dc2626',
                      borderRadius: '4px',
                      padding: winnerOverridden ? '2px 6px' : '0',
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: '14px',
                      color: isWinner ? '#059669' : '#dc2626',
                    }}
                  >
                    {isWinner ? 'O' : 'X'}
                  </button>
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <SalesInput
                    name={p.name}
                    fallback={p.monthlySales}
                    overrides={salesOverrides}
                    onSave={handleSalesOverride}
                  />
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: '#111', fontWeight: 500 }}>{p.stock}개</td>
                <td style={{ padding: '10px 12px' }}>
                  <CostInput
                    initialCost={costPrice}
                    onSave={(cost) => upsert(p.name, cost)}
                  />
                  <RgSizeSelect
                    value={entry?.rgSizeType ?? null}
                    onChange={(v) => setRgSizeType(p.name, v)}
                  />
                </td>
                <td style={{ padding: '10px 12px' }}>{profitCell}</td>
                <td style={{ padding: '10px 12px' }}>{roasCell}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap', color: '#111', fontWeight: 500 }}>
                  {p.suggestedDailyBudget ? fmt(p.suggestedDailyBudget) + '원' : '-'}
                </td>
                <td style={{ padding: '10px 12px', color: '#374151', minWidth: '160px', maxWidth: '260px', wordBreak: 'keep-all', lineHeight: '1.5' }}>
                  {p.reason}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
