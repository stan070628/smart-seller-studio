'use client';

/**
 * NicheKeywordCard.tsx
 * 니치 키워드 카드 컴포넌트
 *
 * 등급 배지, 총점, 키워드명, 상품수/평균가, 첫 번째 시그널 표시
 */

import React, { useState } from 'react';
import type { NicheKeyword } from '@/types/niche';

// ─────────────────────────────────────────────────────────────────────────────
// 등급별 색상 매핑
// ─────────────────────────────────────────────────────────────────────────────
const GRADE_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  S: { bg: 'rgba(217, 179, 0, 0.12)',  text: '#b8950a',  border: 'rgba(217, 179, 0, 0.35)' },
  A: { bg: 'rgba(22, 163, 74, 0.1)',   text: '#15803d',  border: 'rgba(22, 163, 74, 0.3)' },
  B: { bg: 'rgba(37, 99, 235, 0.1)',   text: '#1d4ed8',  border: 'rgba(37, 99, 235, 0.3)' },
  C: { bg: 'rgba(217, 119, 6, 0.1)',   text: '#b45309',  border: 'rgba(217, 119, 6, 0.3)' },
  D: { bg: 'rgba(220, 38, 38, 0.1)',   text: '#b91c1c',  border: 'rgba(220, 38, 38, 0.3)' },
};

// 숫자 포맷 (천 단위)
function formatNumber(n: number | null): string {
  if (n === null || n === undefined) return '-';
  return n.toLocaleString('ko-KR');
}

// 가격 포맷 (만원 단위 변환)
function formatPrice(n: number | null): string {
  if (n === null || n === undefined) return '-';
  if (n >= 10000) {
    const man = Math.round(n / 1000) / 10;
    return `${man}만원`;
  }
  return `${n.toLocaleString('ko-KR')}원`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────
interface NicheKeywordCardProps {
  keyword: NicheKeyword;
  onSelect: (kw: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export default function NicheKeywordCard({ keyword, onSelect }: NicheKeywordCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const gradeColor = GRADE_COLOR[keyword.grade] ?? GRADE_COLOR['D'];
  const firstSignal = keyword.signals?.[0] ?? null;

  return (
    <div
      onClick={() => onSelect(keyword.keyword)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        backgroundColor: '#ffffff',
        border: `1px solid ${isHovered ? '#be0014' : '#eeeeee'}`,
        borderRadius: '10px',
        padding: '16px',
        cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: isHovered
          ? '0 4px 16px rgba(190, 0, 20, 0.1)'
          : '0 1px 4px rgba(0,0,0,0.05)',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      {/* 헤더 행: 등급 배지 + 총점 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* 등급 배지 */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            backgroundColor: gradeColor.bg,
            color: gradeColor.text,
            fontSize: '14px',
            fontWeight: '800',
            border: `1px solid ${gradeColor.border}`,
            flexShrink: 0,
          }}
        >
          {keyword.grade}
        </span>

        {/* 총점 */}
        <span
          style={{
            fontSize: '22px',
            fontWeight: '700',
            color: '#1a1c1c',
            lineHeight: 1,
          }}
        >
          {keyword.totalScore}
          <span style={{ fontSize: '12px', fontWeight: '500', color: '#926f6b', marginLeft: '2px' }}>
            /100
          </span>
        </span>
      </div>

      {/* 키워드명 */}
      <p
        style={{
          margin: 0,
          fontSize: '15px',
          fontWeight: '700',
          color: '#1a1c1c',
          letterSpacing: '-0.2px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {keyword.keyword}
      </p>

      {/* 상품수 / 평균가 */}
      <div style={{ display: 'flex', gap: '12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '11px', color: '#926f6b', fontWeight: 500 }}>상품수</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a1c1c' }}>
            {formatNumber(keyword.rawTotalProducts)}
          </span>
        </div>
        <div style={{ width: '1px', backgroundColor: '#eeeeee', alignSelf: 'stretch' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '11px', color: '#926f6b', fontWeight: 500 }}>평균가</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a1c1c' }}>
            {formatPrice(keyword.rawAvgPrice)}
          </span>
        </div>
      </div>

      {/* 첫 번째 시그널 */}
      {firstSignal && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '6px',
            backgroundColor: '#f9f9f9',
            borderRadius: '6px',
            padding: '8px 10px',
          }}
        >
          {/* 시그널 색상 점 */}
          <span
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              backgroundColor: keyword.grade === 'S' || keyword.grade === 'A' ? '#16a34a' : '#d97706',
              flexShrink: 0,
              marginTop: '4px',
            }}
          />
          <span
            style={{
              fontSize: '12px',
              color: '#4b5563',
              lineHeight: '1.5',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {firstSignal}
          </span>
        </div>
      )}
    </div>
  );
}
