'use client';

import React, { useState } from 'react';
import type { ProductAdGrade, AdGrade } from '@/lib/ad-strategy/types';
import { useCostStore } from '@/lib/ad-strategy/use-cost-store';
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
  if (!actual) return <span style={{ color: '#9ca3af' }}>-</span>;
  const ok = actual >= breakEven;
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontWeight: 700, color: ok ? '#059669' : '#dc2626', fontSize: '13px' }}>
        {fmt(actual)}%
      </div>
      <div style={{ fontSize: '11px', color: '#9ca3af' }}>손익 {fmt(Math.round(breakEven))}%</div>
    </div>
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
          color: initialCost ? '#374151' : '#9ca3af',
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
  const { get, upsert, DEFAULT_FEE_RATE } = useCostStore();

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
            const feeRate = entry?.feeRate ?? DEFAULT_FEE_RATE;

            let profitCell: React.ReactNode = (
              <span style={{ color: '#9ca3af', fontSize: '12px' }}>원가 입력 후 계산</span>
            );
            let roasCell: React.ReactNode = <span style={{ color: '#9ca3af' }}>-</span>;

            if (costPrice !== undefined) {
              const margin = calcMarginPerUnit(p.currentPrice, costPrice, feeRate);
              const breakEven = calcBreakEvenRoas(p.currentPrice, margin);
              const { perUnit, monthly } = calcNetProfit({
                monthlySales: p.monthlySales,
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
                <td
                  style={{
                    padding: '10px 12px',
                    color: p.isItemWinner ? '#059669' : '#dc2626',
                    fontWeight: 600,
                  }}
                >
                  {p.isItemWinner ? 'O' : 'X'}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>{p.monthlySales}건</td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>{p.stock}개</td>
                <td style={{ padding: '10px 12px' }}>
                  <CostInput
                    initialCost={costPrice}
                    onSave={(cost) => upsert(p.name, cost)}
                  />
                </td>
                <td style={{ padding: '10px 12px' }}>{profitCell}</td>
                <td style={{ padding: '10px 12px' }}>{roasCell}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {p.suggestedDailyBudget ? fmt(p.suggestedDailyBudget) + '원' : '-'}
                </td>
                <td style={{ padding: '10px 12px', color: '#6b7280', maxWidth: '220px' }}>
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
