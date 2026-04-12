'use client';

/**
 * DomeggookTab.tsx
 * 도매꾹 드롭쉬핑 v2 탭 컴포넌트
 *
 * - useSourcingStore에서 데이터/액션 직접 소비
 * - 프론트엔드 실시간 스코어 계산 (DB 값 없으면 즉시 산출)
 * - 신규 로컬 필터 4종: hideHighCsRisk / hideAboveMarket / hideBlockedUnchecked / minScore
 * - MOQ 시나리오 패널: 행 클릭 시 슬라이드인
 */

import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import {
  Loader2,
  ChevronUp,
  ChevronDown,
  Download,
  RefreshCw,
  AlertCircle,
  X,
  ShieldCheck,
  ExternalLink,
  Search,
  Plus,
} from 'lucide-react';

import { useSourcingStore, type CollectingProgress } from '@/store/useSourcingStore';
import type { SalesAnalysisItem } from '@/types/sourcing';

import {
  calcBundleMinPrice,
  calcPerUnitPrice,
  calcPriceGapRate,
  calcMarginRate,
  calcAllScenarios,
  getMoqStrategy,
  STRATEGY_LABEL,
  type MoqStrategy,
} from '@/lib/sourcing/domeggook-pricing';

import { calcScore, getScoreGrade } from '@/lib/sourcing/domeggook-scoring';
import { getCsRisk, CS_RISK_LABEL } from '@/lib/sourcing/domeggook-cs-filter';
import { classifyMaleTarget, type MaleTier } from '@/lib/sourcing/shared/male-classifier';
import { getSeasonBonus } from '@/lib/sourcing/shared/season-bonus';

// ─────────────────────────────────────────────────────────────────────────────
// 색상 상수 (SourcingDashboard와 동일)
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: '#f9f9f9',
  card: '#ffffff',
  border: '#eeeeee',
  text: '#1a1c1c',
  textSub: '#926f6b',
  accent: '#be0014',
  tableHeader: '#f3f3f3',
  rowHover: '#f5f5f5',
  btnPrimaryBg: '#be0014',
  btnPrimaryText: '#ffffff',
  btnSecondaryBg: '#f3f3f3',
  btnSecondaryText: '#1a1c1c',
};

