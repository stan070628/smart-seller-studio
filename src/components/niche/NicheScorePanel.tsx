'use client';

/**
 * NicheScorePanel.tsx
 * 키워드 상세 분석 결과 패널
 *
 * 7요소 breakdown 수평 막대 차트, 시그널 리스트, 관심 등록 버튼
 */

import React, { useState } from 'react';
import { ArrowLeft, Star, Loader2 } from 'lucide-react';
import type { CurrentAnalysis } from '@/store/useNicheStore';
import { useNicheStore } from '@/store/useNicheStore';
import NicheRadarChart from './NicheRadarChart';
import NicheHistoryChart from './NicheHistoryChart';
import NicheSourcingLinks from './NicheSourcingLinks';
import NicheCompetitorPanel from './NicheCompetitorPanel';

// ─────────────────────────────────────────────────────────────────────────────
// 색상 상수 (SourcingDashboard 동일 테마)
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: '#f9f9f9',
  card: '#ffffff',
  border: '#eeeeee',
  text: '#1a1c1c',
  textSub: '#926f6b',
  accent: '#be0014',
};

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

// ─────────────────────────────────────────────────────────────────────────────
// breakdown 항목 메타 (라벨 + 만점)
// ─────────────────────────────────────────────────────────────────────────────
const BREAKDOWN_META: {
  key: keyof CurrentAnalysis['breakdown'];
  label: string;
  max: number;
  description: string;
}[] = [
  { key: 'rocketNonEntry',       label: '로켓 미진입',    max: 30, description: '로켓배송 상품 비중이 낮을수록 유리' },
  { key: 'competitionLevel',     label: '경쟁 강도',      max: 20, description: '총 상품 수 기준 경쟁 수준' },
  { key: 'sellerDiversity',      label: '판매자 다양성',  max: 15, description: '다수 판매자가 분산될수록 유리' },
  { key: 'monopolyLevel',        label: '독점 수준',      max: 10, description: '상위 3사 점유율이 낮을수록 유리' },
  { key: 'brandRatio',           label: '브랜드 비율',    max: 10, description: '공식 브랜드 상품 비중' },
  { key: 'priceMarginViability', label: '마진 가능성',    max: 10, description: '가격 구간의 마진 실현 가능성' },
  { key: 'domesticRarity',       label: '국내 희소성',    max: 5,  description: '국내 유사 상품 희소도' },
];

// 시그널 점 색상 결정 (점수 기반 or 내용 기반)
function getSignalDotColor(signal: string): string {
  if (signal.startsWith('✅') || signal.includes('낮') || signal.includes('우수') || signal.includes('유리')) {
    return '#16a34a'; // 초록
  }
  if (signal.startsWith('⚠️') || signal.includes('주의') || signal.includes('중간')) {
    return '#d97706'; // 노랑
  }
  if (signal.startsWith('❌') || signal.includes('위험') || signal.includes('높') || signal.includes('치열')) {
    return '#dc2626'; // 빨강
  }
  return '#6b7280'; // 회색 (기본)
}

