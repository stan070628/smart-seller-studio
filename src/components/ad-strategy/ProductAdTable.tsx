'use client';

import React from 'react';
import type { ProductAdGrade, AdGrade } from '@/lib/ad-strategy/types';

const GRADE_COLOR: Record<AdGrade, string> = {
  A: '#059669',
  B: '#2563eb',
  C: '#d97706',
  HOLD: '#6b7280',
};

export default function ProductAdTable({ products }: { products: ProductAdGrade[] }) {
  if (products.length === 0) {
    return <p style={{ color: '#9ca3af', fontSize: '13px', margin: 0 }}>등급 데이터 없음</p>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
            {['등급', '상품명', '위너', '30일 판매', '재고', '권장 일예산', '이유'].map((h) => (
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
          {products.map((p, i) => (
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
                  maxWidth: '240px',
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
              <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                {p.monthlySales}건
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                {p.stock}개
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                {p.suggestedDailyBudget
                  ? p.suggestedDailyBudget.toLocaleString('ko-KR') + '원'
                  : '-'}
              </td>
              <td style={{ padding: '10px 12px', color: '#6b7280', maxWidth: '260px' }}>
                {p.reason}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
