'use client';

import { Loader2 } from 'lucide-react';

// 13개 메인 프레임 타입 목록
const FRAME_TYPES = [
  'hero',
  'pain_point',
  'solution',
  'usp',
  'detail_1',
  'detail_2',
  'how_to_use',
  'before_after',
  'target',
  'spec',
  'faq',
  'social_proof',
  'cta',
] as const;

// 프레임 타입별 한국어 레이블
const FRAME_LABELS: Record<string, string> = {
  hero: '히어로',
  pain_point: '불편함 공감',
  solution: '해결책',
  usp: '차별점',
  detail_1: '상세1',
  detail_2: '상세2',
  how_to_use: '사용법',
  before_after: '비포애프터',
  target: '타겟',
  spec: '스펙',
  faq: 'FAQ',
  social_proof: '사회적 증거',
  cta: '구매유도',
};

interface ReferenceInputPanelProps {
  adminSecret: string;
  onAdminSecretChange: (v: string) => void;
  referenceUrl: string;
  onUrlChange: (v: string) => void;
  selectedTemplates: string[];
  onTemplateToggle: (t: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  isAnalyzing: boolean;
  onAnalyze: () => void;
}

export default function ReferenceInputPanel({
  adminSecret,
  onAdminSecretChange,
  referenceUrl,
  onUrlChange,
  selectedTemplates,
  onTemplateToggle,
  onSelectAll,
  onDeselectAll,
  isAnalyzing,
  onAnalyze,
}: ReferenceInputPanelProps) {
  // 분석 버튼 활성화 조건: 비밀번호·URL·템플릿 1개 이상 선택
  const canAnalyze =
    adminSecret.trim() !== '' &&
    referenceUrl.trim() !== '' &&
    selectedTemplates.length > 0 &&
    !isAnalyzing;

  return (
    <div
      style={{
        backgroundColor: '#18181b',
        border: '1px solid #27272a',
        borderRadius: '12px',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
      }}
    >
      {/* 패널 제목 */}
      <h2
        style={{
          margin: 0,
          fontSize: '16px',
          fontWeight: 700,
          color: '#f4f4f5',
          letterSpacing: '-0.01em',
        }}
      >
        학습 설정
      </h2>

      {/* 관리자 비밀번호 입력 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <label
          style={{ fontSize: '13px', fontWeight: 500, color: '#a1a1aa' }}
        >
          관리자 비밀번호
        </label>
        <input
          type="password"
          value={adminSecret}
          onChange={(e) => onAdminSecretChange(e.target.value)}
          placeholder="관리자 비밀번호 입력"
          style={{
            backgroundColor: '#09090b',
            border: '1px solid #27272a',
            borderRadius: '7px',
            padding: '10px 12px',
            fontSize: '14px',
            color: '#f4f4f5',
            outline: 'none',
            width: '100%',
            boxSizing: 'border-box',
            transition: 'border-color 0.15s',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = '#6366f1';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = '#27272a';
          }}
        />
      </div>

      {/* 레퍼런스 이미지 URL 입력 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <label
          style={{ fontSize: '13px', fontWeight: 500, color: '#a1a1aa' }}
        >
          레퍼런스 이미지 URL
        </label>
        <input
          type="url"
          value={referenceUrl}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder="https://..."
          style={{
            backgroundColor: '#09090b',
            border: '1px solid #27272a',
            borderRadius: '7px',
            padding: '10px 12px',
            fontSize: '14px',
            color: '#f4f4f5',
            outline: 'none',
            width: '100%',
            boxSizing: 'border-box',
            transition: 'border-color 0.15s',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = '#6366f1';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = '#27272a';
          }}
        />
      </div>

      {/* 템플릿 선택 섹션 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* 섹션 헤더 + 전체선택/해제 버튼 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <label
            style={{ fontSize: '13px', fontWeight: 500, color: '#a1a1aa' }}
          >
            적용할 템플릿 선택{' '}
            <span style={{ color: '#6366f1' }}>
              ({selectedTemplates.length}/{FRAME_TYPES.length})
            </span>
          </label>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={onSelectAll}
              style={{
                padding: '4px 10px',
                fontSize: '11px',
                fontWeight: 500,
                borderRadius: '5px',
                border: '1px solid #27272a',
                backgroundColor: 'transparent',
                color: '#a1a1aa',
                cursor: 'pointer',
                transition: 'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#6366f1';
                e.currentTarget.style.color = '#6366f1';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#27272a';
                e.currentTarget.style.color = '#a1a1aa';
              }}
            >
              전체선택
            </button>
            <button
              onClick={onDeselectAll}
              style={{
                padding: '4px 10px',
                fontSize: '11px',
                fontWeight: 500,
                borderRadius: '5px',
                border: '1px solid #27272a',
                backgroundColor: 'transparent',
                color: '#a1a1aa',
                cursor: 'pointer',
                transition: 'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#ef4444';
                e.currentTarget.style.color = '#ef4444';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#27272a';
                e.currentTarget.style.color = '#a1a1aa';
              }}
            >
              전체해제
            </button>
          </div>
        </div>

        {/* 3열 그리드 체크박스 목록 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '8px',
          }}
        >
          {FRAME_TYPES.map((frameType) => {
            const isSelected = selectedTemplates.includes(frameType);
            return (
              <label
                key={frameType}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 10px',
                  borderRadius: '7px',
                  border: `1px solid ${isSelected ? '#6366f1' : '#27272a'}`,
                  backgroundColor: isSelected
                    ? 'rgba(99,102,241,0.08)'
                    : '#09090b',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, background-color 0.15s',
                  userSelect: 'none',
                }}
              >
                {/* 커스텀 체크박스 */}
                <div
                  style={{
                    width: '15px',
                    height: '15px',
                    borderRadius: '4px',
                    border: `2px solid ${isSelected ? '#6366f1' : '#52525b'}`,
                    backgroundColor: isSelected ? '#6366f1' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'background-color 0.15s, border-color 0.15s',
                  }}
                >
                  {isSelected && (
                    <svg
                      width="9"
                      height="7"
                      viewBox="0 0 9 7"
                      fill="none"
                    >
                      <path
                        d="M1 3.5L3.5 6L8 1"
                        stroke="white"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onTemplateToggle(frameType)}
                  style={{ display: 'none' }}
                />
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: isSelected ? 600 : 400,
                    color: isSelected ? '#c7d2fe' : '#71717a',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {FRAME_LABELS[frameType]}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* 학습 시작 버튼 */}
      <button
        onClick={onAnalyze}
        disabled={!canAnalyze}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          width: '100%',
          padding: '12px 0',
          borderRadius: '8px',
          border: 'none',
          fontSize: '14px',
          fontWeight: 700,
          cursor: canAnalyze ? 'pointer' : 'not-allowed',
          backgroundColor: canAnalyze ? '#6366f1' : '#27272a',
          color: canAnalyze ? '#ffffff' : '#52525b',
          transition: 'background-color 0.2s, color 0.2s',
          letterSpacing: '0.01em',
        }}
        onMouseEnter={(e) => {
          if (canAnalyze) {
            e.currentTarget.style.backgroundColor = '#4f46e5';
          }
        }}
        onMouseLeave={(e) => {
          if (canAnalyze) {
            e.currentTarget.style.backgroundColor = '#6366f1';
          }
        }}
      >
        {isAnalyzing ? (
          <>
            <Loader2
              size={16}
              style={{ animation: 'spin 1s linear infinite' }}
            />
            분석 중...
          </>
        ) : (
          '학습 시작'
        )}
      </button>

      {/* Loader2 스핀 애니메이션 keyframes 인라인 주입 */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
