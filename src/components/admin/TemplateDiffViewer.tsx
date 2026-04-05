'use client';

import { useState } from 'react';
import { Check, X, ChevronDown, ChevronUp } from 'lucide-react';

// 프레임 타입별 한국어 레이블 매핑
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

interface TemplateProposal {
  frameType: string;
  templateFileName: string;
  currentCode: string;
  proposedCode: string;
  changeSummary: string;
  diffHighlights: { lineRange: string; description: string }[];
}

interface TemplateDiffViewerProps {
  proposal: TemplateProposal;
  approved: boolean;
  onToggle: () => void;
}

export default function TemplateDiffViewer({
  proposal,
  approved,
  onToggle,
}: TemplateDiffViewerProps) {
  // 코드 비교 뷰 펼침/접힘 상태
  const [codeExpanded, setCodeExpanded] = useState(false);

  const labelKo = FRAME_LABELS[proposal.frameType] ?? proposal.frameType;

  return (
    <div
      style={{
        backgroundColor: '#18181b',
        border: `1px solid ${approved ? '#4f46e5' : '#27272a'}`,
        borderRadius: '10px',
        overflow: 'hidden',
        transition: 'border-color 0.2s',
      }}
    >
      {/* 헤더 영역 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: '1px solid #27272a',
          backgroundColor: approved ? 'rgba(99,102,241,0.06)' : 'transparent',
        }}
      >
        {/* 프레임 이름 + 파일명 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              fontWeight: 600,
              fontSize: '14px',
              color: '#f4f4f5',
            }}
          >
            {labelKo}
          </span>
          <span
            style={{
              fontSize: '11px',
              color: '#71717a',
              fontFamily: 'monospace',
              backgroundColor: '#09090b',
              padding: '2px 7px',
              borderRadius: '4px',
              border: '1px solid #27272a',
            }}
          >
            {proposal.templateFileName}
          </span>
        </div>

        {/* 승인/거부 토글 버튼 */}
        <button
          onClick={onToggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 14px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            border: 'none',
            backgroundColor: approved ? '#6366f1' : '#3f3f46',
            color: approved ? '#ffffff' : '#a1a1aa',
            transition: 'background-color 0.2s, color 0.2s',
          }}
        >
          {approved ? (
            <>
              <Check size={14} />
              승인
            </>
          ) : (
            <>
              <X size={14} />
              거부
            </>
          )}
        </button>
      </div>

      {/* 변경 요약 */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #27272a' }}>
        <p
          style={{
            fontSize: '13px',
            color: '#a1a1aa',
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          {proposal.changeSummary}
        </p>
      </div>

      {/* diffHighlights 목록 */}
      {proposal.diffHighlights.length > 0 && (
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid #27272a',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          {proposal.diffHighlights.map((highlight, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                fontSize: '12px',
              }}
            >
              {/* 라인 범위 배지 */}
              <span
                style={{
                  flexShrink: 0,
                  fontFamily: 'monospace',
                  fontSize: '11px',
                  color: '#6366f1',
                  backgroundColor: 'rgba(99,102,241,0.12)',
                  padding: '1px 7px',
                  borderRadius: '4px',
                  whiteSpace: 'nowrap',
                }}
              >
                {highlight.lineRange}
              </span>
              {/* 설명 */}
              <span style={{ color: '#71717a', lineHeight: 1.5 }}>
                {highlight.description}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 코드 비교 뷰 토글 버튼 */}
      <button
        onClick={() => setCodeExpanded((prev) => !prev)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          padding: '9px 16px',
          backgroundColor: 'transparent',
          border: 'none',
          borderBottom: codeExpanded ? '1px solid #27272a' : 'none',
          cursor: 'pointer',
          fontSize: '12px',
          color: '#71717a',
          transition: 'color 0.15s',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = '#a1a1aa';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = '#71717a';
        }}
      >
        {codeExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {codeExpanded ? '코드 비교 접기' : '코드 비교 펼치기'}
      </button>

      {/* 코드 비교 패널 — 좌우 분할 */}
      {codeExpanded && (
        <div style={{ display: 'flex', height: '360px' }}>
          {/* 현재 코드 (좌) */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              borderRight: '1px solid #27272a',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '6px 12px',
                fontSize: '11px',
                color: '#71717a',
                backgroundColor: '#0a0a0f',
                borderBottom: '1px solid #27272a',
                fontWeight: 500,
                letterSpacing: '0.04em',
              }}
            >
              현재 코드
            </div>
            <pre
              style={{
                flex: 1,
                margin: 0,
                padding: '12px',
                overflow: 'auto',
                backgroundColor: '#0a0a0f',
                fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                fontSize: '11px',
                lineHeight: 1.65,
                color: '#a1a1aa',
                whiteSpace: 'pre',
              }}
            >
              {proposal.currentCode}
            </pre>
          </div>

          {/* 제안 코드 (우) */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '6px 12px',
                fontSize: '11px',
                color: '#10b981',
                backgroundColor: 'rgba(16,185,129,0.05)',
                borderBottom: '1px solid rgba(16,185,129,0.15)',
                fontWeight: 500,
                letterSpacing: '0.04em',
              }}
            >
              제안 코드
            </div>
            <pre
              style={{
                flex: 1,
                margin: 0,
                padding: '12px',
                overflow: 'auto',
                backgroundColor: 'rgba(16,185,129,0.05)',
                fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                fontSize: '11px',
                lineHeight: 1.65,
                color: '#d1fae5',
                whiteSpace: 'pre',
              }}
            >
              {proposal.proposedCode}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
