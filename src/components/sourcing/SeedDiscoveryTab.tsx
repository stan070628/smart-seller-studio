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
          <button onClick={reset} style={{ padding: '5px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, fontSize: 11, cursor: 'pointer', color: C.text }}>초기화</button>
          <button onClick={() => reset()} style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: C.seedAccent, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>+ 새 발굴 세션</button>
        </div>
      </div>

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