// 프로그레스 바 색상 (비율 기반)
function getBarColor(ratio: number): string {
  if (ratio >= 0.8) return '#16a34a';
  if (ratio >= 0.5) return '#2563eb';
  if (ratio >= 0.3) return '#d97706';
  return '#dc2626';
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────
interface NicheScorePanelProps {
  keyword: string;
  result: CurrentAnalysis;
  onBack: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export default function NicheScorePanel({ keyword, result, onBack }: NicheScorePanelProps) {
  const { addToWatchlist, watchlist } = useNicheStore();
  const [isAdding, setIsAdding] = useState(false);
  const [added, setAdded] = useState(false);

  // 이미 관심 등록됐는지 확인
  const isInWatchlist = watchlist.some((item) => item.keyword === keyword) || added;

  const gradeColor = GRADE_COLOR[result.grade] ?? GRADE_COLOR['D'];

  const handleAddToWatchlist = async () => {
    if (isInWatchlist || isAdding) return;
    setIsAdding(true);
    try {
      await addToWatchlist(keyword);
      setAdded(true);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div
      style={{
        backgroundColor: C.bg,
        minHeight: '100%',
        padding: '24px',
        fontFamily: "'Noto Sans KR', sans-serif",
        color: C.text,
      }}
    >
      {/* ── 뒤로 버튼 ──────────────────────────────────────────────────────── */}
      <button
        onClick={onBack}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: '13px',
          color: C.textSub,
          padding: '4px 0',
          marginBottom: '20px',
          fontWeight: 500,
        }}
      >
        <ArrowLeft size={15} />
        목록으로
      </button>

      {/* ── 헤더: 키워드명 + 등급 배지 + 총점 ─────────────────────────────── */}
      <div
        style={{
          backgroundColor: C.card,
          borderRadius: '12px',
          border: `1px solid ${C.border}`,
          padding: '20px 24px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* 등급 배지 */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              backgroundColor: gradeColor.bg,
              color: gradeColor.text,
              fontSize: '20px',
              fontWeight: '800',
              border: `1.5px solid ${gradeColor.border}`,
              flexShrink: 0,
            }}
          >
            {result.grade}
          </span>

          <div>
            <p
              style={{
                margin: 0,
                fontSize: '20px',
                fontWeight: '700',
                color: C.text,
                letterSpacing: '-0.3px',
              }}
            >
              {keyword}
            </p>
            <p style={{ margin: '3px 0 0', fontSize: '12px', color: C.textSub }}>
              상품 {result.rawTotalProducts?.toLocaleString('ko-KR') ?? '-'}개 &middot; 평균
              {' '}{result.rawAvgPrice ? `${Math.round(result.rawAvgPrice).toLocaleString('ko-KR')}원` : '-'}
            </p>
          </div>
        </div>

        {/* 총점 + 관심 등록 버튼 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: '36px', fontWeight: '800', color: C.text, lineHeight: 1 }}>
              {result.totalScore}
            </span>
            <span style={{ fontSize: '14px', color: C.textSub, marginLeft: '3px' }}>/100</span>
          </div>

          <button
            onClick={handleAddToWatchlist}
            disabled={isInWatchlist || isAdding}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '9px 16px',
              borderRadius: '8px',
              border: 'none',
              cursor: isInWatchlist ? 'default' : 'pointer',
              fontSize: '13px',
              fontWeight: 600,
              backgroundColor: isInWatchlist ? 'rgba(22, 163, 74, 0.1)' : C.accent,
              color: isInWatchlist ? '#15803d' : '#ffffff',
              transition: 'all 0.15s',
              opacity: isAdding ? 0.7 : 1,
            }}
          >
            {isAdding ? (
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <Star size={14} fill={isInWatchlist ? '#15803d' : 'none'} />
            )}
            {isInWatchlist ? '관심 등록됨' : '관심 등록'}
          </button>
        </div>
      </div>

      {/* ── 7요소 Breakdown 차트 + 레이더 차트 (좌우 배치) ─────────────────── */}
      <div
        style={{
          backgroundColor: C.card,
          borderRadius: '12px',
          border: `1px solid ${C.border}`,
          padding: '20px 24px',
          marginBottom: '16px',
        }}
      >
        <h3
          style={{
            margin: '0 0 16px',
            fontSize: '14px',
            fontWeight: '700',
            color: C.text,
          }}
        >
          점수 세부 분석
        </h3>

        {/* 막대 차트 + 레이더 차트 좌우 배치 */}
        <div
          style={{
            display: 'flex',
            gap: '24px',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
          }}
        >
          {/* 왼쪽: 수평 막대 차트 */}
          <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {BREAKDOWN_META.map((item) => {
              const score = result.breakdown?.[item.key] ?? 0;
              const ratio = item.max > 0 ? score / item.max : 0;
              const barColor = getBarColor(ratio);

              return (
                <div key={item.key}>
                  {/* 라벨 행 */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: C.text }}>
                        {item.label}
                      </span>
                      <span style={{ fontSize: '11px', color: C.textSub }}>{item.description}</span>
                    </div>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: C.text, flexShrink: 0 }}>
                      {score}
                      <span style={{ fontSize: '11px', color: C.textSub, fontWeight: 500 }}>
                        /{item.max}
                      </span>
                    </span>
                  </div>

                  {/* 프로그레스 바 */}
                  <div
                    style={{
                      height: '7px',
                      borderRadius: '4px',
                      backgroundColor: '#f3f3f3',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${ratio * 100}%`,
                        backgroundColor: barColor,
                        borderRadius: '4px',
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* 오른쪽: 레이더 차트 */}
          <div
            style={{
              flex: '0 0 auto',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span
              style={{ fontSize: '12px', fontWeight: 600, color: C.textSub, alignSelf: 'flex-start' }}
            >
              종합 레이더
            </span>
            <NicheRadarChart breakdown={result.breakdown} />
          </div>
        </div>
      </div>

      {/* ── 시그널 리스트 ──────────────────────────────────────────────────── */}
      {result.signals && result.signals.length > 0 && (
        <div
          style={{
            backgroundColor: C.card,
            borderRadius: '12px',
            border: `1px solid ${C.border}`,
            padding: '20px 24px',
            marginBottom: '16px',
          }}
        >
          <h3
            style={{
              margin: '0 0 14px',
              fontSize: '14px',
              fontWeight: '700',
              color: C.text,
            }}
          >
            분석 시그널 ({result.signals.length}개)
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {result.signals.map((signal, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '10px 12px',
                  backgroundColor: C.bg,
                  borderRadius: '8px',
                  border: `1px solid ${C.border}`,
                }}
              >
                {/* 색상 점 */}
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: getSignalDotColor(signal),
                    flexShrink: 0,
                    marginTop: '5px',
                  }}
                />
                <span style={{ fontSize: '13px', color: C.text, lineHeight: '1.6' }}>
                  {signal}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 소싱 검색 (중국어 검색어 + 플랫폼 링크) ──────────────────���────── */}
      <NicheSourcingLinks keyword={keyword} />

      {/* ── 경쟁 상품 추적 (등록 + 스냅샷 입력) ────────────────────────────── */}
      <NicheCompetitorPanel keyword={keyword} />

      {/* ── 점수 변동 추이 차트 ────────────────────────────────────────────── */}
      <div
        style={{
          backgroundColor: C.card,
          borderRadius: '12px',
          border: `1px solid ${C.border}`,
          padding: '20px 24px',
        }}
      >
        <h3
          style={{
            margin: '0 0 16px',
            fontSize: '14px',
            fontWeight: '700',
            color: C.text,
          }}
        >
          점수 변동 추이 (최근 30일)
        </h3>
        <NicheHistoryChart keyword={keyword} />
      </div>

      {/* 스피너 keyframe */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
