'use client';

/**
 * 코스트코 상품 상세 바텀시트 내용
 * MobileBottomSheet의 children으로 사용 — 자체적으로 MobileBottomSheet를 감싸지 않음
 *
 * 섹션 구조:
 *   헤더   → 이미지 + 상품명 + 부가정보
 *   섹션1  → 기본 정보 테이블
 *   섹션2  → 단가 비교
 *   섹션3  → 가격 분석 (네이버 / 쿠팡)
 *   섹션4  → v2 소싱 스코어 아코디언
 *   섹션5  → 외부 링크
 */

import React, { useState } from 'react';
import type { CostcoProductRow } from '@/types/costco';
import {
  calcRecommendedPrice,
  getWeightKgFromProduct,
  getPriceCompStatus,
  PRICE_COMP_STYLE,
} from '@/lib/sourcing/costco-pricing';
import { getGrade } from '@/lib/sourcing/shared/grade';
import { classifyMaleTarget } from '@/lib/sourcing/shared/male-classifier';
import { getSeasonBonus } from '@/lib/sourcing/shared/season-bonus';
import { STOCK_STATUS_LABELS } from '@/lib/sourcing/costco-constants';
import { COSTCO_SCORE_MAX } from '@/lib/sourcing/costco-scoring';
import MobileScoreBreakdown from './MobileScoreBreakdown';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface MobileCostcoDetailProps {
  product: CostcoProductRow;
  onClose: () => void;
  onUpdateProduct: (productCode: string, patch: Partial<CostcoProductRow>) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// 색상 상수
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  card:      '#ffffff',
  border:    '#e5e7eb',
  text:      '#1a1c1c',
  sub:       '#6b7280',
  green:     '#16a34a',
  greenBg:   '#f0fdf4',
  orange:    '#ea580c',
  red:       '#dc2626',
  redBg:     '#fef2f2',
  accent:    '#be0014',
  accentBg:  '#fef2f2',
  naver:     '#03c75a',
  naverBg:   '#e8f9ee',
  coupang:   '#e52222',
  coupangBg: '#fff0f0',
  sectionBg: '#f9fafb',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/** 숫자를 한국 원화 형식으로 포맷 */
function fmtPrice(n: number): string {
  return n.toLocaleString('ko-KR') + '원';
}

/** 퍼센트 포맷 (소수점 1자리) */
function fmtPct(n: number): string {
  return n.toFixed(1) + '%';
}

/** 섹션 컨테이너 공통 스타일 */
function SectionWrapper({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        backgroundColor: C.card,
        borderTop: `1px solid ${C.border}`,
        padding: '16px',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** 섹션 제목 */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: '13px',
        fontWeight: 700,
        color: C.sub,
        letterSpacing: '0.5px',
        textTransform: 'uppercase',
        marginBottom: '12px',
      }}
    >
      {children}
    </p>
  );
}

/** 재고 상태 배지 */
function StockBadge({ status }: { status: string }) {
  const label = STOCK_STATUS_LABELS[status] ?? status;
  const color =
    status === 'inStock'    ? C.green :
    status === 'lowStock'   ? C.orange :
    C.red;
  const bg =
    status === 'inStock'    ? C.greenBg :
    status === 'lowStock'   ? '#fff7ed' :
    C.redBg;

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '11px',
        fontWeight: 700,
        color,
        backgroundColor: bg,
      }}
    >
      {label}
    </span>
  );
}

/** 등급 배지 */
function GradeBadge({ score }: { score: number }) {
  const info = getGrade(score);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '28px',
        height: '28px',
        borderRadius: '6px',
        fontSize: '14px',
        fontWeight: 800,
        color: info.color,
        backgroundColor: info.bg,
      }}
    >
      {info.grade}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

