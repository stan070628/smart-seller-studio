'use client';

/**
 * NicheTab.tsx
 * 니치소싱 탭 메인 컴포넌트
 *
 * 검색바 → 등급 필터 → 키워드 카드 그리드 → 페이지네이션
 * 카드 클릭 시 analyzeKeyword 호출 후 NicheScorePanel(상세뷰)로 전환
 */

import React, { useEffect, useCallback, useRef, useState } from 'react';
import { Search, Loader2, AlertCircle, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useNicheStore } from '@/store/useNicheStore';
import NicheKeywordCard from './NicheKeywordCard';
import NicheScorePanel from './NicheScorePanel';
import NicheWatchlist from './NicheWatchlist';

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
  btnPrimaryBg: '#be0014',
  btnPrimaryText: '#ffffff',
  btnSecondaryBg: '#f3f3f3',
  btnSecondaryText: '#1a1c1c',
};

// ─────────────────────────────────────────────────────────────────────────────
// 등급 필터 버튼 목록
// ─────────────────────────────────────────────────────────────────────────────
const GRADE_BUTTONS = ['S', 'A', 'B', 'C', 'D'] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export default function NicheTab() {
  const {
    keywords,
    keywordsTotal,
    currentAnalysis,
    selectedKeyword,
    activeView,
    isLoading,
    isAnalyzing,
    error,
    gradeFilter,
    page,
    pageSize,
    fetchKeywords,
    analyzeKeyword,
    setGradeFilter,
    setSearchQuery,
    setPage,
    clearError,
  } = useNicheStore();

  // 검색 입력 로컬 상태 (debounce용)
  const [inputValue, setInputValue] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 마운트 시 키워드 목록 로드
  useEffect(() => {
    fetchKeywords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 필터/페이지 변경 시 재조회
  useEffect(() => {
    fetchKeywords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradeFilter, page]);

  // 검색어 debounce (300ms)
  const handleSearchInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      setInputValue(q);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setSearchQuery(q);
        fetchKeywords();
      }, 300);
    },
    [setSearchQuery, fetchKeywords],
  );

  // 분석 실행
  const handleAnalyze = useCallback(() => {
    const kw = inputValue.trim();
    if (!kw || isAnalyzing) return;
    analyzeKeyword(kw);
  }, [inputValue, isAnalyzing, analyzeKeyword]);

  // Enter 키 분석 트리거
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') handleAnalyze();
    },
    [handleAnalyze],
  );

  // 카드 클릭 → 분석 실행
  const handleCardSelect = useCallback(
    (kw: string) => {
      setInputValue(kw);
      analyzeKeyword(kw);
    },
    [analyzeKeyword],
  );

  // 등급 필터 토글
  const handleGradeToggle = useCallback(
    (grade: string) => {
      if (gradeFilter.includes(grade)) {
        setGradeFilter(gradeFilter.filter((g) => g !== grade));
      } else {
        setGradeFilter([...gradeFilter, grade]);
      }
    },
    [gradeFilter, setGradeFilter],
  );

  // 전체 필터 초기화
  const handleGradeAll = useCallback(() => {
    setGradeFilter([]);
  }, [setGradeFilter]);

  // 뒤로 (상세 → 그리드)
  const handleBack = useCallback(() => {
    useNicheStore.setState({ activeView: 'grid', currentAnalysis: null, selectedKeyword: null });
  }, []);

  const totalPages = Math.max(1, Math.ceil(keywordsTotal / pageSize));

  // ── 상세 뷰 ────────────────────────────────────────────────────────────────
  if (activeView === 'detail' && currentAnalysis && selectedKeyword) {
    return (
      <div style={{ flex: 1, backgroundColor: C.bg }}>
        <NicheScorePanel
          keyword={selectedKeyword}
          result={currentAnalysis}
          onBack={handleBack}
        />
      </div>
    );
  }

  // ── 그리드 뷰 ──────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        flex: 1,
        backgroundColor: C.bg,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Noto Sans KR', sans-serif",
        color: C.text,
      }}
    >
      {/* ── 검색바 ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          backgroundColor: C.card,
          borderBottom: `1px solid ${C.border}`,
          padding: '16px 24px',
        }}
      >
        <div style={{ display: 'flex', gap: '10px', maxWidth: '640px' }}>
          {/* 입력 필드 */}
          <div
            style={{
              flex: 1,
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: '12px',
                color: C.textSub,
                pointerEvents: 'none',
              }}
            />
            <input
              type="text"
              value={inputValue}
              onChange={handleSearchInputChange}
              onKeyDown={handleKeyDown}
              placeholder="키워드를 입력하세요 (예: 캠핑의자, 강아지간식)"
              style={{
                width: '100%',
                height: '40px',
                paddingLeft: '38px',
                paddingRight: '12px',
                border: `1px solid ${C.border}`,
                borderRadius: '8px',
                fontSize: '13px',
                color: C.text,
                backgroundColor: C.bg,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* 분석 버튼 */}
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || !inputValue.trim()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              height: '40px',
              padding: '0 18px',
              borderRadius: '8px',
              border: 'none',
              cursor: isAnalyzing || !inputValue.trim() ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              fontWeight: 600,
              backgroundColor: isAnalyzing || !inputValue.trim()
                ? 'rgba(190, 0, 20, 0.4)'
                : C.btnPrimaryBg,
              color: C.btnPrimaryText,
              flexShrink: 0,
              transition: 'background-color 0.15s',
            }}
          >
            {isAnalyzing ? (
              <>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                분석 중...
              </>
            ) : (
              <>
                <Search size={14} />
                분석하기
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── 에러 배너 ──────────────────────────────────────────────────────── */}
      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 24px',
            backgroundColor: 'rgba(190, 0, 20, 0.06)',
            borderBottom: `1px solid rgba(190, 0, 20, 0.2)`,
            fontSize: '13px',
            color: C.accent,
          }}
        >
          <AlertCircle size={14} />
          <span style={{ flex: 1 }}>{error}</span>
          <button
            onClick={clearError}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: C.accent,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── 등급 필터 + 요약 ───────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 24px',
          backgroundColor: C.card,
          borderBottom: `1px solid ${C.border}`,
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        {/* 등급 필터 버튼 그룹 */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {/* 전체 버튼 */}
          <button
            onClick={handleGradeAll}
            style={{
              padding: '5px 12px',
              borderRadius: '100px',
              border: `1px solid ${gradeFilter.length === 0 ? C.accent : C.border}`,
              backgroundColor: gradeFilter.length === 0 ? 'rgba(190, 0, 20, 0.08)' : C.card,
              color: gradeFilter.length === 0 ? C.accent : C.textSub,
              fontSize: '12px',
              fontWeight: gradeFilter.length === 0 ? 700 : 500,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            전체
          </button>

          {/* S~D 등급 버튼 */}
          {GRADE_BUTTONS.map((grade) => {
            const isActive = gradeFilter.includes(grade);
            const gradeColors: Record<string, { active: string; text: string }> = {
              S: { active: 'rgba(217, 179, 0, 0.12)', text: '#b8950a' },
              A: { active: 'rgba(22, 163, 74, 0.1)',  text: '#15803d' },
              B: { active: 'rgba(37, 99, 235, 0.1)',  text: '#1d4ed8' },
              C: { active: 'rgba(217, 119, 6, 0.1)',  text: '#b45309' },
              D: { active: 'rgba(220, 38, 38, 0.1)',  text: '#b91c1c' },
            };
            const gc = gradeColors[grade];

            return (
              <button
                key={grade}
                onClick={() => handleGradeToggle(grade)}
                style={{
                  padding: '5px 12px',
                  borderRadius: '100px',
                  border: `1px solid ${isActive ? gc.text : C.border}`,
                  backgroundColor: isActive ? gc.active : C.card,
                  color: isActive ? gc.text : C.textSub,
                  fontSize: '12px',
                  fontWeight: isActive ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {grade}등급
              </button>
            );
          })}
        </div>

        {/* 검색 결과 수 */}
        <span style={{ fontSize: '12px', color: C.textSub }}>
          총 <strong style={{ color: C.text }}>{keywordsTotal.toLocaleString('ko-KR')}</strong>개 키워드
        </span>
      </div>

      {/* ── 키워드 카드 그리드 ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, padding: '20px 24px' }}>
        {isLoading ? (
          /* 로딩 스켈레톤 */
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: '16px',
            }}
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                style={{
                  height: '180px',
                  borderRadius: '10px',
                  backgroundColor: C.card,
                  border: `1px solid ${C.border}`,
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}
              />
            ))}
          </div>
        ) : keywords.length === 0 ? (
          /* 빈 상태 */
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '80px 24px',
              gap: '12px',
              color: C.textSub,
            }}
          >
            <Search size={40} style={{ opacity: 0.3 }} />
            <p style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: C.textSub }}>
              아직 추천 키워드가 없습니다.
            </p>
            <p style={{ margin: 0, fontSize: '13px', color: C.textSub, textAlign: 'center' }}>
              키워드를 직접 입력하여 분석해보세요.
            </p>
          </div>
        ) : (
          /* 카드 그리드 */
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: '16px',
            }}
          >
            {keywords.map((kw) => (
              <NicheKeywordCard
                key={kw.id}
                keyword={kw}
                onSelect={handleCardSelect}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── 관심 키워드 목록 ───────────────────────────────────────────────── */}
      {!isLoading && (
        <div style={{ padding: '0 24px 24px' }}>
          <hr
            style={{
              border: 'none',
              borderTop: `1px solid ${C.border}`,
              marginBottom: '20px',
            }}
          />
          <NicheWatchlist />
        </div>
      )}

      {/* ── 페이지네이션 ───────────────────────────────────────────────────── */}
      {!isLoading && totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            padding: '16px 24px',
            borderTop: `1px solid ${C.border}`,
            backgroundColor: C.card,
          }}
        >
          {/* 이전 */}
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '6px 10px',
              border: `1px solid ${C.border}`,
              borderRadius: '6px',
              background: C.card,
              color: page <= 1 ? C.textSub : C.text,
              cursor: page <= 1 ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              opacity: page <= 1 ? 0.5 : 1,
            }}
          >
            <ChevronLeft size={14} />
          </button>

          {/* 페이지 번호 */}
          {Array.from({ length: Math.min(7, totalPages) }).map((_, i) => {
            let pageNum: number;
            if (totalPages <= 7) {
              pageNum = i + 1;
            } else if (page <= 4) {
              pageNum = i + 1;
            } else if (page >= totalPages - 3) {
              pageNum = totalPages - 6 + i;
            } else {
              pageNum = page - 3 + i;
            }

            const isActive = pageNum === page;

            return (
              <button
                key={pageNum}
                onClick={() => setPage(pageNum)}
                style={{
                  width: '32px',
                  height: '32px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `1px solid ${isActive ? C.accent : C.border}`,
                  borderRadius: '6px',
                  background: isActive ? 'rgba(190, 0, 20, 0.08)' : C.card,
                  color: isActive ? C.accent : C.text,
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: isActive ? 700 : 500,
                }}
              >
                {pageNum}
              </button>
            );
          })}

          {/* 다음 */}
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '6px 10px',
              border: `1px solid ${C.border}`,
              borderRadius: '6px',
              background: C.card,
              color: page >= totalPages ? C.textSub : C.text,
              cursor: page >= totalPages ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              opacity: page >= totalPages ? 0.5 : 1,
            }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* 스피너 / 펄스 keyframe */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
