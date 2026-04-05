'use client';

import { Loader2, Check, X } from 'lucide-react';
import TemplateDiffViewer from './TemplateDiffViewer';

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

interface TemplateProposal {
  frameType: string;
  templateFileName: string;
  currentCode: string;
  proposedCode: string;
  changeSummary: string;
  diffHighlights: { lineRange: string; description: string }[];
}

interface ApplyResult {
  frameType: string;
  status: 'applied' | 'failed';
  backupPath?: string;
  error?: string;
}

interface AnalysisData {
  referenceAnalysis: {
    layoutStyle: string;
    colorPalette: string[];
    typographyNotes: string;
    compositionNotes: string;
  };
  templateProposals: TemplateProposal[];
}

interface AnalysisResultPanelProps {
  analysisResult: AnalysisData;
  approvalMap: Record<string, boolean>;
  onApprovalToggle: (frameType: string) => void;
  isApplying: boolean;
  onApply: () => void;
  applyResults: ApplyResult[] | null;
}

export default function AnalysisResultPanel({
  analysisResult,
  approvalMap,
  onApprovalToggle,
  isApplying,
  onApply,
  applyResults,
}: AnalysisResultPanelProps) {
  const { referenceAnalysis, templateProposals } = analysisResult;

  // 승인된 항목 수 계산
  const approvedCount = Object.values(approvalMap).filter(Boolean).length;
  const totalCount = templateProposals.length;
  const canApply = approvedCount > 0 && !isApplying;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}
    >
      {/* 레퍼런스 분석 요약 카드 */}
      <div
        style={{
          backgroundColor: '#18181b',
          border: '1px solid #27272a',
          borderRadius: '12px',
          padding: '20px',
        }}
      >
        <h2
          style={{
            margin: '0 0 16px 0',
            fontSize: '15px',
            fontWeight: 700,
            color: '#f4f4f5',
          }}
        >
          레퍼런스 분석 요약
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* 컬러 팔레트 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '12px', fontWeight: 500, color: '#71717a' }}>
              컬러 팔레트
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {referenceAnalysis.colorPalette.map((hex, idx) => (
                <div
                  key={idx}
                  title={hex}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  {/* 색상 칩 */}
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '5px',
                      backgroundColor: hex,
                      border: '1px solid rgba(255,255,255,0.1)',
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: '11px',
                      color: '#71717a',
                      fontFamily: 'monospace',
                    }}
                  >
                    {hex}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 레이아웃 스타일 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '12px', fontWeight: 500, color: '#71717a' }}>
              레이아웃 스타일
            </span>
            <p style={{ margin: 0, fontSize: '13px', color: '#a1a1aa', lineHeight: 1.6 }}>
              {referenceAnalysis.layoutStyle}
            </p>
          </div>

          {/* 타이포그래피 노트 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '12px', fontWeight: 500, color: '#71717a' }}>
              타이포그래피
            </span>
            <p style={{ margin: 0, fontSize: '13px', color: '#a1a1aa', lineHeight: 1.6 }}>
              {referenceAnalysis.typographyNotes}
            </p>
          </div>

          {/* 구성 노트 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '12px', fontWeight: 500, color: '#71717a' }}>
              구성 / 컴포지션
            </span>
            <p style={{ margin: 0, fontSize: '13px', color: '#a1a1aa', lineHeight: 1.6 }}>
              {referenceAnalysis.compositionNotes}
            </p>
          </div>
        </div>
      </div>

      {/* 반영 액션 영역 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#18181b',
          border: '1px solid #27272a',
          borderRadius: '10px',
          padding: '14px 18px',
        }}
      >
        {/* 승인 수 표시 */}
        <span style={{ fontSize: '14px', color: '#a1a1aa' }}>
          승인된 항목:{' '}
          <strong style={{ color: approvedCount > 0 ? '#6366f1' : '#52525b' }}>
            {approvedCount}
          </strong>
          <span style={{ color: '#52525b' }}> / {totalCount}</span>
        </span>

        {/* 최종 반영 버튼 */}
        <button
          onClick={onApply}
          disabled={!canApply}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 20px',
            borderRadius: '8px',
            border: 'none',
            fontSize: '13px',
            fontWeight: 700,
            cursor: canApply ? 'pointer' : 'not-allowed',
            backgroundColor: canApply ? '#6366f1' : '#27272a',
            color: canApply ? '#ffffff' : '#52525b',
            transition: 'background-color 0.2s',
            letterSpacing: '0.01em',
          }}
          onMouseEnter={(e) => {
            if (canApply) e.currentTarget.style.backgroundColor = '#4f46e5';
          }}
          onMouseLeave={(e) => {
            if (canApply) e.currentTarget.style.backgroundColor = '#6366f1';
          }}
        >
          {isApplying ? (
            <>
              <Loader2
                size={14}
                style={{ animation: 'spin 1s linear infinite' }}
              />
              반영 중...
            </>
          ) : (
            `최종 반영 (${approvedCount}개)`
          )}
        </button>
      </div>

      {/* 반영 결과 패널 */}
      {applyResults && applyResults.length > 0 && (
        <div
          style={{
            backgroundColor: '#18181b',
            border: '1px solid #27272a',
            borderRadius: '10px',
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <h3
            style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 700, color: '#f4f4f5' }}
          >
            반영 결과
          </h3>
          {applyResults.map((result) => {
            const isOk = result.status === 'applied';
            return (
              <div
                key={result.frameType}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '10px 12px',
                  borderRadius: '7px',
                  backgroundColor: isOk
                    ? 'rgba(16,185,129,0.07)'
                    : 'rgba(239,68,68,0.07)',
                  border: `1px solid ${isOk ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
                }}
              >
                {/* 상태 아이콘 */}
                <div
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    backgroundColor: isOk ? '#10b981' : '#ef4444',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: '1px',
                  }}
                >
                  {isOk ? (
                    <Check size={11} color="white" />
                  ) : (
                    <X size={11} color="white" />
                  )}
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#f4f4f5' }}>
                    {FRAME_LABELS[result.frameType] ?? result.frameType}
                  </span>
                  {isOk && result.backupPath && (
                    <span
                      style={{
                        fontSize: '11px',
                        color: '#10b981',
                        fontFamily: 'monospace',
                      }}
                    >
                      백업: {result.backupPath}
                    </span>
                  )}
                  {!isOk && result.error && (
                    <span style={{ fontSize: '11px', color: '#f87171' }}>
                      {result.error}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* templateProposals 목록 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h2
          style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#f4f4f5' }}
        >
          템플릿 변경 제안
        </h2>
        {templateProposals.map((proposal) => (
          <TemplateDiffViewer
            key={proposal.frameType}
            proposal={proposal}
            approved={approvalMap[proposal.frameType] ?? false}
            onToggle={() => onApprovalToggle(proposal.frameType)}
          />
        ))}
      </div>

      {/* 스피너 애니메이션 */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
