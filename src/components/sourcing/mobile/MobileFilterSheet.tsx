'use client';

/**
 * 코스트코 모바일 필터 바텀시트
 * 카테고리, 등급, 재고 상태, 성별 타겟, 기타 옵션(토글) 섹션으로 구성
 */

import React, { useState, useEffect } from 'react';
import type { SourcingGrade } from '@/lib/sourcing/shared/grade';
import { GRADE_COLORS } from '@/lib/sourcing/shared/grade';
import { STOCK_STATUS_LABELS } from '@/lib/sourcing/costco-constants';
import type { CostcoFilterState } from '@/types/costco-mobile';
import { DEFAULT_FILTER_STATE } from '@/types/costco-mobile';
import MobileBottomSheet from './MobileBottomSheet';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface MobileFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  filterState: CostcoFilterState;
  onApply: (newState: CostcoFilterState) => void;
  categories: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 스타일 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

const chipStyle = (active: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '6px 12px',
  borderRadius: '20px',
  fontSize: '13px',
  fontWeight: active ? 600 : 400,
  border: `1px solid ${active ? '#be0014' : '#e5e7eb'}`,
  backgroundColor: active ? '#fef2f2' : '#ffffff',
  color: active ? '#be0014' : '#374151',
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
  userSelect: 'none' as const,
  flexShrink: 0,
});

const gradeChipStyle = (
  grade: SourcingGrade | 'all',
  active: boolean,
): React.CSSProperties => {
  if (!active || grade === 'all') return chipStyle(active);
  const { color, bg } = GRADE_COLORS[grade];
  return {
    ...chipStyle(false),
    border: `1px solid ${color}`,
    backgroundColor: bg,
    color,
    fontWeight: 600,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 토글 스위치
// ─────────────────────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        backgroundColor: checked ? '#be0014' : '#d1d5db',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background-color 0.2s',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: '#fff',
          position: 'absolute',
          top: 2,
          left: checked ? 22 : 2,
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 섹션 구분 헤더
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <p
      style={{
        fontSize: '12px',
        fontWeight: 600,
        color: '#9ca3af',
        letterSpacing: '0.05em',
        textTransform: 'uppercase' as const,
        marginBottom: '10px',
      }}
    >
      {label}
    </p>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 가로 스크롤 칩 그룹
// ─────────────────────────────────────────────────────────────────────────────

function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '8px',
        overflowX: 'auto',
        paddingBottom: '4px',
        // 스크롤바 숨기기
        msOverflowStyle: 'none',
        scrollbarWidth: 'none',
      }}
    >
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 토글 행
// ─────────────────────────────────────────────────────────────────────────────

function ToggleRow({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 0',
      }}
    >
      <span style={{ fontSize: '14px', color: '#1a1c1c' }}>
        {icon} {label}
      </span>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