const MALE_TIER_BADGE: Record<MaleTier, { label: string; color: string; bg: string }> = {
  high:    { label: '🔵 남성', color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  mid:     { label: '⚪ 친화', color: '#6b7280', bg: 'rgba(107,114,128,0.08)' },
  neutral: { label: '',        color: '#9ca3af', bg: 'transparent' },
  female:  { label: '🚫 여성', color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
};

// ─────────────────────────────────────────────────────────────────────────────
// 유틸: 날짜 포맷
// ─────────────────────────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${day} ${h}:${mi}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 유틸: 숫자 포맷 (천 단위 구분)
// ─────────────────────────────────────────────────────────────────────────────
function formatNumber(n: number): string {
  return n.toLocaleString('ko-KR');
}

// ─────────────────────────────────────────────────────────────────────────────
// 판매량 셀
// ─────────────────────────────────────────────────────────────────────────────
function SalesCell({ value }: { value: number }) {
  if (value === 0) return <span style={{ color: C.textSub }}>-</span>;
  if (value > 0) {
    return (
      <span style={{ color: C.accent, fontWeight: 600 }}>
        ▼{formatNumber(value)}
      </span>
    );
  }
  return (
    <span style={{ color: '#16a34a', fontWeight: 600 }}>
      ▲{formatNumber(Math.abs(value))}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Legal 상태 배지 상수
// ─────────────────────────────────────────────────────────────────────────────
const LEGAL_BADGE: Record<string, { emoji: string; label: string; color: string; bg: string }> = {
  blocked:   { emoji: '🔴', label: '차단',   color: '#dc2626', bg: 'rgba(220, 38, 38, 0.08)' },
  warning:   { emoji: '🟡', label: '주의',   color: '#d97706', bg: 'rgba(217, 119, 6, 0.08)' },
  safe:      { emoji: '🟢', label: '안전',   color: '#16a34a', bg: 'rgba(22, 163, 74, 0.08)' },
  unchecked: { emoji: '⚪', label: '미검사', color: '#9ca3af', bg: 'rgba(156, 163, 175, 0.08)' },
};

// ─────────────────────────────────────────────────────────────────────────────
// IP 리스크 배지 상수
// ─────────────────────────────────────────────────────────────────────────────
const IP_BADGE: Record<string, { label: string; color: string; bg: string; border: string }> = {
  low:    { label: '안전', color: '#16a34a', bg: 'rgba(22, 163, 74, 0.08)',   border: 'rgba(22, 163, 74, 0.25)' },
  medium: { label: '주의', color: '#d97706', bg: 'rgba(217, 119, 6, 0.08)',   border: 'rgba(217, 119, 6, 0.25)' },
  high:   { label: '위험', color: '#dc2626', bg: 'rgba(220, 38, 38, 0.08)',   border: 'rgba(220, 38, 38, 0.25)' },
};

// ─────────────────────────────────────────────────────────────────────────────
// 배송비 부담 배지 상수
// ─────────────────────────────────────────────────────────────────────────────
const DELI_WHO_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  S: { label: '무료',   color: '#16a34a', bg: 'rgba(22, 163, 74, 0.08)' },
  P: { label: '선결제', color: '#2563eb', bg: 'rgba(37, 99, 235, 0.08)' },
  B: { label: '착불',   color: '#d97706', bg: 'rgba(217, 119, 6, 0.08)' },
  C: { label: '선택',   color: '#6b7280', bg: 'rgba(107, 114, 128, 0.08)' },
};

// ─────────────────────────────────────────────────────────────────────────────
// 묶음 전략 배지 상수
// ─────────────────────────────────────────────────────────────────────────────
const STRATEGY_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  single: { label: '단품', color: '#2563eb', bg: 'rgba(37, 99, 235, 0.08)' },
  '1+1':  { label: '1+1',  color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.08)' },
  '2+1':  { label: '2+1',  color: '#0891b2', bg: 'rgba(8, 145, 178, 0.08)' },
};

// ─────────────────────────────────────────────────────────────────────────────
// 프론트엔드 유효 묶음 데이터 계산 헬퍼
// ─────────────────────────────────────────────────────────────────────────────
function getEffectiveBundleData(item: SalesAnalysisItem): {
  strategy: MoqStrategy;
  bundlePrice: number | null;
  gapRate: number | null;
  marginRate: number | null;
} {
  const moq = item.moq ?? 1;

  // MOQ >= 4 → 드롭쉬핑 불가
  if (moq >= 4) {
    return { strategy: null, bundlePrice: null, gapRate: null, marginRate: null };
  }

  const strategy = getMoqStrategy(moq);

  // DB에 저장된 값 우선
  if (item.dropshipBundlePrice != null && item.dropshipPriceGapRate != null) {
    let marginRate: number | null = null;
    if (item.marketLowestPrice) {
      const perUnit = calcPerUnitPrice(item.dropshipBundlePrice, moq);
      marginRate = calcMarginRate(perUnit, item.marketLowestPrice);
    }
    return {
      strategy,
      bundlePrice: item.dropshipBundlePrice,
      gapRate: item.dropshipPriceGapRate,
      marginRate,
    };
  }

  // DB 값 없으면 프론트에서 계산
  if (!item.latestPriceDome) {
    return { strategy, bundlePrice: null, gapRate: null, marginRate: null };
  }

  const bundlePrice = calcBundleMinPrice({
    priceDome: item.latestPriceDome,
    deliWho: item.deliWho,
    deliFee: item.deliFee,
    moq,
  });
  const perUnitPrice = calcPerUnitPrice(bundlePrice, moq);

  const gapRate = item.marketLowestPrice
    ? calcPriceGapRate(perUnitPrice, item.marketLowestPrice)
    : null;

  const marginRate = item.marketLowestPrice
    ? calcMarginRate(perUnitPrice, item.marketLowestPrice)
    : null;

  return { strategy, bundlePrice, gapRate, marginRate };
}

// ─────────────────────────────────────────────────────────────────────────────
// 프론트엔드 유효 종합 점수 계산 헬퍼
// ─────────────────────────────────────────────────────────────────────────────
function getEffectiveScore(item: SalesAnalysisItem): {
  total: number;
  grade: { label: string; color: string; bg: string };
} {
  // DB 저장 값 우선
  if (item.scoreTotal != null) {
    return { total: item.scoreTotal, grade: getScoreGrade(item.scoreTotal) };
  }

  const bundleData = getEffectiveBundleData(item);

  const result = calcScore({
    legalStatus: item.legalStatus,
    ipRiskLevel: item.ipRiskLevel,
    priceGapRate: bundleData.gapRate,
    categoryName: item.categoryName,
    marginRate: bundleData.marginRate,
    sales7d: item.sales7d,
    latestInventory: item.latestInventory,
    moq: item.moq,
  });

  return { total: result.total, grade: getScoreGrade(result.total) };
}

/** 프론트엔드 남성 타겟 분류 (DB 값 우선, 없으면 즉시 계산) */
function getEffectiveMaleTier(item: SalesAnalysisItem): MaleTier | null {
  if (item.maleTier) return item.maleTier as MaleTier;
  if (!item.title) return null;
  return classifyMaleTarget(item.title, item.categoryName ?? '').tier;
}

/** 시즌 가산점은 날짜 의존 값이므로 항상 실시간 계산 */
function getEffectiveSeasonBonus(item: SalesAnalysisItem): { bonus: number; labels: string[] } {
  if (!item.title) return { bonus: 0, labels: [] };
  const result = getSeasonBonus(item.title);
  return { bonus: result.bonus, labels: result.matchedSeasons };
}

/** 프론트엔드 차단 여부 (DB 값 우선, 없으면 즉시 계산) */
function getEffectiveBlockedReason(item: SalesAnalysisItem): string | null {
  if (item.blockedReason !== undefined) return item.blockedReason;
  if (!item.title) return null;
  const male = classifyMaleTarget(item.title, item.categoryName ?? '');
  if (male.legalBlocked) return '법적 통신판매 금지 키워드';
  if ((item.moq ?? 0) >= 4) return 'MOQ 4개 이상';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 수집 진행률 바
// ─────────────────────────────────────────────────────────────────────────────
function CollectingProgressBar({ progress }: { progress: CollectingProgress }) {
  const pct = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div
      style={{
        padding: '10px 24px',
        backgroundColor: 'rgba(190, 0, 20, 0.03)',
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '6px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Loader2
            size={13}
            style={{ animation: 'spin 1s linear infinite', color: C.accent }}
          />
          <span style={{ fontSize: '12px', fontWeight: 600, color: C.text }}>
            {progress.phase === 'fetch' ? '상품 수집' : '재고 스냅샷'}
          </span>
          <span style={{ fontSize: '12px', color: C.textSub }}>{progress.label}</span>
        </div>
        <span style={{ fontSize: '12px', fontWeight: 600, color: C.accent }}>
          {progress.current}/{progress.total} ({pct}%)
        </span>
      </div>
      <div
        style={{
          height: '4px',
          borderRadius: '2px',
          backgroundColor: 'rgba(190, 0, 20, 0.1)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            backgroundColor: C.accent,
            borderRadius: '2px',
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MOQ 시나리오 패널
// ─────────────────────────────────────────────────────────────────────────────
function MoqScenarioPanel({
  item,
  onClose,
}: {
  item: SalesAnalysisItem;
  onClose: () => void;
}) {
  const scenarios = useMemo(() => {
    if (!item.latestPriceDome) return [];
    return calcAllScenarios(
      item.latestPriceDome,
      item.deliWho,
      item.deliFee,
      item.marketLowestPrice,
    );
  }, [item]);

  // 추천 전략: 단가격차가 가장 높은 시나리오 (양수인 것 중 최대)
  const recommended = useMemo(() => {
    const positive = scenarios.filter((s) => (s.priceGapRate ?? -Infinity) > 0);
    if (positive.length === 0) return scenarios[0] ?? null;
    return positive.reduce((best, cur) =>
      (cur.priceGapRate ?? -Infinity) > (best.priceGapRate ?? -Infinity) ? cur : best,
    );
  }, [scenarios]);

  const deliLabel = item.deliWho
    ? DELI_WHO_LABEL[item.deliWho]?.label ?? item.deliWho
    : '-';

  return (
    <>
      {/* 딤 처리 없는 투명 오버레이 — 클릭으로 닫기 */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 40,
        }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* 패널 본체 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="MOQ 시나리오"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '420px',
          zIndex: 50,
          backgroundColor: C.card,
          borderLeft: `1px solid ${C.border}`,
          boxShadow: '-4px 0 24px rgba(0,0,0,0.08)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 패널 헤더 */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: `1px solid ${C.border}`,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                fontSize: '13px',
                fontWeight: 700,
                color: C.text,
                margin: 0,
                lineHeight: 1.4,
                wordBreak: 'break-all',
              }}
            >
              {item.title}
            </p>
            {item.categoryName && (
              <p style={{ fontSize: '11px', color: C.textSub, margin: '4px 0 0' }}>
                {item.categoryName}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            style={{
              flexShrink: 0,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px',
              color: C.textSub,
              lineHeight: 1,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* 기본 정보 그리드 */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: `1px solid ${C.border}`,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '10px',
          }}
        >
          {[
            ['도매가', item.latestPriceDome != null ? `${formatNumber(item.latestPriceDome)}원` : '-'],
            ['시장가', item.marketLowestPrice != null ? `${formatNumber(item.marketLowestPrice)}원` : '-'],
            ['배송비', item.deliFee != null && item.deliWho !== 'S' ? `${formatNumber(item.deliFee)}원` : '0원'],
            ['배송부담', deliLabel],
          ].map(([label, value]) => (
            <div key={label}>
              <p style={{ fontSize: '11px', color: C.textSub, margin: '0 0 2px' }}>{label}</p>
              <p style={{ fontSize: '13px', fontWeight: 600, color: C.text, margin: 0 }}>{value}</p>
            </div>
          ))}
        </div>

        {/* 시나리오 테이블 */}
        <div style={{ padding: '16px 20px', flex: 1, overflow: 'auto' }}>
          <p
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: C.text,
              margin: '0 0 12px',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            MOQ 시나리오 비교
          </p>

          {scenarios.length === 0 ? (
            <p style={{ fontSize: '12px', color: C.textSub }}>도매가 정보가 없습니다.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ backgroundColor: C.tableHeader }}>
                  {['전략', '묶음가', '개당단가', '단가격차', '마진'].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '7px 8px',
                        textAlign: 'right',
                        color: C.textSub,
                        fontWeight: 600,
                        borderBottom: `1px solid ${C.border}`,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scenarios.map((sc) => {
                  const isRec = recommended?.moq === sc.moq;
                  const gapColor =
                    sc.priceGapRate == null
                      ? C.textSub
                      : sc.priceGapRate >= 0
                      ? '#16a34a'
                      : '#dc2626';

                  return (
                    <tr
                      key={sc.moq}
                      style={{
                        backgroundColor: isRec ? 'rgba(22, 163, 74, 0.04)' : 'transparent',
                      }}
                    >
                      {/* 전략 */}
                      <td
                        style={{
                          padding: '8px 8px',
                          borderBottom: `1px solid ${C.border}`,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {sc.strategy != null ? (
                            <span
                              style={{
                                fontSize: '11px',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                fontWeight: 700,
                                backgroundColor: STRATEGY_BADGE[sc.strategy]?.bg ?? C.tableHeader,
                                color: STRATEGY_BADGE[sc.strategy]?.color ?? C.text,
                              }}
                            >
                              {STRATEGY_LABEL[sc.strategy] ?? sc.strategy}(×{sc.moq})
                            </span>
                          ) : (
                            <span style={{ color: C.textSub }}>-</span>
                          )}
                          {isRec && (
                            <span style={{ fontSize: '10px', color: '#16a34a', fontWeight: 700 }}>
                              ★
                            </span>
                          )}
                        </span>
                      </td>

                      {/* 묶음가 */}
                      <td
                        style={{
                          padding: '8px 8px',
                          textAlign: 'right',
                          borderBottom: `1px solid ${C.border}`,
                        }}
                      >
                        {sc.bundleMinPrice != null
                          ? `${formatNumber(sc.bundleMinPrice)}원`
                          : '-'}
                      </td>

                      {/* 개당단가 */}
                      <td
                        style={{
                          padding: '8px 8px',
                          textAlign: 'right',
                          borderBottom: `1px solid ${C.border}`,
                        }}
                      >
                        {sc.perUnitPrice ? `${sc.perUnitPrice.toLocaleString('ko-KR')}원` : '-'}
                      </td>

                      {/* 단가격차 */}
                      <td
                        style={{
                          padding: '8px 8px',
                          textAlign: 'right',
                          borderBottom: `1px solid ${C.border}`,
                          fontWeight: 600,
                          color: gapColor,
                        }}
                      >
                        {sc.priceGapRate != null ? `${sc.priceGapRate}%` : '-'}
                      </td>

                      {/* 마진 */}
                      <td
                        style={{
                          padding: '8px 8px',
                          textAlign: 'right',
                          borderBottom: `1px solid ${C.border}`,
                          color:
                            sc.marginRate == null
                              ? C.textSub
                              : sc.marginRate >= 0
                              ? '#16a34a'
                              : '#dc2626',
                        }}
                      >
                        {sc.marginRate != null ? `${sc.marginRate}%` : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* 추천 전략 안내 */}
          {recommended && recommended.strategy != null && (
            <div
              style={{
                marginTop: '16px',
                padding: '10px 12px',
                backgroundColor: 'rgba(22, 163, 74, 0.06)',
                borderRadius: '8px',
                border: '1px solid rgba(22, 163, 74, 0.2)',
              }}
            >
              <p style={{ fontSize: '12px', color: '#16a34a', fontWeight: 700, margin: 0 }}>
                추천 전략:{' '}
                {STRATEGY_LABEL[recommended.strategy] ?? recommended.strategy}
                {' '}(MOQ {recommended.moq})
              </p>
              <p style={{ fontSize: '11px', color: C.textSub, margin: '4px 0 0' }}>
                단가격차{' '}
                <strong style={{ color: recommended.priceGapRate != null && recommended.priceGapRate >= 0 ? '#16a34a' : '#dc2626' }}>
                  {recommended.priceGapRate != null ? `${recommended.priceGapRate}%` : '-'}
                </strong>
                {', '}마진{' '}
                <strong>
                  {recommended.marginRate != null ? `${recommended.marginRate}%` : '-'}
                </strong>
              </p>
            </div>
          )}
        </div>

        {/* 도매꾹 바로가기 버튼 */}
        {item.domeUrl && (
          <div
            style={{
              padding: '16px 20px',
              borderTop: `1px solid ${C.border}`,
            }}
          >
            <a
              href={item.domeUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                width: '100%',
                padding: '10px 0',
                borderRadius: '8px',
                backgroundColor: C.btnPrimaryBg,
                color: C.btnPrimaryText,
                fontSize: '13px',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              도매꾹 바로가기
              <ExternalLink size={14} />
            </a>
          </div>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 DomeggookTab 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export default function DomeggookTab() {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 로컬 신규 필터 상태 ────────────────────────────────────────────────────
  const [hideHighCsRisk, setHideHighCsRisk] = useState(false);
  const [hideAboveMarket, setHideAboveMarket] = useState(false);
  const [hideBlockedUnchecked, setHideBlockedUnchecked] = useState(false);
  const [minScore, setMinScore] = useState<number | ''>('');
  const [genderFilter, setGenderFilter] = useState<'all' | 'male_only' | 'male' | 'female' | 'neutral'>('all');
  const [hideBlocked, setHideBlocked] = useState(false);

  // ── 단일 상품 추가 ─────────────────────────────────────────────────────────
  const [addUrl, setAddUrl] = useState('');
  const [addState, setAddState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [addMsg, setAddMsg] = useState('');

  const handleAddSingle = async () => {
    const input = addUrl.trim();
    if (!input) return;
    setAddState('loading');
    setAddMsg('');
    try {
      const res = await fetch('/api/sourcing/fetch-items/single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: input }),
      });
      const json = await res.json();
      if (json.success) {
        setAddState('ok');
        setAddMsg(`"${json.data.title}" ${json.data.isNew ? '추가' : '업데이트'} 완료`);
        setAddUrl('');
        // 목록 새로고침
        setTimeout(() => {
          fetchAnalysis();
          setAddState('idle');
          setAddMsg('');
        }, 2000);
      } else {
        setAddState('error');
        setAddMsg(json.error ?? '추가 실패');
      }
    } catch {
      setAddState('error');
      setAddMsg('네트워크 오류');
    }
  };

  // ── MOQ 시나리오 패널 ──────────────────────────────────────────────────────
  const [selectedItem, setSelectedItem] = useState<SalesAnalysisItem | null>(null);

  // ── 스토어 ─────────────────────────────────────────────────────────────────
  const {
    items,
    totalCount,
    lastCollectedAt,
    categories,
    isLoading,
    isCollecting,
    collectingProgress,
    error,
    sortField,
    sortOrder,
    categoryFilter,
    searchQuery,
    moqFilter,
    freeDeliOnly,
    minSales1d,
    minSales7d,
    minPrice,
    maxPrice,
    minMargin,
    legalFilter,
    ipRiskFilter,
    seasonOnly,
    page,
    pageSize,
    fetchAnalysis,
    triggerCollection,
    setSortField,
    setCategoryFilter,
    setSearchQuery,
    setMoqFilter,
    setFreeDeliOnly,
    setMinSales1d,
    setMinSales7d,
    setMinPrice,
    setMaxPrice,
    setMinMargin,
    setLegalFilter,
    setIpRiskFilter,
    setSeasonOnly,
    setPage,
    clearError,
    triggerLegalCheck,
    isLegalChecking,
    verifyIp,
    ipVerifyingId,
  } = useSourcingStore();

  // ── 마운트 시 초기 데이터 로드 ────────────────────────────────────────────
  useEffect(() => {
    fetchAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 검색 debounce ──────────────────────────────────────────────────────────
  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      setSearchQuery(q);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchAnalysis();
      }, 300);
    },
    [setSearchQuery, fetchAnalysis],
  );

  // ── 정렬 헤더 클릭 ────────────────────────────────────────────────────────
  const handleSortClick = useCallback(
    (key: string) => {
      if (sortField === key) {
        useSourcingStore.getState().toggleSortOrder();
      } else {
        setSortField(key);
      }
    },
    [sortField, setSortField],
  );

  // ── CSV 다운로드 ──────────────────────────────────────────────────────────
  const handleCsvDownload = useCallback(() => {
    const params = new URLSearchParams({ sort: sortField, order: sortOrder });
    if (categoryFilter) params.set('category', categoryFilter);
    if (searchQuery.trim()) params.set('search', searchQuery.trim());
    window.open(`/api/sourcing/export?${params.toString()}`, '_blank');
  }, [sortField, sortOrder, categoryFilter, searchQuery]);

  // ── 프론트엔드 로컬 필터 적용 (useMemo) ──────────────────────────────────
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // 고위험 CS 숨기기
      if (hideHighCsRisk) {
        const csRisk = getCsRisk(item.categoryName);
        if (csRisk.level === 'high') return false;
      }

      // 시장가 초과(단가격차 < 0) 숨기기
      if (hideAboveMarket) {
        const bundleData = getEffectiveBundleData(item);
        if (bundleData.gapRate != null && bundleData.gapRate < 0) return false;
      }

      // 차단/미검사 숨기기
      if (hideBlockedUnchecked) {
        if (item.legalStatus === 'blocked' || item.legalStatus === 'unchecked') return false;
      }

      // 최소 종합점수 필터
      if (minScore !== '') {
        const threshold = Number(minScore);
        if (!isNaN(threshold)) {
          const scoreData = getEffectiveScore(item);
          if (scoreData.total < threshold) return false;
        }
      }

      // 성별 필터
      if (genderFilter !== 'all') {
        const tier = getEffectiveMaleTier(item);
        if (genderFilter === 'male_only' && tier !== 'high') return false;
        if (genderFilter === 'male' && tier !== 'high' && tier !== 'mid') return false;
        if (genderFilter === 'female' && tier !== 'female') return false;
        if (genderFilter === 'neutral' && tier !== 'neutral') return false;
      }
      // 차단 숨기기
      if (hideBlocked && getEffectiveBlockedReason(item) !== null) return false;

      return true;
    });
  }, [items, hideHighCsRisk, hideAboveMarket, hideBlockedUnchecked, minScore, genderFilter, hideBlocked]);

  // ── 페이지네이션 ──────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // ── 정렬 아이콘 렌더 ─────────────────────────────────────────────────────
  function SortIcon({ columnKey }: { columnKey: string }) {
    if (sortField !== columnKey) return null;
    return sortOrder === 'asc' ? (
      <ChevronUp size={12} style={{ marginLeft: '3px' }} />
    ) : (
      <ChevronDown size={12} style={{ marginLeft: '3px' }} />
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: C.bg,
        color: C.text,
        fontFamily: "'Noto Sans KR', sans-serif",
      }}
    >
      {/* ── 수집 진행률 배너 ───────────────────────────────────────────────── */}
      {collectingProgress && <CollectingProgressBar progress={collectingProgress} />}

      {/* ── 에러 배너 ─────────────────────────────────────────────────────── */}
      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 20px',
            backgroundColor: 'rgba(220, 38, 38, 0.06)',
            borderBottom: `1px solid rgba(220, 38, 38, 0.15)`,
            fontSize: '13px',
            color: '#dc2626',
          }}
        >
          <AlertCircle size={14} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{error}</span>
          <button
            onClick={clearError}
            aria-label="에러 닫기"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#dc2626',
              padding: '2px',
              lineHeight: 1,
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── 상태바 ────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '10px 20px',
          backgroundColor: C.card,
          borderBottom: `1px solid ${C.border}`,
          flexWrap: 'wrap',
        }}
      >
        {lastCollectedAt && (
          <span style={{ fontSize: '12px', color: C.textSub }}>
            마지막 수집: {formatDate(lastCollectedAt)}
          </span>
        )}
        <span
          style={{
            fontSize: '12px',
            color: C.textSub,
            paddingLeft: '12px',
            borderLeft: `1px solid ${C.border}`,
          }}
        >
          추적 상품 {formatNumber(totalCount)}개
        </span>
        {/* v2 실시간 계산 뱃지 */}
        <span
          style={{
            fontSize: '11px',
            padding: '2px 8px',
            borderRadius: '12px',
            fontWeight: 700,
            backgroundColor: 'rgba(124, 58, 237, 0.08)',
            color: '#7c3aed',
            border: '1px solid rgba(124, 58, 237, 0.2)',
          }}
        >
          v2 스코어 계산: 프론트엔드 실시간
        </span>

        {/* 액션 버튼들 */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {/* 법적 검토 버튼 */}
          <button
            onClick={() => triggerLegalCheck()}
            disabled={isLegalChecking || isCollecting}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              border: `1px solid ${C.border}`,
              backgroundColor: C.btnSecondaryBg,
              color: C.btnSecondaryText,
              cursor: isLegalChecking || isCollecting ? 'not-allowed' : 'pointer',
              opacity: isLegalChecking || isCollecting ? 0.6 : 1,
            }}
          >
            {isLegalChecking ? (
              <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <ShieldCheck size={12} />
            )}
            {isLegalChecking ? '검토 중...' : '법적 검토'}
          </button>

          {/* CSV 다운로드 버튼 */}
          <button
            onClick={handleCsvDownload}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              border: `1px solid ${C.border}`,
              backgroundColor: C.btnSecondaryBg,
              color: C.btnSecondaryText,
              cursor: 'pointer',
            }}
          >
            <Download size={12} />
            CSV
          </button>

          {/* 단일 상품 URL 추가 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              type="text"
              value={addUrl}
              onChange={(e) => { setAddUrl(e.target.value); setAddState('idle'); setAddMsg(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleAddSingle()}
              placeholder="도매꾹 URL 또는 상품번호"
              disabled={addState === 'loading'}
              style={{
                fontSize: '12px',
                padding: '5px 10px',
                borderRadius: '6px',
                border: `1px solid ${addState === 'error' ? '#dc2626' : addState === 'ok' ? '#16a34a' : C.border}`,
                width: '220px',
                outline: 'none',
                color: C.text,
                backgroundColor: C.card,
              }}
            />
            <button
              onClick={handleAddSingle}
              disabled={!addUrl.trim() || addState === 'loading'}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                padding: '5px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                border: `1px solid ${C.border}`,
                backgroundColor: addState === 'ok' ? '#16a34a' : C.btnSecondaryBg,
                color: addState === 'ok' ? '#fff' : C.btnSecondaryText,
                cursor: (!addUrl.trim() || addState === 'loading') ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {addState === 'loading' ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={12} />}
              {addState === 'loading' ? '추가 중...' : addState === 'ok' ? '완료' : '상품 추가'}
            </button>
            {addMsg && (
              <span style={{ fontSize: '11px', color: addState === 'error' ? '#dc2626' : '#16a34a', whiteSpace: 'nowrap' }}>
                {addMsg}
              </span>
            )}
          </div>

          {/* 수집 버튼 */}
          <button
            onClick={() => triggerCollection()}
            disabled={isCollecting}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 14px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 700,
              border: 'none',
              backgroundColor: isCollecting ? 'rgba(190, 0, 20, 0.5)' : C.btnPrimaryBg,
              color: C.btnPrimaryText,
              cursor: isCollecting ? 'not-allowed' : 'pointer',
            }}
          >
            {isCollecting ? (
              <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <RefreshCw size={12} />
            )}
            {isCollecting ? '수집 중...' : '수동 수집'}
          </button>
        </div>
      </div>

      {/* ── 필터 툴바 ─────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: '12px 20px',
          backgroundColor: C.card,
          borderBottom: `1px solid ${C.border}`,
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px',
          alignItems: 'flex-end',
        }}
      >
        {/* 카테고리 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', color: C.textSub, fontWeight: 600 }}>카테고리</label>
          <select
            value={categoryFilter ?? ''}
            onChange={(e) => setCategoryFilter(e.target.value || null)}
            style={{
              fontSize: '12px',
              padding: '5px 8px',
              borderRadius: '6px',
              border: `1px solid ${C.border}`,
              backgroundColor: C.card,
              color: C.text,
              cursor: 'pointer',
              minWidth: '120px',
            }}
          >
            <option value="">전체</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {/* 검색 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', color: C.textSub, fontWeight: 600 }}>검색</label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search
              size={13}
              style={{ position: 'absolute', left: '8px', color: C.textSub, pointerEvents: 'none' }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="상품명 검색..."
              style={{
                fontSize: '12px',
                padding: '5px 8px 5px 26px',
                borderRadius: '6px',
                border: `1px solid ${C.border}`,
                backgroundColor: C.card,
                color: C.text,
                width: '160px',
              }}
            />
          </div>
        </div>

        {/* MOQ 최대값 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', color: C.textSub, fontWeight: 600 }}>MOQ 최대</label>
          <select
            value={moqFilter ?? ''}
            onChange={(e) => setMoqFilter(e.target.value ? Number(e.target.value) : null)}
            style={{
              fontSize: '12px',
              padding: '5px 8px',
              borderRadius: '6px',
              border: `1px solid ${C.border}`,
              backgroundColor: C.card,
              color: C.text,
              cursor: 'pointer',
            }}
          >
            <option value="">전체</option>
            <option value="1">1개</option>
            <option value="2">2개</option>
            <option value="3">3개</option>
          </select>
        </div>

        {/* 무료배송만 */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            color: C.text,
            cursor: 'pointer',
            userSelect: 'none',
            paddingBottom: '1px',
          }}
        >
          <input
            type="checkbox"
            checked={freeDeliOnly}
            onChange={(e) => setFreeDeliOnly(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          무료배송만
        </label>

        {/* 전일판매 최소 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', color: C.textSub, fontWeight: 600 }}>전일판매 ≥</label>
          <input
            type="number"
            min={0}
            value={minSales1d ?? ''}
            onChange={(e) => setMinSales1d(e.target.value ? Number(e.target.value) : null)}
            placeholder="0"
            style={{
              fontSize: '12px',
              padding: '5px 8px',
              borderRadius: '6px',
              border: `1px solid ${C.border}`,
              width: '72px',
              color: C.text,
            }}
          />
        </div>

        {/* 7일판매 최소 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', color: C.textSub, fontWeight: 600 }}>7일판매 ≥</label>
          <input
            type="number"
            min={0}
            value={minSales7d ?? ''}
            onChange={(e) => setMinSales7d(e.target.value ? Number(e.target.value) : null)}
            placeholder="0"
            style={{
              fontSize: '12px',
              padding: '5px 8px',
              borderRadius: '6px',
              border: `1px solid ${C.border}`,
              width: '72px',
              color: C.text,
            }}
          />
        </div>

        {/* 도매가 범위 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', color: C.textSub, fontWeight: 600 }}>도매가</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <input
              type="number"
              min={0}
              value={minPrice ?? ''}
              onChange={(e) => setMinPrice(e.target.value ? Number(e.target.value) : null)}
              placeholder="최소"
              style={{
                fontSize: '12px',
                padding: '5px 8px',
                borderRadius: '6px',
                border: `1px solid ${C.border}`,
                width: '72px',
                color: C.text,
              }}
            />
            <span style={{ fontSize: '11px', color: C.textSub }}>~</span>
            <input
              type="number"
              min={0}
              value={maxPrice ?? ''}
              onChange={(e) => setMaxPrice(e.target.value ? Number(e.target.value) : null)}
              placeholder="최대"
              style={{
                fontSize: '12px',
                padding: '5px 8px',
                borderRadius: '6px',
                border: `1px solid ${C.border}`,
                width: '72px',
                color: C.text,
              }}
            />
          </div>
        </div>

        {/* 마진율 최소 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', color: C.textSub, fontWeight: 600 }}>마진율 ≥ (%)</label>
          <input
            type="number"
            value={minMargin ?? ''}
            onChange={(e) => setMinMargin(e.target.value ? Number(e.target.value) : null)}
            placeholder="0"
            style={{
              fontSize: '12px',
              padding: '5px 8px',
              borderRadius: '6px',
              border: `1px solid ${C.border}`,
              width: '72px',
              color: C.text,
            }}
          />
        </div>

        {/* Legal 필터 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', color: C.textSub, fontWeight: 600 }}>Legal</label>
          <select
            value={legalFilter ?? ''}
            onChange={(e) => setLegalFilter(e.target.value || null)}
            style={{
              fontSize: '12px',
              padding: '5px 8px',
              borderRadius: '6px',
              border: `1px solid ${C.border}`,
              backgroundColor: C.card,
              color: C.text,
              cursor: 'pointer',
            }}
          >
            <option value="">전체</option>
            <option value="safe">안전</option>
            <option value="warning">주의</option>
            <option value="blocked">차단</option>
          </select>
        </div>

        {/* IP리스크 필터 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', color: C.textSub, fontWeight: 600 }}>IP리스크</label>
          <select
            value={ipRiskFilter ?? ''}
            onChange={(e) => setIpRiskFilter(e.target.value || null)}
            style={{
              fontSize: '12px',
              padding: '5px 8px',
              borderRadius: '6px',
              border: `1px solid ${C.border}`,
              backgroundColor: C.card,
              color: C.text,
              cursor: 'pointer',
            }}
          >
            <option value="">전체</option>
            <option value="low">안전</option>
            <option value="medium">주의</option>
            <option value="high">위험</option>
          </select>
        </div>

        {/* 구분선 */}
        <div
          style={{
            width: '1px',
            height: '30px',
            backgroundColor: C.border,
            alignSelf: 'flex-end',
            marginBottom: '2px',
          }}
        />

        {/* 신규: 고위험 CS 숨기기 */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '12px',
            color: C.text,
            cursor: 'pointer',
            userSelect: 'none',
            paddingBottom: '1px',
          }}
          title="식품·유아·전기 등 고위험 CS 카테고리 숨기기"
        >
          <input
            type="checkbox"
            checked={hideHighCsRisk}
            onChange={(e) => setHideHighCsRisk(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          고위험CS 숨기기
        </label>

        {/* 신규: 시장가 초과 숨기기 */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '12px',
            color: C.text,
            cursor: 'pointer',
            userSelect: 'none',
            paddingBottom: '1px',
          }}
          title="단가격차 < 0 (시장가보다 비싼 경우) 숨기기"
        >
          <input
            type="checkbox"
            checked={hideAboveMarket}
            onChange={(e) => setHideAboveMarket(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          시장가초과 숨기기
        </label>

        {/* 신규: 차단/미검사 숨기기 */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '12px',
            color: C.text,
            cursor: 'pointer',
            userSelect: 'none',
            paddingBottom: '1px',
          }}
          title="Legal 상태가 차단 또는 미검사인 항목 숨기기"
        >
          <input
            type="checkbox"
            checked={hideBlockedUnchecked}
            onChange={(e) => setHideBlockedUnchecked(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          차단/미검사 숨기기
        </label>

        {/* 신규: 타겟 성별 드롭다운 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', color: C.textSub, fontWeight: 600 }}>타겟 성별</label>
          <select
            value={genderFilter}
            onChange={(e) => setGenderFilter(e.target.value as typeof genderFilter)}
            style={{
              height: '32px', padding: '0 8px', borderRadius: '6px',
              border: `1px solid ${C.border}`, backgroundColor: C.card,
              fontSize: '12px', color: C.text,
            }}
          >
            <option value="all">전체</option>
            <option value="male_only">🔵 남성타겟만</option>
            <option value="male">🔵 남성친화 이상</option>
            <option value="female">🚫 여성</option>
            <option value="neutral">⚪ 중립</option>
          </select>
        </div>

        {/* 신규: 차단 상품 숨기기 */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
          <input type="checkbox" checked={hideBlocked} onChange={(e) => setHideBlocked(e.target.checked)} />
          차단 상품 숨기기
        </label>

        {/* 신규: 시즌 상품만 */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
          <input type="checkbox" checked={seasonOnly} onChange={(e) => setSeasonOnly(e.target.checked)} />
          시즌 상품만
        </label>

        {/* 신규: 최소 종합점수 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', color: C.textSub, fontWeight: 600 }}>
            종합점수 ≥
          </label>
          <input
            type="number"
            min={0}
            max={100}
            value={minScore}
            onChange={(e) => setMinScore(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="0"
            style={{
              fontSize: '12px',
              padding: '5px 8px',
              borderRadius: '6px',
              border: `1px solid ${C.border}`,
              width: '72px',
              color: C.text,
            }}
          />
        </div>
      </div>

      {/* ── 테이블 ────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowX: 'auto' }}>
        {isLoading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '60px 20px',
              gap: '10px',
              color: C.textSub,
            }}
          >
            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: C.accent }} />
            <span style={{ fontSize: '14px' }}>데이터 불러오는 중...</span>
          </div>
        ) : filteredItems.length === 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '60px 20px',
              color: C.textSub,
              fontSize: '14px',
            }}
          >
            조건에 맞는 상품이 없습니다.
          </div>
        ) : (
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '12px',
              minWidth: '1400px',
            }}
          >
            <thead>
              <tr style={{ backgroundColor: C.tableHeader }}>
                {/* # */}
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'center',
                    fontWeight: 700,
                    color: C.textSub,
                    borderBottom: `1px solid ${C.border}`,
                    whiteSpace: 'nowrap',
                    width: '40px',
                  }}
                >
                  #
                </th>

                {/* 상품명 */}
                <th
                  onClick={() => handleSortClick('title')}
                  style={{
                    padding: '9px 12px',
                    textAlign: 'left',
                    fontWeight: 700,
                    color: sortField === 'title' ? C.accent : C.textSub,
                    borderBottom: `1px solid ${C.border}`,
                    cursor: 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    상품명
                    <SortIcon columnKey="title" />
                  </span>
                </th>

                {/* 도매가 */}
                <th
                  onClick={() => handleSortClick('latest_price_dome')}
                  style={{
                    padding: '9px 12px',
                    textAlign: 'right',
                    fontWeight: 700,
                    color: sortField === 'latest_price_dome' ? C.accent : C.textSub,
                    borderBottom: `1px solid ${C.border}`,
                    cursor: 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                    도매가
                    <SortIcon columnKey="latest_price_dome" />
                  </span>
                </th>

                {/* MOQ/배송 */}
                <th
                  onClick={() => handleSortClick('moq')}
                  style={{
                    padding: '9px 12px',
                    textAlign: 'center',
                    fontWeight: 700,
                    color: sortField === 'moq' ? C.accent : C.textSub,
                    borderBottom: `1px solid ${C.border}`,
                    cursor: 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    MOQ/배송
                    <SortIcon columnKey="moq" />
                  </span>
                </th>

                {/* 묶음전략 */}
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'center',
                    fontWeight: 700,
                    color: C.textSub,
                    borderBottom: `1px solid ${C.border}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  묶음전략
                </th>

                {/* 단가격차 */}
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'right',
                    fontWeight: 700,
                    color: C.textSub,
                    borderBottom: `1px solid ${C.border}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  단가격차
                </th>

                {/* 추천판매가 */}
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'right',
                    fontWeight: 700,
                    color: C.textSub,
                    borderBottom: `1px solid ${C.border}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  추천판매가
                </th>

                {/* 재고 */}
                <th
                  onClick={() => handleSortClick('latest_inventory')}
                  style={{
                    padding: '9px 12px',
                    textAlign: 'right',
                    fontWeight: 700,
                    color: sortField === 'latest_inventory' ? C.accent : C.textSub,
                    borderBottom: `1px solid ${C.border}`,
                    cursor: 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                    재고
                    <SortIcon columnKey="latest_inventory" />
                  </span>
                </th>

                {/* 전일판매 */}
                <th
                  onClick={() => handleSortClick('sales_1d')}
                  style={{
                    padding: '9px 12px',
                    textAlign: 'right',
                    fontWeight: 700,
                    color: sortField === 'sales_1d' ? C.accent : C.textSub,
                    borderBottom: `1px solid ${C.border}`,
                    cursor: 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                    전일판매
                    <SortIcon columnKey="sales_1d" />
                  </span>
                </th>

                {/* 7일판매 */}
                <th
                  onClick={() => handleSortClick('sales_7d')}
                  style={{
                    padding: '9px 12px',
                    textAlign: 'right',
                    fontWeight: 700,
                    color: sortField === 'sales_7d' ? C.accent : C.textSub,
                    borderBottom: `1px solid ${C.border}`,
                    cursor: 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                    7일판매
                    <SortIcon columnKey="sales_7d" />
                  </span>
                </th>

                {/* Legal */}
                <th
                  onClick={() => handleSortClick('legal_status')}
                  style={{
                    padding: '9px 12px',
                    textAlign: 'center',
                    fontWeight: 700,
                    color: sortField === 'legal_status' ? C.accent : C.textSub,
                    borderBottom: `1px solid ${C.border}`,
                    cursor: 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    Legal
                    <SortIcon columnKey="legal_status" />
                  </span>
                </th>

                {/* IP리스크 */}
                <th
                  onClick={() => handleSortClick('ip_risk')}
                  style={{
                    padding: '9px 12px',
                    textAlign: 'center',
                    fontWeight: 700,
                    color: sortField === 'ip_risk' ? C.accent : C.textSub,
                    borderBottom: `1px solid ${C.border}`,
                    cursor: 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                    IP리스크
                    <SortIcon columnKey="ip_risk" />
                  </span>
                </th>

                {/* 검토 */}
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'center',
                    fontWeight: 700,
                    color: C.textSub,
                    borderBottom: `1px solid ${C.border}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  검토
                </th>

                {/* 시즌 */}
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'center',
                    fontWeight: 700,
                    color: C.textSub,
                    borderBottom: `1px solid ${C.border}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  시즌
                </th>

                {/* 타겟 */}
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'center',
                    fontWeight: 700,
                    color: C.textSub,
                    borderBottom: `1px solid ${C.border}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  타겟
                </th>

                {/* 종합점수 */}
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'center',
                    fontWeight: 700,
                    color: C.textSub,
                    borderBottom: `1px solid ${C.border}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  종합점수
                </th>

                {/* 링크 */}
                <th
                  style={{
                    padding: '9px 12px',
                    textAlign: 'center',
                    fontWeight: 700,
                    color: C.textSub,
                    borderBottom: `1px solid ${C.border}`,
                    width: '44px',
                  }}
                >
                  링크
                </th>
              </tr>
            </thead>

            <tbody>
              {filteredItems.map((item, idx) => {
                const bundleData = getEffectiveBundleData(item);
                const scoreData = getEffectiveScore(item);
                const legalBadge = LEGAL_BADGE[item.legalStatus] ?? LEGAL_BADGE.unchecked;
                const ipBadge = item.ipRiskLevel ? IP_BADGE[item.ipRiskLevel] : null;
                const deliWhoBadge = item.deliWho ? DELI_WHO_LABEL[item.deliWho] : null;
                const isVerifyingThisIp = ipVerifyingId === item.id;
                const rowNumber = (page - 1) * pageSize + idx + 1;

                return (
                  <tr
                    key={item.id}
                    onClick={() => setSelectedItem(item)}
                    style={{
                      borderBottom: `1px solid ${C.border}`,
                      cursor: 'pointer',
                      transition: 'background-color 0.1s',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.backgroundColor = C.rowHover;
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'transparent';
                    }}
                  >
                    {/* # 순번 */}
                    <td
                      style={{
                        padding: '10px 12px',
                        textAlign: 'center',
                        color: C.textSub,
                        fontSize: '11px',
                      }}
                    >
                      {rowNumber}
                    </td>

                    {/* 상품명 + 카테고리 */}
                    <td style={{ padding: '10px 12px', maxWidth: '260px' }}>
                      <p
                        style={{
                          margin: 0,
                          fontWeight: 600,
                          color: C.text,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: '240px',
                        }}
                        title={item.title}
                      >
                        {item.title}
                      </p>
                      {item.categoryName && (
                        <p
                          style={{
                            margin: '2px 0 0',
                            fontSize: '11px',
                            color: C.textSub,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '240px',
                          }}
                        >
                          {item.categoryName}
                        </p>
                      )}
                    </td>

                    {/* 도매가 */}
                    <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {item.latestPriceDome != null ? (
                        <span style={{ fontWeight: 600, color: C.text }}>
                          {formatNumber(item.latestPriceDome)}원
                        </span>
                      ) : (
                        <span style={{ color: C.textSub }}>-</span>
                      )}
                    </td>

                    {/* MOQ/배송 */}
                    <td style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: C.text }}>
                          {item.moq ?? '-'}
                        </span>
                        {deliWhoBadge && (
                          <span
                            style={{
                              fontSize: '10px',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              fontWeight: 600,
                              backgroundColor: deliWhoBadge.bg,
                              color: deliWhoBadge.color,
                            }}
                          >
                            {deliWhoBadge.label}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* 묶음전략 */}
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      {bundleData.strategy != null ? (
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '2px 7px',
                            borderRadius: '4px',
                            fontWeight: 700,
                            backgroundColor: STRATEGY_BADGE[bundleData.strategy]?.bg ?? C.tableHeader,
                            color: STRATEGY_BADGE[bundleData.strategy]?.color ?? C.text,
                          }}
                        >
                          {STRATEGY_LABEL[bundleData.strategy] ?? bundleData.strategy}
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: '11px',
                            padding: '2px 7px',
                            borderRadius: '4px',
                            fontWeight: 600,
                            backgroundColor: 'rgba(156, 163, 175, 0.1)',
                            color: '#9ca3af',
                          }}
                        >
                          제외
                        </span>
                      )}
                    </td>

                    {/* 단가격차 */}
                    <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {bundleData.gapRate != null ? (
                        <span
                          style={{
                            fontWeight: 700,
                            color: bundleData.gapRate >= 0 ? '#16a34a' : '#dc2626',
                          }}
                        >
                          {bundleData.gapRate >= 0 ? '+' : ''}
                          {bundleData.gapRate}%
                        </span>
                      ) : (
                        <span style={{ color: C.textSub }}>-</span>
                      )}
                    </td>

                    {/* 추천판매가 */}
                    <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {bundleData.bundlePrice != null ? (
                        <span style={{ fontWeight: 600, color: C.text }}>
                          {formatNumber(bundleData.bundlePrice)}원
                        </span>
                      ) : (
                        <span style={{ color: C.textSub }}>-</span>
                      )}
                    </td>

                    {/* 재고 */}
                    <td
                      style={{
                        padding: '10px 12px',
                        textAlign: 'right',
                        fontWeight: 600,
                        color: item.latestInventory > 0 ? C.text : '#dc2626',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatNumber(item.latestInventory)}
                    </td>

                    {/* 전일판매 */}
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <SalesCell value={item.sales1d} />
                    </td>

                    {/* 7일판매 */}
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <SalesCell value={item.sales7d} />
                    </td>

                    {/* Legal */}
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                          fontSize: '11px',
                          padding: '2px 7px',
                          borderRadius: '4px',
                          fontWeight: 600,
                          backgroundColor: legalBadge.bg,
                          color: legalBadge.color,
                        }}
                      >
                        {legalBadge.emoji} {legalBadge.label}
                      </span>
                    </td>

                    {/* IP리스크 */}
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isVerifyingThisIp && !ipVerifyingId) {
                            verifyIp(item.id, item.title);
                          }
                        }}
                        title={
                          ipVerifyingId && ipVerifyingId !== item.id
                            ? '다른 항목 검증 중'
                            : '클릭하여 IP 재검증'
                        }
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          cursor:
                            isVerifyingThisIp || (ipVerifyingId != null && ipVerifyingId !== item.id)
                              ? 'not-allowed'
                              : 'pointer',
                        }}
                      >
                        {isVerifyingThisIp ? (
                          <Loader2
                            size={13}
                            style={{ animation: 'spin 1s linear infinite', color: C.accent }}
                          />
                        ) : ipBadge ? (
                          <span
                            style={{
                              display: 'inline-block',
                              fontSize: '11px',
                              padding: '2px 7px',
                              borderRadius: '4px',
                              fontWeight: 600,
                              backgroundColor: ipBadge.bg,
                              color: ipBadge.color,
                              border: `1px solid ${ipBadge.border}`,
                            }}
                          >
                            {ipBadge.label}
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: '11px',
                              padding: '2px 7px',
                              borderRadius: '4px',
                              fontWeight: 600,
                              backgroundColor: 'rgba(156, 163, 175, 0.1)',
                              color: '#9ca3af',
                            }}
                          >
                            미검사
                          </span>
                        )}
                      </button>
                    </td>

                    {/* 검토 */}
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      {(() => {
                        const blocked = getEffectiveBlockedReason(item);
                        if (blocked) {
                          return (
                            <span title={blocked} style={{
                              fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '100px',
                              color: '#dc2626', backgroundColor: 'rgba(220,38,38,0.08)', cursor: 'help'
                            }}>🚫 차단</span>
                          );
                        }
                        const maleInfo = classifyMaleTarget(item.title ?? '', item.categoryName ?? '');
                        if (item.needsReview || maleInfo.needsReview) {
                          return (
                            <span style={{
                              fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '100px',
                              color: '#d97706', backgroundColor: 'rgba(217,119,6,0.08)'
                            }}>⚠ 검토</span>
                          );
                        }
                        return <span style={{ color: '#d1d5db', fontSize: '11px' }}>-</span>;
                      })()}
                    </td>

                    {/* 시즌 */}
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      {(() => {
                        const { bonus, labels } = getEffectiveSeasonBonus(item);
                        if (bonus === 0) return <span style={{ color: '#d1d5db', fontSize: '11px' }}>-</span>;
                        return (
                          <span title={labels.join(', ')} style={{
                            fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '100px',
                            color: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.08)', cursor: 'help'
                          }}>
                            🎯 +{bonus}
                          </span>
                        );
                      })()}
                    </td>

                    {/* 타겟 */}
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      {(() => {
                        const tier = getEffectiveMaleTier(item);
                        if (!tier || tier === 'neutral') return <span style={{ color: '#d1d5db', fontSize: '11px' }}>-</span>;
                        const badge = MALE_TIER_BADGE[tier];
                        return (
                          <span style={{
                            fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '100px',
                            color: badge.color, backgroundColor: badge.bg
                          }}>
                            {badge.label}
                          </span>
                        );
                      })()}
                    </td>

                    {/* 종합점수 */}
                    <td style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '2px',
                        }}
                      >
                        <span style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>
                          {scoreData.total}
                        </span>
                        <span
                          style={{
                            fontSize: '10px',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontWeight: 800,
                            backgroundColor: scoreData.grade.bg,
                            color: scoreData.grade.color,
                            letterSpacing: '0.03em',
                          }}
                        >
                          {scoreData.grade.label}
                        </span>
                      </div>
                    </td>

                    {/* 링크 */}
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      {item.domeUrl ? (
                        <a
                          href={item.domeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="도매꾹 상품 페이지 열기"
                          style={{ color: C.textSub, display: 'inline-flex' }}
                        >
                          <ExternalLink size={14} />
                        </a>
                      ) : (
                        <span style={{ color: C.border }}>-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── 페이지네이션 ──────────────────────────────────────────────────── */}
      {!isLoading && totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '16px 20px',
            borderTop: `1px solid ${C.border}`,
            backgroundColor: C.card,
            flexWrap: 'wrap',
          }}
        >
          {/* 이전 버튼 */}
          <button
            onClick={() => page > 1 && setPage(page - 1)}
            disabled={page <= 1}
            style={{
              padding: '5px 12px',
              borderRadius: '6px',
              border: `1px solid ${C.border}`,
              backgroundColor: page <= 1 ? C.tableHeader : C.card,
              color: page <= 1 ? C.textSub : C.text,
              cursor: page <= 1 ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            이전
          </button>

          {/* 페이지 번호 (최대 7개 표시) */}
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => {
              if (totalPages <= 7) return true;
              if (p === 1 || p === totalPages) return true;
              if (Math.abs(p - page) <= 2) return true;
              return false;
            })
            .reduce<(number | '...')[]>((acc, p, idx, arr) => {
              if (idx > 0 && typeof arr[idx - 1] === 'number' && (p as number) - (arr[idx - 1] as number) > 1) {
                acc.push('...');
              }
              acc.push(p);
              return acc;
            }, [])
            .map((p, i) =>
              p === '...' ? (
                <span key={`ellipsis-${i}`} style={{ fontSize: '12px', color: C.textSub, padding: '0 4px' }}>
                  ...
                </span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p as number)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '6px',
                    border: `1px solid ${p === page ? C.accent : C.border}`,
                    backgroundColor: p === page ? C.accent : C.card,
                    color: p === page ? '#ffffff' : C.text,
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: p === page ? 700 : 400,
                    minWidth: '32px',
                  }}
                >
                  {p}
                </button>
              ),
            )}

          {/* 다음 버튼 */}
          <button
            onClick={() => page < totalPages && setPage(page + 1)}
            disabled={page >= totalPages}
            style={{
              padding: '5px 12px',
              borderRadius: '6px',
              border: `1px solid ${C.border}`,
              backgroundColor: page >= totalPages ? C.tableHeader : C.card,
              color: page >= totalPages ? C.textSub : C.text,
              cursor: page >= totalPages ? 'not-allowed' : 'pointer',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            다음
          </button>

          <span style={{ fontSize: '12px', color: C.textSub, marginLeft: '8px' }}>
            {page} / {totalPages}페이지 (총 {formatNumber(totalCount)}개)
          </span>
        </div>
      )}

      {/* ── MOQ 시나리오 패널 ─────────────────────────────────────────────── */}
      {selectedItem && (
        <MoqScenarioPanel
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </div>
  );
}