export default function MobileCostcoDetail({
  product,
  onClose,
  onUpdateProduct,
}: MobileCostcoDetailProps) {
  // 스코어 아코디언 상태
  const [scoreOpen, setScoreOpen] = useState(false);

  // 시장가 편집 상태
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInputVal, setPriceInputVal] = useState(
    String(product.market_lowest_price ?? ''),
  );
  const [isSavingPrice, setIsSavingPrice] = useState(false);

  // ── 파생값 계산 ────────────────────────────────────────────────────────────
  const weightKg = getWeightKgFromProduct(product);
  const marketPrice = product.market_lowest_price ?? null;

  const naverResult  = calcRecommendedPrice(product.price, product.category_name, 'naver',   weightKg, marketPrice);
  const coupangResult = calcRecommendedPrice(product.price, product.category_name, 'coupang', weightKg, marketPrice);

  const naverStatus   = getPriceCompStatus(naverResult.vsMarket);
  const coupangStatus = getPriceCompStatus(coupangResult.vsMarket);

  const maleInfo    = classifyMaleTarget(product.title, product.category_name ?? '');
  const seasonInfo  = getSeasonBonus(product.title);

  // v2 스코어 총계 (DB 저장값 우선, 없으면 기존 sourcing_score)
  const scoreTotal = product.costco_score_total ?? product.sourcing_score ?? 0;

  // 보너스 표시용 항목 조합
  const bonusItems: string[] = [];
  if ((product.male_bonus ?? 0) > 0) {
    bonusItems.push(`남성 +${product.male_bonus}`);
  }
  if ((product.season_bonus ?? 0) > 0) {
    bonusItems.push(`시즌 +${product.season_bonus}`);
  }
  if (product.has_asterisk && (product.asterisk_bonus ?? 0) > 0) {
    bonusItems.push(`별표 +${product.asterisk_bonus}`);
  }

  // 단가 절감율 계산
  const hasBothUnitPrices =
    typeof product.unit_price === 'number' &&
    typeof product.market_unit_price === 'number' &&
    product.market_unit_price > 0;

  const unitSavingRate = hasBothUnitPrices
    ? ((product.market_unit_price! - product.unit_price!) / product.market_unit_price!) * 100
    : null;

  // ── 시장가 저장 핸들러 ─────────────────────────────────────────────────────
  async function handleSaveMarketPrice() {
    const newPrice = parseInt(priceInputVal, 10);
    if (isNaN(newPrice) || newPrice <= 0) return;

    const originalPrice = product.market_lowest_price;

    // Optimistic update — 성공 전 미리 반영
    onUpdateProduct(product.product_code, { market_lowest_price: newPrice });
    setEditingPrice(false);
    setIsSavingPrice(true);

    try {
      const res = await fetch('/api/sourcing/costco/market-price', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productCode: product.product_code, marketPrice: newPrice }),
      });

      if (!res.ok) throw new Error('API 오류');
    } catch {
      // 실패 시 원래 값으로 복원
      onUpdateProduct(product.product_code, { market_lowest_price: originalPrice });
      setPriceInputVal(String(originalPrice ?? ''));
      setEditingPrice(true);
    } finally {
      setIsSavingPrice(false);
    }
  }

  // ── 검토 상태 텍스트 ───────────────────────────────────────────────────────
  function getReviewText(): { text: string; color: string } {
    if (product.blocked_reason) {
      return { text: `❌ ${product.blocked_reason}`, color: C.red };
    }
    if (product.needs_review) {
      return { text: '⚠ 검토 필요', color: C.orange };
    }
    return { text: '✓ 정상', color: C.green };
  }

  const reviewInfo = getReviewText();

  // ─────────────────────────────────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div style={{ paddingBottom: '32px' }}>

      {/* ── 헤더: 이미지 + 상품명 + 부가정보 ─────────────────────────────── */}
      <SectionWrapper style={{ borderTop: 'none' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          {/* 상품 이미지 */}
          {product.image_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={product.image_url}
              alt={product.title}
              width={72}
              height={72}
              style={{
                width: '72px',
                height: '72px',
                objectFit: 'cover',
                borderRadius: '8px',
                border: `1px solid ${C.border}`,
                flexShrink: 0,
              }}
            />
          ) : (
            <div
              style={{
                width: '72px',
                height: '72px',
                borderRadius: '8px',
                backgroundColor: C.sectionBg,
                border: `1px solid ${C.border}`,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '20px',
              }}
            >
              📦
            </div>
          )}

          {/* 텍스트 정보 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* 상품명 */}
            <p
              style={{
                fontSize: '15px',
                fontWeight: 700,
                color: C.text,
                lineHeight: 1.4,
                marginBottom: '6px',
                wordBreak: 'keep-all',
                overflowWrap: 'break-word',
              }}
            >
              {product.title}
            </p>

            {/* 브랜드 · 카테고리 */}
            <p style={{ fontSize: '12px', color: C.sub, marginBottom: '6px' }}>
              {[product.brand, product.category_name]
                .filter(Boolean)
                .join(' · ')}
            </p>

            {/* 별점 · 리뷰 · 재고 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {product.average_rating && (
                <span style={{ fontSize: '12px', color: '#f59e0b', fontWeight: 600 }}>
                  ★{parseFloat(product.average_rating).toFixed(1)}
                  <span style={{ color: C.sub, fontWeight: 400 }}>
                    {' '}({product.review_count.toLocaleString()})
                  </span>
                </span>
              )}
              <StockBadge status={product.stock_status} />
            </div>
          </div>
        </div>
      </SectionWrapper>

      {/* ── 섹션1: 기본 정보 ───────────────────────────────────────────────── */}
      <SectionWrapper>
        <SectionTitle>기본 정보</SectionTitle>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {/* 매입가 */}
            <InfoRow
              label="매입가"
              value={
                <span>
                  {product.original_price && (
                    <span
                      style={{
                        textDecoration: 'line-through',
                        color: C.sub,
                        fontSize: '12px',
                        marginRight: '6px',
                      }}
                    >
                      {fmtPrice(product.original_price)}
                    </span>
                  )}
                  <strong style={{ color: C.text }}>{fmtPrice(product.price)}</strong>
                </span>
              }
            />

            {/* 입수 — pack_qty > 1 일 때만 */}
            {product.pack_qty > 1 && (
              <InfoRow
                label="입수"
                value={
                  <span>
                    {product.pack_qty}개입
                    <span style={{ color: C.sub, fontSize: '12px', marginLeft: '6px' }}>
                      (개당 {fmtPrice(Math.round(product.price / product.pack_qty))})
                    </span>
                  </span>
                }
              />
            )}

            {/* 별표 — has_asterisk 일 때만 */}
            {product.has_asterisk && (
              <InfoRow
                label="별표"
                value={
                  <span style={{ color: C.accent, fontWeight: 600 }}>
                    ★ 단종·희소 기회
                  </span>
                }
              />
            )}

            {/* 남성 타겟 — neutral이 아닐 때만 */}
            {maleInfo.label !== '' && (
              <InfoRow
                label="남성 타겟"
                value={
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 600,
                      backgroundColor:
                        maleInfo.tier === 'high' ? 'rgba(37,99,235,0.08)' :
                        maleInfo.tier === 'female' ? C.redBg : '#f3f4f6',
                      color:
                        maleInfo.tier === 'high' ? '#2563eb' :
                        maleInfo.tier === 'female' ? C.red : C.sub,
                    }}
                  >
                    {maleInfo.label}
                  </span>
                }
              />
            )}

            {/* 시즌 — bonus > 0 일 때만 */}
            {seasonInfo.bonus > 0 && (
              <InfoRow
                label="시즌"
                value={
                  <span style={{ color: '#7c3aed', fontWeight: 600 }}>
                    +{seasonInfo.bonus}점
                    <span style={{ color: C.sub, fontWeight: 400, marginLeft: '4px' }}>
                      ({seasonInfo.matchedSeasons.join(', ')})
                    </span>
                  </span>
                }
              />
            )}

            {/* 검토 상태 */}
            <InfoRow
              label="검토"
              value={
                <span style={{ color: reviewInfo.color, fontWeight: 600 }}>
                  {reviewInfo.text}
                </span>
              }
            />
          </tbody>
        </table>
      </SectionWrapper>

      {/* ── 섹션2: 단가 비교 ───────────────────────────────────────────────── */}
      <SectionWrapper>
        <SectionTitle>단가 비교</SectionTitle>

        {hasBothUnitPrices ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* 코스트코 단가 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', color: C.sub }}>코스트코</span>
              <span style={{ fontSize: '14px', fontWeight: 700, color: C.text }}>
                {product.unit_price!.toLocaleString()}원/{product.unit_price_label}
              </span>
            </div>

            {/* 네이버 단가 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', color: C.sub }}>네이버</span>
              <span style={{ fontSize: '14px', fontWeight: 700, color: C.text }}>
                {product.market_unit_price!.toLocaleString()}원/{product.unit_price_label}
              </span>
            </div>

            {/* 절감율 구분선 */}
            <div
              style={{
                borderTop: `1px solid ${C.border}`,
                paddingTop: '10px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: '13px', color: C.sub }}>절감율</span>
              <span
                style={{
                  fontSize: '14px',
                  fontWeight: 700,
                  color: unitSavingRate! >= 0 ? C.green : C.red,
                }}
              >
                {unitSavingRate! >= 0
                  ? `▼${fmtPct(unitSavingRate!)} 저렴`
                  : `▲${fmtPct(Math.abs(unitSavingRate!))} 비쌈`}
              </span>
            </div>

            {/* 매칭 상품명 */}
            {product.market_unit_title && (
              <div>
                <span style={{ fontSize: '11px', color: C.sub }}>매칭 상품: </span>
                <span style={{ fontSize: '12px', color: C.text }}>{product.market_unit_title}</span>
              </div>
            )}
          </div>
        ) : (
          <p style={{ fontSize: '13px', color: C.sub, textAlign: 'center', padding: '8px 0' }}>
            단가 비교 데이터 없음
          </p>
        )}
      </SectionWrapper>

      {/* ── 섹션3: 가격 분석 ───────────────────────────────────────────────── */}
      <SectionWrapper>
        <SectionTitle>가격 분석</SectionTitle>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* 네이버 카드 */}
          <PriceChannelCard
            channelLabel="네이버 쇼핑"
            channelColor={C.naver}
            channelBg={C.naverBg}
            result={naverResult}
            status={naverStatus}
          />

          {/* 쿠팡 카드 */}
          <PriceChannelCard
            channelLabel="쿠팡"
            channelColor={C.coupang}
            channelBg={C.coupangBg}
            result={coupangResult}
            status={coupangStatus}
          />

          {/* 시장 최저가 편집 영역 */}
          <div
            style={{
              padding: '12px',
              borderRadius: '8px',
              backgroundColor: C.sectionBg,
              border: `1px solid ${C.border}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <span style={{ fontSize: '13px', color: C.sub, whiteSpace: 'nowrap' }}>
                시장 최저가
              </span>

              {editingPrice ? (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
                  <input
                    type="number"
                    value={priceInputVal}
                    onChange={(e) => setPriceInputVal(e.target.value)}
                    style={{
                      width: '110px',
                      height: '34px',
                      padding: '0 8px',
                      fontSize: '13px',
                      border: `1px solid ${C.naver}`,
                      borderRadius: '6px',
                      outline: 'none',
                      color: C.text,
                      textAlign: 'right',
                    }}
                    placeholder="금액 입력"
                    min={1}
                  />
                  <button
                    onClick={handleSaveMarketPrice}
                    disabled={isSavingPrice}
                    style={{
                      height: '34px',
                      padding: '0 10px',
                      fontSize: '12px',
                      fontWeight: 700,
                      backgroundColor: C.text,
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    저장
                  </button>
                  <button
                    onClick={() => {
                      setEditingPrice(false);
                      setPriceInputVal(String(product.market_lowest_price ?? ''));
                    }}
                    style={{
                      height: '34px',
                      padding: '0 10px',
                      fontSize: '12px',
                      fontWeight: 600,
                      backgroundColor: '#ffffff',
                      color: C.sub,
                      border: `1px solid ${C.border}`,
                      borderRadius: '6px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    취소
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: C.text }}>
                    {marketPrice ? fmtPrice(marketPrice) : '미입력'}
                  </span>
                  <button
                    onClick={() => {
                      setPriceInputVal(String(product.market_lowest_price ?? ''));
                      setEditingPrice(true);
                    }}
                    style={{
                      height: '28px',
                      padding: '0 10px',
                      fontSize: '12px',
                      fontWeight: 600,
                      backgroundColor: '#ffffff',
                      color: C.sub,
                      border: `1px solid ${C.border}`,
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    편집
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </SectionWrapper>

      {/* ── 섹션4: v2 소싱 스코어 아코디언 ───────────────────────────────── */}
      <SectionWrapper>
        {/* 아코디언 헤더 */}
        <button
          onClick={() => setScoreOpen((prev) => !prev)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: '13px', fontWeight: 700, color: C.sub, letterSpacing: '0.5px' }}>
            {scoreOpen ? '▼' : '▶'} 소싱 스코어
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GradeBadge score={scoreTotal} />
            <span style={{ fontSize: '14px', fontWeight: 700, color: C.text }}>
              {scoreTotal}점 / {COSTCO_SCORE_MAX ? Object.values(COSTCO_SCORE_MAX).reduce((a, b) => a + b, 0) : 100}
            </span>
          </div>
        </button>

        {/* 아코디언 바디 */}
        {scoreOpen && (
          <div style={{ marginTop: '16px' }}>
            <MobileScoreBreakdown product={product} />

            {/* 보너스 표시 */}
            {bonusItems.length > 0 && (
              <div
                style={{
                  marginTop: '12px',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  backgroundColor: C.sectionBg,
                  fontSize: '12px',
                  color: '#7c3aed',
                  fontWeight: 600,
                }}
              >
                보너스: {bonusItems.join(', ')}
              </div>
            )}
          </div>
        )}
      </SectionWrapper>

      {/* ── 섹션5: 외부 링크 ───────────────────────────────────────────────── */}
      <SectionWrapper>
        <SectionTitle>외부 링크</SectionTitle>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <ExternalLinkButton
            label="코스트코에서 보기 →"
            url={product.product_url}
          />
          <ExternalLinkButton
            label="네이버 쇼핑 검색 →"
            url={`https://search.shopping.naver.com/search/all?query=${encodeURIComponent(product.title)}`}
          />
          <ExternalLinkButton
            label="쿠팡 검색 →"
            url={`https://www.coupang.com/np/search?q=${encodeURIComponent(product.title)}`}
          />
        </div>
      </SectionWrapper>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 하위 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────

/** 기본 정보 테이블 행 */
function InfoRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <tr>
      <td
        style={{
          fontSize: '12px',
          color: C.sub,
          paddingBottom: '10px',
          paddingRight: '12px',
          verticalAlign: 'top',
          whiteSpace: 'nowrap',
          width: '72px',
        }}
      >
        {label}
      </td>
      <td
        style={{
          fontSize: '13px',
          color: C.text,
          paddingBottom: '10px',
          verticalAlign: 'top',
          lineHeight: 1.4,
        }}
      >
        {value}
      </td>
    </tr>
  );
}

