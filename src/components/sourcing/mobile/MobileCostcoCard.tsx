'use client';

/**
 * 코스트코 모바일 상품 카드 컴포넌트
 * 등급, 남성타겟, 별표, 재고 배지 + 가격/단가절감율 표시
 */

import { useState, useCallback } from 'react';
import type { CostcoProductRow } from '@/types/costco';
import { getGrade, GRADE_COLORS } from '@/lib/sourcing/shared/grade';
import { classifyMaleTarget } from '@/lib/sourcing/shared/male-classifier';
import {
  calcRecommendedPrice,
  getWeightKgFromProduct,
} from '@/lib/sourcing/costco-pricing';
import { STOCK_STATUS_LABELS } from '@/lib/sourcing/costco-constants';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface MobileCostcoCardProps {
  product: CostcoProductRow;
  onTap: (product: CostcoProductRow) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// 색상 상수
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  card:    '#ffffff',
  border:  '#e5e7eb',
  text:    '#1a1c1c',
  sub:     '#6b7280',
  green:   '#16a34a',
  orange:  '#ea580c',
  red:     '#dc2626',
  amber:   '#d97706',
  amberBg: '#fef3c7',
  blue:    '#2563eb',
  blueBg:  '#eff6ff',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 공통 배지 스타일
// ─────────────────────────────────────────────────────────────────────────────

const BADGE: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 600,
  padding: '2px 6px',
  borderRadius: '6px',
  whiteSpace: 'nowrap',
};

// ─────────────────────────────────────────────────────────────────────────────
// 재고 상태 색상
// ─────────────────────────────────────────────────────────────────────────────

const STOCK_COLOR: Record<string, string> = {
  inStock:    C.green,
  lowStock:   C.orange,
  outOfStock: C.red,
};

const STOCK_BG: Record<string, string> = {
  inStock:    'rgba(22,163,74,0.08)',
  lowStock:   'rgba(234,88,12,0.08)',
  outOfStock: 'rgba(220,38,38,0.08)',
};

// ─────────────────────────────────────────────────────────────────────────────
// 숫자 포맷 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('ko-KR');
}