export default function MobileFilterSheet({
  isOpen,
  onClose,
  filterState,
  onApply,
  categories,
}: MobileFilterSheetProps) {
  // 바텀시트 내부에서 독립적으로 관리하는 로컬 상태
  const [localState, setLocalState] = useState<CostcoFilterState>(filterState);

  // isOpen이 true가 될 때마다 외부 filterState로 리셋
  useEffect(() => {
    if (isOpen) {
      setLocalState(filterState);
    }
  }, [isOpen, filterState]);

  // 등급 옵션
  const GRADE_OPTIONS: Array<SourcingGrade | 'all'> = ['all', 'S', 'A', 'B', 'C', 'D'];

  // 재고 상태 옵션
  const STOCK_OPTIONS: Array<{ value: CostcoFilterState['stockStatus']; label: string }> = [
    { value: 'all', label: '전체' },
    { value: 'inStock', label: STOCK_STATUS_LABELS.inStock },
    { value: 'lowStock', label: STOCK_STATUS_LABELS.lowStock },
    { value: 'outOfStock', label: STOCK_STATUS_LABELS.outOfStock },
  ];

  // 성별 타겟 옵션
  const GENDER_OPTIONS: Array<{ value: CostcoFilterState['genderFilter']; label: string }> = [
    { value: 'all', label: '전체' },
    { value: 'male_high', label: '🔵 남성타겟' },
    { value: 'male_friendly', label: '🔵 남성친화' },
    { value: 'female', label: '🚫 여성' },
  ];

  return (
    <MobileBottomSheet isOpen={isOpen} onClose={onClose} title="필터" maxHeight={90}>
      {/* 스크롤 콘텐츠 */}
      <div style={{ padding: '8px 16px 0' }}>

        {/* ── 카테고리 ───────────────────────────────────────────────────── */}
        <div style={{ marginBottom: '20px' }}>
          <SectionHeader label="카테고리" />
          <ChipRow>
            {/* 전체 칩 */}
            <button
              style={chipStyle(localState.category === '')}
              onClick={() => setLocalState((prev) => ({ ...prev, category: '' }))}
            >
              전체
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                style={chipStyle(localState.category === cat)}
                onClick={() => setLocalState((prev) => ({ ...prev, category: cat }))}
              >
                {cat}
              </button>
            ))}
          </ChipRow>
        </div>

        {/* ── 등급 ───────────────────────────────────────────────────────── */}
        <div style={{ marginBottom: '20px' }}>
          <SectionHeader label="등급" />
          <ChipRow>
            {GRADE_OPTIONS.map((g) => (
              <button
                key={g}
                style={gradeChipStyle(g, localState.grade === g)}
                onClick={() =>
                  setLocalState((prev) => ({
                    ...prev,
                    grade: g,
                  }))
                }
              >
                {g === 'all' ? '전체' : g}
              </button>
            ))}
          </ChipRow>
        </div>

        {/* ── 재고 상태 ───────────────────────────────────────────────────── */}
        <div style={{ marginBottom: '20px' }}>
          <SectionHeader label="재고 상태" />
          <ChipRow>
            {STOCK_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                style={chipStyle(localState.stockStatus === opt.value)}
                onClick={() =>
                  setLocalState((prev) => ({ ...prev, stockStatus: opt.value }))
                }
              >
                {opt.label}
              </button>
            ))}
          </ChipRow>
        </div>

        {/* ── 성별 타겟 ───────────────────────────────────────────────────── */}
        <div style={{ marginBottom: '20px' }}>
          <SectionHeader label="성별 타겟" />
          <ChipRow>
            {GENDER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                style={chipStyle(localState.genderFilter === opt.value)}
                onClick={() =>
                  setLocalState((prev) => ({ ...prev, genderFilter: opt.value }))
                }
              >
                {opt.label}
              </button>
            ))}
          </ChipRow>
        </div>

        {/* ── 기타 옵션 ───────────────────────────────────────────────────── */}
        <div style={{ marginBottom: '8px' }}>
          <SectionHeader label="기타 옵션" />

          <ToggleRow
            icon="★"
            label="별표 상품만"
            checked={localState.asteriskOnly}
            onChange={(v) => setLocalState((prev) => ({ ...prev, asteriskOnly: v }))}
          />
          <ToggleRow
            icon="🌿"
            label="시즌 상품만"
            checked={localState.seasonOnly}
            onChange={(v) => setLocalState((prev) => ({ ...prev, seasonOnly: v }))}
          />

          {/* 구분선 */}
          <div style={{ borderTop: '1px solid #f3f4f6', margin: '4px 0' }} />

          <ToggleRow
            icon="🚫"
            label="고위험CS 숨기기"
            checked={localState.hideHighCs}
            onChange={(v) => setLocalState((prev) => ({ ...prev, hideHighCs: v }))}
          />
          <ToggleRow
            icon="⛔"
            label="차단 상품 숨기기"
            checked={localState.hideBlocked}
            onChange={(v) => setLocalState((prev) => ({ ...prev, hideBlocked: v }))}
          />
        </div>
      </div>

      {/* ── 하단 고정 버튼 ───────────────────────────────────────────────── */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          display: 'flex',
          gap: 8,
          padding: '12px 16px',
          backgroundColor: '#fff',
          borderTop: '1px solid #e5e7eb',
        }}
      >
        <button
          onClick={() => setLocalState(DEFAULT_FILTER_STATE)}
          style={{
            flex: 1,
            height: 44,
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            fontSize: 14,
            color: '#6b7280',
            cursor: 'pointer',
            backgroundColor: '#fff',
          }}
        >
          초기화
        </button>
        <button
          onClick={() => onApply(localState)}
          style={{
            flex: 2,
            height: 44,
            backgroundColor: '#be0014',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          적용
        </button>
      </div>
    </MobileBottomSheet>
  );
}
