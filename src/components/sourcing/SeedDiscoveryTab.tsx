'use client';

import React, { useEffect } from 'react';
import { useSeedDiscoveryStore } from '@/store/useSeedDiscoveryStore';
import { C as BASE_C } from '@/lib/design-tokens';
import type { SeedKeyword } from '@/types/sourcing';

const C = {
  ...BASE_C,
  seedAccent: '#7c3aed',
  seedLight:  '#ede9fe',
  seedBorder: '#a78bfa',
} as const;

const CATEGORIES = ['생활용품', '문구/사무', '반려동물', '차량용품', '가구/인테리어'] as const;

interface StepLabel {
  key: string;
  label: string;
  auto: boolean;
  stepNum: number; // 비교용 숫자 (Gate=0으로 처리)
  isGate?: boolean;
}

const STEP_LABELS: StepLabel[] = [
  { key: '1',  label: '카테고리 선택',    auto: false, stepNum: 1 },
  { key: 'G0', label: '회피 차단',        auto: true,  stepNum: 1, isGate: true },
  { key: '2',  label: '검색량·경쟁 분석', auto: true,  stepNum: 2 },
  { key: '3',  label: '쿠팡 리뷰 입력',  auto: false, stepNum: 3 },
  { key: '4',  label: '도매꾹 매칭·마진', auto: true,  stepNum: 4 },
  { key: 'G1', label: '마진 30% 필터',   auto: true,  stepNum: 4, isGate: true },
  { key: '5',  label: 'KIPRIS 상표권',   auto: true,  stepNum: 5 },
  { key: '6',  label: '시드 점수 산출',  auto: true,  stepNum: 6 },
  { key: '7',  label: '30개 확정',       auto: false, stepNum: 7 },
];

const GRADE_COLOR: Record<string, string> = {
  S: '#7c3aed', A: '#16a34a', B: '#2563eb', C: '#d97706', D: '#dc2626',
};

