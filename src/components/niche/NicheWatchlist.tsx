'use client';

/**
 * NicheWatchlist.tsx
 * 관심 등록한 키워드 목록 컴포넌트
 *
 * 마운트 시 fetchWatchlist() 호출
 * 항목 클릭 → analyzeKeyword(keyword)
 * 삭제 버튼 → removeFromWatchlist(id)
 */

import React, { useEffect } from 'react';
import { X, Star } from 'lucide-react';
import { useNicheStore } from '@/store/useNicheStore';

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

// 등급별 배지 색상
const GRADE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  S: { bg: 'rgba(212, 160, 23, 0.12)', text: '#D4A017', border: '#D4A017' },
  A: { bg: 'rgba(22, 163, 74, 0.1)',   text: '#16a34a', border: '#16a34a' },
  B: { bg: 'rgba(37, 99, 235, 0.1)',   text: '#2563eb', border: '#2563eb' },
  C: { bg: 'rgba(245, 158, 11, 0.1)',  text: '#f59e0b', border: '#f59e0b' },
  D: { bg: 'rgba(239, 68, 68, 0.1)',   text: '#ef4444', border: '#ef4444' },
};

// ─────────────────────────────────────────────────────────────────────────────
// 스켈레톤 행 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '14px 16px',
        borderBottom: `1px solid ${C.border}`,
        animation: 'niche-watchlist-pulse 1.5s ease-in-out infinite',
      }}
    >
      {/* 키워드명 플레이스홀더 */}
      <div
        style={{
          flex: 1,
          height: '14px',
          borderRadius: '6px',
          backgroundColor: '#e5e7eb',
        }}
      />
      {/* 등급 배지 플레이스홀더 */}
      <div
        style={{
          width: '36px',
          height: '20px',
          borderRadius: '4px',
          backgroundColor: '#e5e7eb',
        }}
      />
      {/* 점수 플레이스홀더 */}
      <div
        style={{
          width: '48px',
          height: '14px',
          borderRadius: '6px',
          backgroundColor: '#e5e7eb',
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export default function NicheWatchlist() {
  const { watchlist, analyzeKeyword, removeFromWatchlist, fetchWatchlist, isLoading } =
    useNicheStore();

  // 마운트 시 관심 목록 조회
  useEffect(() => {
    fetchWatchlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 항목 클릭 → 상세 분석
  const handleItemClick = (keyword: string) => {
    analyzeKeyword(keyword);
  };

  // 삭제 버튼 클릭
  const handleRemove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    removeFromWatchlist(id);
  };

  return (
    <div
      style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '10px',
        overflow: 'hidden',
        fontFamily: "'Noto Sans KR', sans-serif",
        color: C.text,
      }}
    >
      {/* ── 헤더 ─────────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '14px 16px',
          borderBottom: `1px solid ${C.border}`,
          backgroundColor: C.bg,
        }}
      >
        <Star size={15} style={{ color: C.accent, flexShrink: 0 }} />
        <span style={{ fontSize: '14px', fontWeight: 700, color: C.text }}>관심 키워드</span>
        {/* 개수 배지 */}
        {!isLoading && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: '20px',
              height: '20px',
              padding: '0 6px',
              borderRadius: '10px',
              backgroundColor: 'rgba(190, 0, 20, 0.1)',
              color: C.accent,
              fontSize: '11px',
              fontWeight: 700,
            }}
          >
            {watchlist.length}
          </span>
        )}
      </div>

      {/* ── 본문 ─────────────────────────────────────────────────────────────── */}
      {isLoading ? (
        /* 로딩 스켈레톤 3줄 */
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : watchlist.length === 0 ? (
        /* 빈 상태 */
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '36px 24px',
            color: C.textSub,
          }}
        >
          <Star size={28} style={{ opacity: 0.3 }} />
          <p style={{ margin: 0, fontSize: '13px', textAlign: 'center', lineHeight: 1.5 }}>
            관심 키워드를 등록하면 점수 변동을 추적할 수 있습니다
          </p>
        </div>
      ) : (
        /* 키워드 목록 */
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {watchlist.map((item, idx) => {
            const gc = item.latestGrade
              ? (GRADE_COLORS[item.latestGrade] ?? GRADE_COLORS['D'])
              : null;
            const isLast = idx === watchlist.length - 1;

            return (
              <li
                key={item.id}
                onClick={() => handleItemClick(item.keyword)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '13px 16px',
                  borderBottom: isLast ? 'none' : `1px solid ${C.border}`,
                  cursor: 'pointer',
                  transition: 'background-color 0.12s',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLLIElement).style.backgroundColor = '#f7f7f7';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLLIElement).style.backgroundColor = 'transparent';
                }}
              >
                {/* 키워드명 + 메모 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: C.text,
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.keyword}
                  </span>
                  {item.memo && (
                    <span
                      style={{
                        fontSize: '11px',
                        color: C.textSub,
                        display: 'block',
                        marginTop: '2px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.memo}
                    </span>
                  )}
                </div>

                {/* 등급 배지 */}
                {gc && item.latestGrade ? (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '32px',
                      height: '22px',
                      borderRadius: '5px',
                      border: `1px solid ${gc.border}`,
                      backgroundColor: gc.bg,
                      color: gc.text,
                      fontSize: '11px',
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {item.latestGrade}
                  </span>
                ) : (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '32px',
                      height: '22px',
                      borderRadius: '5px',
                      border: `1px solid ${C.border}`,
                      backgroundColor: C.bg,
                      color: C.textSub,
                      fontSize: '11px',
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    -
                  </span>
                )}

                {/* 최신 점수 */}
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: item.latestScore != null ? C.text : C.textSub,
                    minWidth: '40px',
                    textAlign: 'right',
                    flexShrink: 0,
                  }}
                >
                  {item.latestScore != null ? `${item.latestScore}점` : '-'}
                </span>

                {/* 삭제 버튼 */}
                <button
                  onClick={(e) => handleRemove(e, item.id)}
                  title="관심 해제"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    border: 'none',
                    backgroundColor: 'transparent',
                    color: C.textSub,
                    cursor: 'pointer',
                    flexShrink: 0,
                    transition: 'background-color 0.12s, color 0.12s',
                    padding: 0,
                  }}
                  onMouseEnter={(e) => {
                    const btn = e.currentTarget as HTMLButtonElement;
                    btn.style.backgroundColor = 'rgba(190, 0, 20, 0.1)';
                    btn.style.color = C.accent;
                  }}
                  onMouseLeave={(e) => {
                    const btn = e.currentTarget as HTMLButtonElement;
                    btn.style.backgroundColor = 'transparent';
                    btn.style.color = C.textSub;
                  }}
                >
                  <X size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* 펄스 keyframe */}
      <style>{`
        @keyframes niche-watchlist-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
