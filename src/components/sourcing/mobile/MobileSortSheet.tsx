'use client';

/**
 * 코스트코 모바일 정렬 바텀시트
 * 라디오 리스트 형식으로 정렬 옵션 표시, 선택 즉시 적용
 */

import React from 'react';
import type { CostcoSortKey } from '@/types/costco';
import MobileBottomSheet from './MobileBottomSheet';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface MobileSortSheetProps {
  isOpen: boolean;
  onClose: () => void;
  currentSort: CostcoSortKey;
  onSelect: (sort: CostcoSortKey) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// 정렬 옵션 목록
// ─────────────────────────────────────────────────────────────────────────────

const SORT_OPTIONS: { value: CostcoSortKey; label: string; desc: string }[] = [
  {
    value: 'sourcing_score_desc',
    label: '소싱스코어 높은순',
    desc: 'S~D 종합점수 기준',
  },
  {
    value: 'unit_saving_rate_desc',
    label: '단가절감율 높은순',
    desc: '코스트코 vs 네이버 단가비교',
  },
  {
    value: 'margin_rate_desc',
    label: '마진율 높은순',
    desc: '예상 순이익률',
  },
  {
    value: 'price_asc',
    label: '매입가 낮은순',
    desc: '부담 낮은 순',
  },
  {
    value: 'price_desc',
    label: '매입가 높은순',
    desc: '고가 상품 우선',
  },
  {
    value: 'review_count_desc',
    label: '리뷰 많은순',
    desc: '검증된 인기 상품',
  },
  {
    value: 'collected_desc',
    label: '최신 수집순',
    desc: '가장 최근에 수집된 상품',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 라디오 아이콘 (SVG 인라인)
// ─────────────────────────────────────────────────────────────────────────────

function RadioIcon({ checked }: { checked: boolean }) {
  return (
    <div
      style={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        border: `2px solid ${checked ? '#be0014' : '#d1d5db'}`,
        backgroundColor: checked ? '#be0014' : '#fff',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'border-color 0.15s, background-color 0.15s',
      }}
    >
      {checked && (
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: '#fff',
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

export default function MobileSortSheet({
  isOpen,
  onClose,
  currentSort,
  onSelect,
}: MobileSortSheetProps) {
  return (
    <MobileBottomSheet isOpen={isOpen} onClose={onClose} title="정렬" maxHeight={55}>
      <div>
        {SORT_OPTIONS.map((opt, idx) => {
          const isActive = currentSort === opt.value;
          const isLast = idx === SORT_OPTIONS.length - 1;

          return (
            <button
              key={opt.value}
              onClick={() => onSelect(opt.value)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                width: '100%',
                minHeight: '56px',
                padding: '12px 16px',
                backgroundColor: isActive ? '#fef2f2' : '#fff',
                border: 'none',
                borderBottom: isLast ? 'none' : '1px solid #f3f4f6',
                cursor: 'pointer',
                textAlign: 'left' as const,
                transition: 'background-color 0.1s',
              }}
            >
              <RadioIcon checked={isActive} />

              <div style={{ flex: 1 }}>
                <p
                  style={{
                    fontSize: '14px',
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? '#be0014' : '#1a1c1c',
                    marginBottom: '2px',
                    lineHeight: 1.3,
                  }}
                >
                  {opt.label}
                </p>
                <p
                  style={{
                    fontSize: '12px',
                    color: '#9ca3af',
                    lineHeight: 1.3,
                  }}
                >
                  {opt.desc}
                </p>
              </div>

              {/* 현재 선택 체크 표시 */}
              {isActive && (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 18 18"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  style={{ flexShrink: 0 }}
                >
                  <path
                    d="M3 9l4.5 4.5L15 5"
                    stroke="#be0014"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    </MobileBottomSheet>
  );
}
