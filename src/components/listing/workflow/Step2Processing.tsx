'use client';

/**
 * Step2Processing.tsx
 * Step 2 — AI 생성 진행 상황 패널 + 병렬 입력 패널
 */

import React, { useEffect } from 'react';
import { CheckCircle, AlertTriangle, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';

// ─────────────────────────────────────────────────────────────────────────────
// 스타일 상수
// ─────────────────────────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  fontSize: '13px',
  border: `1px solid ${C.border}`,
  borderRadius: '8px',
  outline: 'none',
  color: C.text,
  backgroundColor: '#fff',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: C.textSub,
  marginBottom: '6px',
};

// ─────────────────────────────────────────────────────────────────────────────
// AI 단계 정의
// ─────────────────────────────────────────────────────────────────────────────
const AI_STEPS = [
  { label: '이미지 분석 중...', activeOn: 'analyzing' as const },
  { label: 'AI 카피 작성 중...', activeOn: 'generating' as const },
  { label: 'HTML 조립 중...', doneOn: 'done' as const },
];

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export default function Step2Processing() {
  const {
    sharedDraft,
    updateSharedDraft,
    goPrevStep,
    goNextStep,
    generateDetailPage,
    skipDetailPage,
  } = useListingStore();

  const { detailPageStatus, detailPageError, detailPageSkipped, rawImageFiles } = sharedDraft;

  // Step 진입 시 자동 생성 트리거
  useEffect(() => {
    if (rawImageFiles.length > 0 && detailPageStatus === 'idle') {
      generateDetailPage();
    } else if (rawImageFiles.length === 0 && !detailPageSkipped) {
      // 도매꾹 경로 — rawImageFiles 없으면 자동 스킵
      updateSharedDraft({ detailPageSkipped: true });
    }
    // rawImageFiles는 렌더 시마다 새 배열 참조가 생길 수 있어 length로만 비교
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 다음 단계 활성 조건
  const canProceed = detailPageStatus === 'done' || detailPageSkipped;

  // AI 단계별 상태 계산
  const getStepState = (index: number): 'done' | 'active' | 'idle' | 'error' => {
    if (detailPageStatus === 'error') return index === 0 ? 'error' : 'idle';
    if (detailPageStatus === 'done') return 'done';
    if (detailPageStatus === 'analyzing') {
      if (index === 0) return 'active';
      return 'idle';
    }
    if (detailPageStatus === 'generating') {
      if (index === 0) return 'done';
      if (index === 1) return 'active';
      return 'idle';
    }
    return 'idle';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* 2컬럼 레이아웃 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>

        {/* ── 좌측: AI 진행 상황 패널 ─────────────────────────────────────── */}
        <div
          style={{
            backgroundColor: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: '12px',
            padding: '24px',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 700, color: C.text, marginBottom: '4px' }}>
            AI 상세페이지 생성
          </div>

          {/* 도매꾹 경로 — 스킵 안내 */}
          {detailPageSkipped && rawImageFiles.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', gap: '12px', textAlign: 'center' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircle size={24} color="#15803d" />
              </div>
              <div>
                <p style={{ fontSize: '14px', fontWeight: 600, color: C.text, margin: '0 0 4px' }}>
                  도매꾹 상세페이지가 준비되었습니다.
                </p>
                <p style={{ fontSize: '12px', color: C.textSub, margin: 0 }}>
                  도매꾹 상품의 상세페이지를 사용합니다.
                  <br />
                  아래 &quot;결과 확인&quot; 버튼으로 다음 단계로 이동하세요.
                </p>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ fontSize: '12px', color: C.textSub, marginBottom: '4px' }}>
                업로드한 사진 {rawImageFiles.length}장을 분석해 HTML 상세페이지를 생성합니다.
              </div>

              {/* 진행 단계 목록 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {AI_STEPS.map((step, i) => {
                  const state = getStepState(i);
                  return (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        opacity: state === 'idle' ? 0.35 : 1,
                        transition: 'opacity 0.3s',
                      }}
                    >
                      {/* 아이콘 */}
                      <div
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          backgroundColor:
                            state === 'done' ? '#15803d' :
                            state === 'active' ? C.accent :
                            state === 'error' ? '#b91c1c' :
                            C.border,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          transition: 'background-color 0.3s',
                        }}
                      >
                        {state === 'done' && <CheckCircle size={14} color="#fff" />}
                        {state === 'active' && (
                          <div
                            style={{
                              width: '14px',
                              height: '14px',
                              border: '2px solid rgba(255,255,255,0.3)',
                              borderTopColor: '#fff',
                              borderRadius: '50%',
                              animation: 'spin 0.8s linear infinite',
                            }}
                          />
                        )}
                        {state === 'error' && <AlertTriangle size={12} color="#fff" />}
                        {state === 'idle' && (
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#fff', display: 'block' }} />
                        )}
                      </div>

                      {/* 레이블 */}
                      <span
                        style={{
                          fontSize: '13px',
                          fontWeight: state === 'active' ? 700 : 500,
                          color:
                            state === 'done' ? '#15803d' :
                            state === 'active' ? C.text :
                            state === 'error' ? '#b91c1c' :
                            C.textSub,
                          transition: 'color 0.3s',
                        }}
                      >
                        {state === 'done' ? step.label.replace(' 중...', ' 완료') : step.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* idle 상태 — 시작 버튼 */}
              {detailPageStatus === 'idle' && rawImageFiles.length > 0 && (
                <button
                  onClick={() => generateDetailPage()}
                  style={{
                    padding: '10px 20px',
                    fontSize: '13px',
                    fontWeight: 600,
                    backgroundColor: C.accent,
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    alignSelf: 'flex-start',
                  }}
                >
                  생성하기
                </button>
              )}

              {/* 완료 메시지 */}
              {detailPageStatus === 'done' && (
                <div style={{ padding: '12px', backgroundColor: '#dcfce7', border: '1px solid #86efac', borderRadius: '8px', fontSize: '12px', color: '#15803d', fontWeight: 600 }}>
                  상세페이지 생성이 완료되었습니다!
                </div>
              )}

              {/* 에러 */}
              {detailPageStatus === 'error' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', backgroundColor: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', color: '#b91c1c' }}>
                    <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                    {detailPageError ?? '생성 중 오류가 발생했습니다.'}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => {
                        updateSharedDraft({ detailPageStatus: 'idle', detailPageError: null });
                        generateDetailPage();
                      }}
                      style={{
                        padding: '6px 14px',
                        fontSize: '12px',
                        fontWeight: 600,
                        backgroundColor: C.accent,
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                      }}
                    >
                      재시도
                    </button>
                    <button
                      onClick={skipDetailPage}
                      style={{
                        padding: '6px 14px',
                        fontSize: '12px',
                        fontWeight: 600,
                        backgroundColor: '#fff',
                        color: C.textSub,
                        border: `1px solid ${C.border}`,
                        borderRadius: '6px',
                        cursor: 'pointer',
                      }}
                    >
                      건너뛰기
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 우측: 병렬 입력 패널 ────────────────────────────────────────── */}
        <div
          style={{
            backgroundColor: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: '12px',
            padding: '24px',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 700, color: C.text, marginBottom: '4px' }}>
            지금 미리 채워두세요
          </div>
          <div style={{ fontSize: '12px', color: C.textSub, marginBottom: '20px' }}>
            AI가 상세페이지를 만드는 동안 카테고리와 재고를 미리 입력해두세요.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* 쿠팡 카테고리 코드 */}
            <div>
              <label style={labelStyle}>쿠팡 카테고리 코드</label>
              <input
                style={inputStyle}
                type="number"
                placeholder="예: 15690227"
                onChange={() => {
                  // Step 3에서 BothRegisterForm으로 처리, 여기서는 안내만
                }}
              />
              <p style={{ fontSize: '11px', color: C.textSub, margin: '4px 0 0' }}>
                Step 3에서 카테고리 검색 기능으로 설정할 수 있습니다.
              </p>
            </div>

            {/* 네이버 카테고리 코드 */}
            <div>
              <label style={labelStyle}>네이버 카테고리 ID</label>
              <input
                style={inputStyle}
                type="text"
                placeholder="예: 50000008"
                onChange={() => {
                  // Step 3에서 BothRegisterForm으로 처리
                }}
              />
              <p style={{ fontSize: '11px', color: C.textSub, margin: '4px 0 0' }}>
                Step 3에서 카테고리 검색 기능으로 설정할 수 있습니다.
              </p>
            </div>

            {/* 재고 수량 */}
            <div>
              <label style={labelStyle}>재고 수량</label>
              <input
                style={inputStyle}
                type="number"
                value={sharedDraft.stock}
                onChange={(e) => updateSharedDraft({ stock: e.target.value })}
                min={0}
                placeholder="999"
              />
            </div>

            {/* 안내 박스 */}
            <div
              style={{
                padding: '12px 14px',
                backgroundColor: 'rgba(190,0,20,0.04)',
                border: '1px solid rgba(190,0,20,0.12)',
                borderRadius: '8px',
                fontSize: '12px',
                color: C.text,
                lineHeight: 1.6,
              }}
            >
              <strong style={{ color: C.accent }}>TIP</strong> 카테고리는 Step 3에서 키워드로 검색할 수 있습니다. AI가 완성되면 바로 등록할 수 있도록 미리 준비해두세요.
            </div>
          </div>
        </div>
      </div>

      {/* 하단 버튼 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          onClick={goPrevStep}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '10px 20px',
            fontSize: '13px',
            fontWeight: 600,
            backgroundColor: '#fff',
            color: C.textSub,
            border: `1px solid ${C.border}`,
            borderRadius: '8px',
            cursor: 'pointer',
          }}
        >
          <ChevronLeft size={15} />
          이전
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
          {!canProceed && (
            <p style={{ fontSize: '12px', color: C.textSub, margin: 0 }}>
              AI 생성이 완료되면 다음 단계로 이동할 수 있어요
            </p>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            {/* 생성 중이거나 에러면 건너뛰기 옵션 제공 */}
            {(detailPageStatus === 'analyzing' || detailPageStatus === 'generating' || detailPageStatus === 'error') && (
              <button
                onClick={skipDetailPage}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '10px 18px',
                  fontSize: '13px',
                  fontWeight: 600,
                  backgroundColor: '#fff',
                  color: C.textSub,
                  border: `1px solid ${C.border}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                }}
              >
                건너뛰기
              </button>
            )}
            <button
              onClick={goNextStep}
              disabled={!canProceed}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 24px',
                fontSize: '13px',
                fontWeight: 700,
                backgroundColor: canProceed ? C.accent : '#ccc',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: canProceed ? 'pointer' : 'not-allowed',
                transition: 'background-color 0.15s',
              }}
            >
              {canProceed ? (
                <>결과 확인 <ChevronRight size={15} /></>
              ) : (
                <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> 생성 중...</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