/** 채널별 가격 분석 카드 */
function PriceChannelCard({
  channelLabel,
  channelColor,
  channelBg,
  result,
  status,
}: {
  channelLabel: string;
  channelColor: string;
  channelBg: string;
  result: ReturnType<typeof calcRecommendedPrice>;
  status: ReturnType<typeof getPriceCompStatus>;
}) {
  const statusStyle = PRICE_COMP_STYLE[status];

  return (
    <div
      style={{
        padding: '12px',
        borderRadius: '8px',
        border: `1px solid ${C.border}`,
        backgroundColor: '#ffffff',
      }}
    >
      {/* 채널 헤더 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px',
        }}
      >
        <span
          style={{
            fontSize: '12px',
            fontWeight: 700,
            color: channelColor,
            backgroundColor: channelBg,
            padding: '2px 8px',
            borderRadius: '4px',
          }}
        >
          {channelLabel}
        </span>
        {status !== '데이터 없음' && (
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: statusStyle.color,
              backgroundColor: statusStyle.bg,
              padding: '2px 8px',
              borderRadius: '4px',
            }}
          >
            {status}
          </span>
        )}
      </div>

      {/* 추천가 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '6px',
          marginBottom: '8px',
        }}
      >
        <span style={{ fontSize: '11px', color: C.sub }}>추천가</span>
        <span style={{ fontSize: '18px', fontWeight: 800, color: C.text }}>
          {result.recommendedPrice.toLocaleString()}원
        </span>
      </div>

      {/* 마진율 + 순이익 */}
      <div style={{ display: 'flex', gap: '16px' }}>
        <div>
          <span style={{ fontSize: '11px', color: C.sub }}>마진율 </span>
          <span
            style={{
              fontSize: '13px',
              fontWeight: 700,
              color: result.realMarginRate >= 10 ? C.green : result.realMarginRate >= 5 ? C.orange : C.red,
            }}
          >
            {result.realMarginRate.toFixed(1)}%
          </span>
        </div>
        <div>
          <span style={{ fontSize: '11px', color: C.sub }}>순이익 </span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>
            {result.netProfit.toLocaleString()}원
          </span>
        </div>
      </div>

      {/* 시장가 대비 */}
      {result.vsMarket !== null && (
        <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: `1px solid ${C.border}` }}>
          <span style={{ fontSize: '11px', color: C.sub }}>시장가 대비 </span>
          <span
            style={{
              fontSize: '13px',
              fontWeight: 700,
              color: statusStyle.color,
            }}
          >
            {result.vsMarket >= 0
              ? `-${result.vsMarket.toFixed(1)}%`
              : `+${Math.abs(result.vsMarket).toFixed(1)}% 초과`}
          </span>
        </div>
      )}
    </div>
  );
}

/** 외부 링크 버튼 */
function ExternalLinkButton({ label, url }: { label: string; url: string }) {
  return (
    <button
      onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
      style={{
        width: '100%',
        height: '44px',
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '14px',
        fontWeight: 600,
        color: C.text,
        backgroundColor: C.sectionBg,
        border: `1px solid ${C.border}`,
        borderRadius: '8px',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      {label}
    </button>
  );
}