function fmtRate(n: number): string {
  return `${Math.abs(n).toFixed(1)}%`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

export default function MobileCostcoCard({ product, onTap }: MobileCostcoCardProps) {
  const [pressed, setPressed] = useState(false);

  const handleTouchStart = useCallback(() => setPressed(true), []);
  const handleTouchEnd = useCallback(() => setPressed(false), []);
  const handleClick = useCallback(() => onTap(product), [onTap, product]);

  // ── 등급 계산 ─────────────────────────────────────────────────────────────
  const score = product.costco_score_total ?? product.sourcing_score;
  const gradeInfo = getGrade(score);
  const gradeColor = GRADE_COLORS[gradeInfo.grade];

  // ── 남성타겟 분류 ─────────────────────────────────────────────────────────
  // DB에 male_tier가 있으면 그것을 우선 사용
  const maleTier = product.male_tier ?? classifyMaleTarget(product.title, product.category_name ?? '').tier;
  const maleLabel =
    maleTier === 'high'    ? '🔵 남성' :
    maleTier === 'mid'     ? '⚪ 친화' :
    maleTier === 'female'  ? '🚫 여성' :
    null;

  // ── 추천판매가 계산 ───────────────────────────────────────────────────────
  const weightKg = getWeightKgFromProduct(product);
  const priceResult = calcRecommendedPrice(
    product.price,
    product.category_name,
    'naver',
    weightKg,
    product.market_lowest_price ?? null,
  );
  const { recommendedPrice, realMarginRate } = priceResult;

  // ── 단가 절감율 ───────────────────────────────────────────────────────────
  let unitSavingRate: number | null = null;
  if (product.unit_price && product.market_unit_price) {
    unitSavingRate = (product.market_unit_price / product.unit_price - 1) * 100;
  }

  // ── 차단 여부 ─────────────────────────────────────────────────────────────
  const isBlocked = product.blocked_reason !== null && product.blocked_reason !== undefined;

  // ── 카드 테두리 (검토필요) ─────────────────────────────────────────────────
  const cardBorder = product.needs_review
    ? '2px solid #f59e0b'
    : `1px solid ${C.border}`;

  return (
    <div
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      style={{
        position: 'relative',
        background: C.card,
        borderRadius: 12,
        margin: '8px 12px',
        padding: '12px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        border: cardBorder,
        cursor: 'pointer',
        opacity: isBlocked ? 0.5 : 1,
        backgroundColor: pressed ? '#f9fafb' : C.card,
        transition: 'background-color 0.1s',
      }}
    >
      {/* 차단 배지 (우측 상단) */}
      {isBlocked && (
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            ...BADGE,
            color: C.red,
            backgroundColor: 'rgba(220,38,38,0.10)',
          }}
        >
          🚫 차단
        </div>
      )}

      {/* ── 행1: 이미지 + 상품명/브랜드 ─────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
        {/* 이미지 */}
        <div
          style={{
            width: 56,
            height: 56,
            flexShrink: 0,
            borderRadius: '8px',
            overflow: 'hidden',
            backgroundColor: '#f3f4f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {product.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.image_url}
              alt={product.title}
              width={56}
              height={56}
              style={{ objectFit: 'cover', width: '100%', height: '100%' }}
              loading="lazy"
            />
          ) : (
            <span style={{ fontSize: '24px' }}>📦</span>
          )}
        </div>

        {/* 상품명 + 브랜드/카테고리 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontSize: '13px',
              fontWeight: 600,
              color: C.text,
              lineHeight: '1.4',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              wordBreak: 'keep-all',
              paddingRight: isBlocked ? '48px' : 0,
            }}
          >
            {product.title}
          </p>
          <p
            style={{
              margin: '2px 0 0',
              fontSize: '11px',
              color: C.sub,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {[product.brand, product.category_name].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      {/* ── 행2: 배지들 ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px',
          marginTop: '8px',
        }}
      >
        {/* 등급 배지 */}
        <span
          style={{
            ...BADGE,
            color: gradeColor.color,
            backgroundColor: gradeColor.bg,
          }}
        >
          {gradeInfo.grade} {score}점
        </span>

        {/* 남성타겟 배지 */}
        {maleLabel && (
          <span
            style={{
              ...BADGE,
              color: maleTier === 'female' ? C.red : C.blue,
              backgroundColor: maleTier === 'female' ? 'rgba(220,38,38,0.08)' : C.blueBg,
            }}
          >
            {maleLabel}
          </span>
        )}

        {/* 별표(희소) 배지 */}
        {product.has_asterisk && (
          <span
            style={{
              ...BADGE,
              color: C.amber,
              backgroundColor: C.amberBg,
            }}
          >
            ★ 희소
          </span>
        )}

        {/* 재고 배지 */}
        <span
          style={{
            ...BADGE,
            color: STOCK_COLOR[product.stock_status] ?? C.sub,
            backgroundColor: STOCK_BG[product.stock_status] ?? 'rgba(107,114,128,0.08)',
          }}
        >
          {STOCK_STATUS_LABELS[product.stock_status] ?? product.stock_status}
        </span>
      </div>

      {/* ── 행3: 가격 ────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginTop: '8px',
        }}
      >
        {/* 매입가 */}
        <div>
          <span style={{ fontSize: '11px', color: C.sub }}>매입가 </span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>
            {fmt(product.price)}원
          </span>
        </div>

        {/* 추천판매가 + 마진율 */}
        <div style={{ textAlign: 'right' }}>
          <div>
            <span style={{ fontSize: '11px', color: C.sub }}>추천판매가 </span>
            <span style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>
              {fmt(recommendedPrice)}원
            </span>
            <span style={{ fontSize: '10px', color: C.sub, marginLeft: '2px' }}>(N)</span>
          </div>
          <div>
            <span
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: realMarginRate >= 15 ? C.green : realMarginRate >= 8 ? C.blue : C.red,
              }}
            >
              마진 {realMarginRate.toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      {/* ── 행4: 단가 비교 (unit_price + market_unit_price 둘 다 있을 때만) ── */}
      {unitSavingRate !== null && product.unit_price && product.market_unit_price && (
        <div
          style={{
            marginTop: '6px',
            paddingTop: '6px',
            borderTop: `1px solid ${C.border}`,
            fontSize: '11px',
            color: C.sub,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            flexWrap: 'wrap',
          }}
        >
          <span>
            코 {fmt(Math.round(product.unit_price))}{product.unit_price_label ? `/${product.unit_price_label}` : ''}
          </span>
          <span>·</span>
          <span>
            네 {fmt(Math.round(product.market_unit_price))}{product.unit_price_label ? `/${product.unit_price_label}` : ''}
          </span>
          <span>·</span>
          <span
            style={{
              fontWeight: 700,
              color: unitSavingRate > 0 ? C.green : C.red,
            }}
          >
            {unitSavingRate > 0
              ? `▼${fmtRate(unitSavingRate)} 저렴`
              : `▲${fmtRate(unitSavingRate)} 비쌈`}
          </span>
        </div>
      )}
    </div>
  );
}