export default function SeedDiscoveryTab() {
  const {
    currentStep, sessions, sessionId, selectedCategories,
    keywords, isAnalyzing, isConfirming, error,
    setSelectedCategories, startAnalysis, loadSessions, reset,
  } = useSeedDiscoveryStore();

  const [showCriteria, setShowCriteria] = React.useState(false);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const pendingReview = keywords.filter((k) => !k.isBlocked && k.topReviewCount === null).length;
  const selectedCount = keywords.filter((k) => k.isSelected).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bg }}>

      {/* 헤더 */}
      <div style={{ padding: '12px 20px', background: C.card, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>🌱 시드 발굴</div>
          <div style={{ fontSize: 11, color: C.textSub }}>카테고리 선택 → 키워드 자동 분석 → 검증 → 30개 확정 → 도매꾹 탭으로 이동</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            onClick={() => setShowCriteria((v) => !v)}
            style={{
              padding: '5px 10px', borderRadius: 6,
              border: `1px solid ${showCriteria ? C.seedBorder : C.border}`,
              background: showCriteria ? C.seedLight : C.card,
              color: showCriteria ? C.seedAccent : C.text,
              fontSize: 11, fontWeight: showCriteria ? 700 : 500, cursor: 'pointer',
            }}
          >
            {showCriteria ? '▴ 기준 닫기' : 'ℹ️ 발굴 기준'}
          </button>
          <button onClick={reset} style={{ padding: '5px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, fontSize: 11, cursor: 'pointer', color: C.text }}>초기화</button>
          <button onClick={() => reset()} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: C.seedAccent, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>+ 새 발굴 세션</button>
        </div>
      </div>

      {showCriteria && <CriteriaPanel />}

      {/* 세션 이력 */}
      {sessions.length > 0 && (
        <div style={{ padding: '6px 20px', background: C.card, borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 6, alignItems: 'center', overflowX: 'auto' }}>
          <span style={{ fontSize: 10, color: C.textSub, fontWeight: 700, flexShrink: 0 }}>세션:</span>
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => useSeedDiscoveryStore.getState().loadSession(s.id)}
              style={{
                borderRadius: 5, padding: '2px 8px', fontSize: 10,
                fontWeight: s.id === sessionId ? 700 : 500,
                border: `1px solid ${s.id === sessionId ? C.seedBorder : C.border}`,
                background: s.id === sessionId ? C.seedLight : C.card,
                color: s.id === sessionId ? C.seedAccent : C.textSub,
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {s.status === 'confirmed' ? '✅' : '●'}{' '}
              {new Date(s.createdAt).toLocaleDateString('ko')} ({s.categories.join('·')})
            </button>
          ))}
        </div>
      )}

      {error && (
        <div style={{ padding: '8px 20px', background: '#fee2e2', color: '#dc2626', fontSize: 11, borderBottom: `1px solid #fca5a5` }}>
          ⚠️ {error}
        </div>
      )}

      {/* 메인 레이아웃 */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', flex: 1, overflow: 'hidden', minHeight: 0 }}>

        {/* 왼쪽: 진행 상태 패널 */}
        <div style={{ padding: 14, borderRight: `1px solid ${C.border}`, background: C.card, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textSub, marginBottom: 4 }}>진행 상태</div>
          {STEP_LABELS.map((s) => {
            const isDone = currentStep > s.stepNum;
            const isActive = !s.isGate && currentStep === s.stepNum;
            const isLocked = currentStep < s.stepNum;
            return (
              <div key={s.key} style={{
                borderRadius: 6, padding: '7px 10px',
                background: isDone ? '#f0fdf4' : isActive ? '#fffbeb' : '#f8fafc',
                border: `${isActive ? 2 : 1}px solid ${isDone ? '#bbf7d0' : isActive ? '#f59e0b' : C.border}`,
                opacity: isLocked ? 0.45 : 1,
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span>{isDone ? '✅' : isActive ? '▶' : s.isGate ? '🚫' : '🔒'}</span>
                  <span style={{ color: isDone ? '#16a34a' : isActive ? '#92400e' : s.isGate ? '#dc2626' : C.textSub }}>
                    {s.isGate ? `${s.key} ` : ''}{s.label}
                  </span>
                  <span style={{
                    background: s.auto ? '#dbeafe' : '#fef3c7',
                    color: s.auto ? '#1d4ed8' : '#92400e',
                    borderRadius: 3, padding: '0 4px', fontSize: 9, marginLeft: 'auto',
                  }}>
                    {s.auto ? '자동' : '입력'}
                  </span>
                </div>
                {isActive && s.key === '3' && pendingReview > 0 && (
                  <div style={{ fontSize: 9, color: '#f59e0b', marginTop: 2 }}>{pendingReview}개 미입력 → 다음 잠김</div>
                )}
              </div>
            );
          })}
        </div>

        {/* 오른쪽: 현재 단계 작업 영역 */}
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {currentStep === 1 && (
            <StepCategorySelect
              categories={selectedCategories}
              setCategories={setSelectedCategories}
              onStart={startAnalysis}
              isLoading={isAnalyzing}
            />
          )}
          {currentStep === 2 && (
            <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 20, height: 20, border: '2px solid #1d4ed8', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <span style={{ fontSize: 12, color: C.textSub }}>자동완성 확장 + 검색량 + 경쟁상품수 분석 중...</span>
            </div>
          )}
          {currentStep >= 3 && currentStep <= 5 && (
            <StepReviewInput keywords={keywords} pendingCount={pendingReview} />
          )}
          {currentStep === 6 && (
            <StepScoreResult keywords={keywords} />
          )}
          {currentStep === 7 && (
            <StepConfirm keywords={keywords} selectedCount={selectedCount} isConfirming={isConfirming} />
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Step 1: 카테고리 선택 ──────────────────────────────────────────────────
function StepCategorySelect({ categories, setCategories, onStart, isLoading }: {
  categories: string[];
  setCategories: (c: string[]) => void;
  onStart: () => void;
  isLoading: boolean;
}) {
  const toggle = (cat: string) =>
    setCategories(categories.includes(cat) ? categories.filter((c) => c !== cat) : [...categories, cat]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 10, color: '#374151' }}>카테고리 선택 후 시드 발굴 시작</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {CATEGORIES.map((cat) => {
          const on = categories.includes(cat);
          return (
            <label
              key={cat}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                background: on ? '#fff' : '#f3f4f6',
                border: `1px solid ${on ? '#3b82f6' : '#e5e7eb'}`,
                borderRadius: 5, padding: '4px 10px', cursor: 'pointer',
                fontSize: 11, fontWeight: on ? 700 : 500,
                color: on ? '#1d4ed8' : '#374151',
              }}
            >
              <input type="checkbox" checked={on} onChange={() => toggle(cat)} style={{ accentColor: '#1d4ed8' }} />
              {cat}
            </label>
          );
        })}
      </div>
      <button
        onClick={onStart}
        disabled={categories.length === 0 || isLoading}
        style={{
          padding: '7px 18px', borderRadius: 6, border: 'none',
          background: categories.length === 0 || isLoading ? '#e5e7eb' : '#1d4ed8',
          color: '#fff', fontSize: 12, fontWeight: 700,
          cursor: categories.length === 0 || isLoading ? 'not-allowed' : 'pointer',
        }}
      >
        {isLoading ? '분석 중...' : '▶ 시드 발굴 시작'}
      </button>
    </div>
  );
}

// ── Step 3: 쿠팡 리뷰 입력 ────────────────────────────────────────────────
function StepReviewInput({ keywords, pendingCount }: {
  keywords: SeedKeyword[];
  pendingCount: number;
}) {
  const { setTopReviewCount, calcAllScores } = useSeedDiscoveryStore();
  const canProceed = pendingCount === 0 && keywords.some((k) => !k.isBlocked);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ padding: '8px 14px', background: '#fffbeb', borderBottom: '2px solid #f59e0b', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#92400e' }}>✏️ 쿠팡에서 상위 리뷰수 직접 확인 후 입력 (스킵 불가)</span>
        {pendingCount > 0 && (
          <span style={{ background: '#fde68a', color: '#92400e', borderRadius: 8, padding: '1px 7px', fontSize: 10, fontWeight: 700 }}>{pendingCount}개 미입력</span>
        )}
        <button
          onClick={() => {
            keywords
              .filter((k) => k.topReviewCount === null && !k.isBlocked)
              .forEach((k) => window.open(`https://www.coupang.com/np/search?q=${encodeURIComponent(k.keyword)}`, '_blank'));
          }}
          style={{ marginLeft: 'auto', background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 5, padding: '3px 8px', fontSize: 10, color: '#92400e', cursor: 'pointer' }}
        >
          미입력 {pendingCount}개 쿠팡 일괄 열기↗
        </button>
      </div>

      {!canProceed && (
        <div style={{ padding: '6px 14px', background: '#fff5f5', borderBottom: '1px solid #fca5a5', fontSize: 10, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 6 }}>
          🔒 미입력 {pendingCount}개 완료 전까지 다음 단계 잠김
        </div>
      )}

      <div style={{ overflowX: 'auto', flex: 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
              <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 700, color: '#64748b', fontSize: 10 }}>키워드</th>
              <th style={{ padding: '6px 6px', textAlign: 'right', fontWeight: 700, color: '#1d4ed8', fontSize: 10, background: '#f0f7ff' }}>월검색량<br /><span style={{ fontWeight: 400, fontSize: 9 }}>🤖자동</span></th>
              <th style={{ padding: '6px 6px', textAlign: 'right', fontWeight: 700, color: '#1d4ed8', fontSize: 10, background: '#f0f7ff' }}>경쟁상품<br /><span style={{ fontWeight: 400, fontSize: 9 }}>🤖자동</span></th>
              <th style={{ padding: '6px 6px', textAlign: 'center', fontWeight: 700, color: '#92400e', fontSize: 10, background: '#fffbeb', borderLeft: '2px solid #f59e0b' }}>쿠팡 상위리뷰<br /><span style={{ fontWeight: 400, fontSize: 9 }}>✏️ 직접 입력</span></th>
            </tr>
          </thead>
          <tbody>
            {keywords.map((k) => (
              <tr key={k.keyword} style={{ borderBottom: '1px solid #f1f5f9', background: k.isBlocked ? '#fef2f2' : '#fff', opacity: k.isBlocked ? 0.6 : 1 }}>
                <td style={{ padding: '5px 8px' }}>
                  <div style={{ fontWeight: 600 }}>{k.keyword}</div>
                  {k.isBlocked && <div style={{ fontSize: 9, color: '#dc2626' }}>{k.blockedReason}</div>}
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'right', color: '#059669', fontWeight: 600, background: '#f8fbff' }}>
                  {k.searchVolume.toLocaleString()}
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'right', color: '#059669', fontWeight: 600, background: '#f8fbff' }}>
                  {k.competitorCount}
                </td>
                <td style={{ padding: '5px 6px', textAlign: 'center', background: k.isBlocked ? '#fee2e2' : '#fffdf0', borderLeft: '2px solid #f59e0b' }}>
                  {k.isBlocked ? (
                    <span style={{ color: '#dc2626', fontWeight: 700 }}>{k.topReviewCount} ❌</span>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                      <input
                        type="number" min={0}
                        value={k.topReviewCount ?? ''}
                        onChange={(e) => setTopReviewCount(k.keyword, Number(e.target.value))}
                        placeholder="—"
                        style={{
                          width: 44, padding: '2px 4px', textAlign: 'center',
                          border: `1px solid ${k.topReviewCount === null ? '#f59e0b' : '#d1d5db'}`,
                          borderRadius: 4, fontSize: 11,
                          background: k.topReviewCount === null ? '#fffbeb' : '#fff',
                        }}
                      />
                      <a
                        href={`https://www.coupang.com/np/search?q=${encodeURIComponent(k.keyword)}`}
                        target="_blank" rel="noreferrer"
                        style={{ color: '#1d4ed8', fontSize: 10 }}
                      >
                        쿠팡↗
                      </a>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ padding: '10px 14px', background: '#f9fafb', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={calcAllScores}
          disabled={!canProceed}
          style={{
            padding: '6px 14px', borderRadius: 6, border: 'none',
            background: canProceed ? '#7c3aed' : '#e5e7eb',
            color: '#fff', fontSize: 11, fontWeight: 700,
            cursor: canProceed ? 'pointer' : 'not-allowed',
            opacity: canProceed ? 1 : 0.5,
          }}
        >
          {canProceed ? '🎯 시드 점수 산출 →' : `🔒 ${pendingCount}개 미입력`}
        </button>
      </div>
    </div>
  );
}

// ── Step 6: 점수 결과 ────────────────────────────────────────────────────
function StepScoreResult({ keywords }: { keywords: SeedKeyword[] }) {
  const { toggleKeywordSelect, confirmSelection } = useSeedDiscoveryStore();
  const scored = [...keywords]
    .filter((k) => k.seedScore !== null && !k.isBlocked)
    .sort((a, b) => (b.seedScore ?? 0) - (a.seedScore ?? 0));
  const selectedCount = keywords.filter((k) => k.isSelected).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ padding: '8px 14px', background: '#faf5ff', borderBottom: '1px solid #e9d5ff', fontSize: 11, fontWeight: 700, color: '#7c3aed' }}>
        🎯 시드 점수 산출 완료 — 경쟁(30·노출가능성 기반)+검색량(25)+리뷰(25)+마진(20) | 선택됨: {selectedCount}개
      </div>
      <div style={{ padding: 12, flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {scored.map((k, i) => {
          const ratio = k.competitorCount > 0 ? (k.searchVolume / k.competitorCount) * 1000 : 0;
          return (
          <div
            key={k.keyword}
            onClick={() => toggleKeywordSelect(k.keyword)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
              background: k.isSelected ? '#f5f0ff' : '#f9fafb',
              border: `1px solid ${k.isSelected ? '#a78bfa' : '#e2e8f0'}`,
            }}
          >
            <input type="checkbox" checked={k.isSelected} onChange={() => {}} style={{ accentColor: '#7c3aed' }} />
            <span style={{ fontSize: 10, color: '#94a3b8', width: 18 }}>{i + 1}</span>
            <span style={{ fontWeight: 600, flex: 1, fontSize: 11 }}>{k.keyword}</span>
            <span style={{ fontSize: 10, color: '#6b7280', width: 70, textAlign: 'right' }} title="월 검색량">
              {k.searchVolume.toLocaleString()}
            </span>
            <span style={{ fontSize: 10, color: '#9ca3af', width: 90, textAlign: 'right' }} title="네이버 쇼핑 경쟁상품수">
              경쟁 {k.competitorCount.toLocaleString()}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#0891b2', width: 70, textAlign: 'right' }} title="검색량/경쟁수×1000 — 높을수록 노출 기회 큼">
              노출 {ratio.toFixed(1)}
            </span>
            {k.compIdx && (
              <span style={{
                fontSize: 9, fontWeight: 700, borderRadius: 3, padding: '1px 6px', width: 50, textAlign: 'center',
                background: k.compIdx === '낮음' ? '#dcfce7' : k.compIdx === '높음' ? '#fee2e2' : '#fef3c7',
                color: k.compIdx === '낮음' ? '#15803d' : k.compIdx === '높음' ? '#b91c1c' : '#92400e',
              }} title="네이버 광고 경쟁강도">
                {k.compIdx}
              </span>
            )}
            {k.avgCtr !== null && (
              <span style={{
                fontSize: 10, color: k.avgCtr < 1 ? '#dc2626' : '#059669', width: 60, textAlign: 'right', fontWeight: 600,
              }} title="평균 CTR — 1% 미만은 정보검색성(구매 의도 약함) → 검색량 점수 50% 감점">
                CTR {k.avgCtr.toFixed(1)}%
              </span>
            )}
            <span style={{ fontSize: 14, fontWeight: 700, color: GRADE_COLOR[k.seedGrade ?? 'D'], width: 32, textAlign: 'right' }}>
              {k.seedScore}
            </span>
            <span style={{
              fontSize: 9, fontWeight: 700, borderRadius: 3, padding: '1px 5px',
              background: `${GRADE_COLOR[k.seedGrade ?? 'D']}18`,
              color: GRADE_COLOR[k.seedGrade ?? 'D'],
            }}>
              {k.seedGrade}
            </span>
          </div>
          );
        })}
      </div>
      <div style={{ padding: '10px 14px', background: '#f9fafb', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#64748b' }}>
          총 {scored.length}개 · {selectedCount}개 선택됨
        </span>
        <button
          onClick={() => confirmSelection()}
          disabled={selectedCount === 0}
          style={{
            padding: '6px 14px', borderRadius: 6, border: 'none',
            background: selectedCount === 0 ? '#e5e7eb' : '#be0014',
            color: '#fff', fontSize: 11, fontWeight: 700,
            cursor: selectedCount === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          선택 {selectedCount}개 도매꾹 탭에 추가 →
        </button>
      </div>
    </div>
  );
}

// ── Step 7: 완료 ──────────────────────────────────────────────────────────
function StepConfirm({ keywords, selectedCount, isConfirming }: {
  keywords: SeedKeyword[];
  selectedCount: number;
  isConfirming: boolean;
}) {
  const saved = keywords.filter((k) => k.isSelected && !k.isBlocked).length;

  return (
    <div style={{ padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#16a34a', marginBottom: 12 }}>
        ✅ 시드 발굴 완료 — {saved}개가 도매꾹 탭에 추가됐습니다
      </div>
      {isConfirming && (
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 10 }}>저장 중...</div>
      )}
      <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 6, padding: '10px 14px', fontSize: 10, color: '#92400e', lineHeight: 1.9 }}>
        <strong>다음 단계 →</strong> 위탁 등록 30~50개 → 2주 운영<br />
        위너 확정 기준: 클릭 100+, 전환율 1.5%+, ROAS 250%+, 판매 5건+, 별점 4.0+<br />
        → 위너 5~10개 확정 → 1688 사입 발주<br />
        <span style={{ color: '#6b7280', fontSize: 9 }}>이 플로우를 2~3회 반복하여 총 80~100 SKU 달성</span>
      </div>
      <div style={{ marginTop: 14, fontSize: 11, color: '#374151' }}>
        도매꾹 탭에서 <strong style={{ color: '#7c3aed' }}>🌱 시드만 보기</strong> 필터로 확인하세요.
      </div>
    </div>
  );
}

// ── 발굴 기준 패널 ────────────────────────────────────────────────────────
function CriteriaPanel() {
  const cell: React.CSSProperties = { padding: '6px 10px', borderBottom: `1px solid ${C.border}`, fontSize: 11, color: C.text };
  const head: React.CSSProperties = { ...cell, background: '#f8fafc', fontWeight: 700, color: '#475569', fontSize: 10 };
  return (
    <div style={{ padding: '14px 20px', background: '#fdfcff', borderBottom: `1px solid ${C.seedBorder}`, fontSize: 11, color: C.text }}>
      <div style={{ fontWeight: 700, marginBottom: 8, color: C.seedAccent, fontSize: 12 }}>📐 시드 발굴 기준 — 돈버는하마 채널 + 내부 보정</div>

      {/* 4단계 파이프라인 */}
      <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 6, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', marginBottom: 12 }}>
        <thead>
          <tr>
            <th style={{ ...head, width: 70, textAlign: 'left' }}>단계</th>
            <th style={{ ...head, textAlign: 'left' }}>기준</th>
            <th style={{ ...head, width: 220, textAlign: 'left' }}>출처/근거</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={cell}><strong>Gate 0</strong></td>
            <td style={cell}>시즌 키워드(크리스마스·설날·할로윈 등) 자동 차단</td>
            <td style={cell}>채널 — 회피 리스트</td>
          </tr>
          <tr>
            <td style={cell}><strong>자동완성</strong></td>
            <td style={cell}>시드별 네이버 자동완성 상위 5개 + 시드 자체 = 후보 풀</td>
            <td style={cell}>채널 — 롱테일 키워드 발굴</td>
          </tr>
          <tr>
            <td style={cell}><strong>검색량 필터</strong></td>
            <td style={cell}>월 검색량 <strong style={{ color: '#1d4ed8' }}>3,000 ~ 30,000</strong> 사이만 통과 (네이버 검색광고 API)</td>
            <td style={cell}>채널 — 검색량 가이드</td>
          </tr>
          <tr>
            <td style={cell}><strong>경쟁수 측정</strong></td>
            <td style={cell}>네이버 쇼핑 통합 카탈로그 검색 — 경쟁수 표시(필터링 X)</td>
            <td style={cell}>내부 — 채널의 &lt;500 기준이 쿠팡 단일 카탈로그 기준이라 통합 카탈로그 측정값엔 부적합 → hard 필터 제거</td>
          </tr>
          <tr>
            <td style={cell}><strong>리뷰 입력</strong></td>
            <td style={cell}>쿠팡 검색 시 상위 3개 상품 중 <strong>최대</strong> 리뷰수 입력. <strong style={{ color: '#dc2626' }}>50개 이상 자동 탈락</strong></td>
            <td style={cell}>채널 — &quot;초보가 소싱이 어려운 이유&quot;</td>
          </tr>
          <tr>
            <td style={cell}><strong>마진 게이트</strong></td>
            <td style={cell}>위탁 마진 <strong>30% 미만</strong> 자동 탈락. 1688 마진 40% 미만은 ⚠️ 경고만</td>
            <td style={cell}>채널 — 위탁 마진 가이드</td>
          </tr>
          <tr>
            <td style={cell}><strong>KIPRIS</strong></td>
            <td style={cell}>상표권 충돌 자동 검사 (선등록 상표 발견 시 경고)</td>
            <td style={{ ...cell, borderBottom: 'none' }}>내부 — 등록 차단 예방</td>
          </tr>
        </tbody>
      </table>

      {/* 점수 산식 */}
      <div style={{ background: '#fff', borderRadius: 6, padding: '10px 12px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
        <div style={{ fontWeight: 700, fontSize: 11, color: '#475569', marginBottom: 6 }}>🎯 시드 점수 산출 (총 100점)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontSize: 10 }}>
          <div style={{ padding: '8px', background: '#ecfeff', borderRadius: 5, border: '1px solid #a5f3fc' }}>
            <div style={{ fontWeight: 700, color: '#0891b2', marginBottom: 3 }}>경쟁 (30점)</div>
            <div style={{ color: '#475569', lineHeight: 1.5 }}>
              노출가능성 = (검색량 / 경쟁수) × 1000<br />
              ratio≥100 → 30점, 0~100 선형<br />
              <strong>+ 보정:</strong> compIdx 낮음 +5 / 높음 -5
            </div>
          </div>
          <div style={{ padding: '8px', background: '#eff6ff', borderRadius: 5, border: '1px solid #bfdbfe' }}>
            <div style={{ fontWeight: 700, color: '#1d4ed8', marginBottom: 3 }}>검색량 (25점)</div>
            <div style={{ color: '#475569', lineHeight: 1.5 }}>
              역U형 — 15,000 피크 25점<br />
              3,000 / 30,000 양 끝 12점<br />
              <strong>+ 보정:</strong> CTR &lt;1%면 50% 감점 (정보검색성)
            </div>
          </div>
          <div style={{ padding: '8px', background: '#fef3c7', borderRadius: 5, border: '1px solid #fde68a' }}>
            <div style={{ fontWeight: 700, color: '#b45309', marginBottom: 3 }}>리뷰 (25점)</div>
            <div style={{ color: '#475569', lineHeight: 1.5 }}>
              0개 → 25점, 50개 → 0점<br />
              선형 (50개 이상은 자동 탈락)
            </div>
          </div>
          <div style={{ padding: '8px', background: '#dcfce7', borderRadius: 5, border: '1px solid #bbf7d0' }}>
            <div style={{ fontWeight: 700, color: '#15803d', marginBottom: 3 }}>마진 (20점)</div>
            <div style={{ color: '#475569', lineHeight: 1.5 }}>
              30% → 0점, 60% → 20점<br />
              선형 (30% 미만은 자동 탈락)
            </div>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 10, color: '#64748b' }}>
          등급: <strong>S</strong> 85+ · <strong>A</strong> 70+ · <strong>B</strong> 55+ · <strong>C</strong> 40+ · <strong>D</strong> 39 이하
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: '#64748b', lineHeight: 1.6 }}>
        💡 <strong>다음 단계 (시드 → 위너):</strong> 발굴된 30개 시드를 위탁으로 등록 → 2주 운영 → 위너 확정 기준
        (클릭 100+, 전환율 1.5%+, ROAS 250%+, 판매 5건+, 별점 4.0+) 충족 5~10개를 1688 사입으로 전환.
      </div>
    </div>
  );
}
