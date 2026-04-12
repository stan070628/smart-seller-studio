'use client';

/**
 * 활성 필터를 칩(chip)으로 표시하는 가로 스크롤 바
 * 각 칩 클릭 시 해당 필터만 제거
 */

import type { CostcoFilterState, CostcoSortKey } from '@/types/costco-mobile';

interface MobileFilterChipBarProps {
  filters: CostcoFilterState;
  sort: CostcoSortKey;
  onClearFilter: (key: keyof CostcoFilterState) => void;
  onClearSort: () => void;
}

// 정렬 키 → 표시 레이블
const SORT_LABELS: Record<CostcoSortKey, string> = {
  sourcing_score_desc:  '소싱점수순',
  unit_saving_rate_desc: '단가절감률순',
  margin_rate_desc:     '마진율순',
  price_asc:            '가격낮은순',
  price_desc:           '가격높은순',
  review_count_desc:    '리뷰많은순',
  collected_desc:       '최신수집순',
};

const DEFAULT_SORT: CostcoSortKey = 'sourcing_score_desc';

const GENDER_LABELS: Record<string, string> = {
  male_high:     '🔵 남성',
  male_friendly: '⚪ 남성친화',
  female:        '🚫 여성',
};

const GRADE_LABELS: Record<string, string> = {
  S: 'S등급',
  A: 'A등급',
  B: 'B등급',
  C: 'C등급',
  D: 'D등급',
};

const STOCK_LABELS: Record<string, string> = {
  inStock:    '재고있음',
  lowStock:   '품절임박',
  outOfStock: '품절',
};

// ─────────────────────────────────────────────────────────────────────────────
// 칩 공통 스타일
// ─────────────────────────────────────────────────────────────────────────────

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '4px 10px',
  backgroundColor: '#1a1c1c',
  color: '#ffffff',
  fontSize: '12px',
  fontWeight: 600,
  borderRadius: '20px',
  border: 'none',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  minHeight: '28px',
};

const closeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '14px',
  height: '14px',
  borderRadius: '50%',
  backgroundColor: 'rgba(255,255,255,0.25)',
  fontSize: '10px',
  lineHeight: 1,
  cursor: 'pointer',
};

interface ChipProps {
  label: string;
  onRemove: () => void;
}

function Chip({ label, onRemove }: ChipProps) {
  return (
    <button onClick={onRemove} style={chipStyle}>
      {label}
      <span style={closeStyle}>×</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

export default function MobileFilterChipBar({
  filters,
  sort,
  onClearFilter,
  onClearSort,
}: MobileFilterChipBarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        overflowX: 'auto',
        /* scrollbar 숨김 */
        scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch',
        backgroundColor: '#ffffff',
        borderBottom: '1px solid #f3f4f6',
      }}
    >
      {/* 정렬 칩 (기본값 아닐 때만) */}
      {sort !== DEFAULT_SORT && (
        <Chip
          label={SORT_LABELS[sort] ?? sort}
          onRemove={onClearSort}
        />
      )}

      {/* 카테고리 */}
      {filters.category !== '' && (
        <Chip
          label={filters.category}
          onRemove={() => onClearFilter('category')}
        />
      )}

      {/* 등급 */}
      {filters.grade !== 'all' && (
        <Chip
          label={GRADE_LABELS[filters.grade] ?? filters.grade}
          onRemove={() => onClearFilter('grade')}
        />
      )}

      {/* 재고 상태 */}
      {filters.stockStatus !== 'all' && (
        <Chip
          label={STOCK_LABELS[filters.stockStatus] ?? filters.stockStatus}
          onRemove={() => onClearFilter('stockStatus')}
        />
      )}

      {/* 성별 필터 */}
      {filters.genderFilter !== 'all' && (
        <Chip
          label={GENDER_LABELS[filters.genderFilter] ?? filters.genderFilter}
          onRemove={() => onClearFilter('genderFilter')}
        />
      )}

      {/* 별표 */}
      {filters.asteriskOnly && (
        <Chip
          label="★ 희소만"
          onRemove={() => onClearFilter('asteriskOnly')}
        />
      )}

      {/* 시즌 */}
      {filters.seasonOnly && (
        <Chip
          label="시즌상품만"
          onRemove={() => onClearFilter('seasonOnly')}
        />
      )}

      {/* CS 위험 표시 (기본 true이므로 false일 때 칩 표시) */}
      {!filters.hideHighCs && (
        <Chip
          label="고위험CS 포함"
          onRemove={() => onClearFilter('hideHighCs')}
        />
      )}

      {/* 차단 상품 표시 (기본 true이므로 false일 때 칩 표시) */}
      {!filters.hideBlocked && (
        <Chip
          label="차단상품 포함"
          onRemove={() => onClearFilter('hideBlocked')}
        />
      )}
    </div>
  );
}
