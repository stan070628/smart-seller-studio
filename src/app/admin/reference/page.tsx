'use client';

import { useState } from 'react';
import ReferenceInputPanel from '@/components/admin/ReferenceInputPanel';
import AnalysisResultPanel from '@/components/admin/AnalysisResultPanel';

// 13개 메인 프레임 타입 목록
const ALL_FRAME_TYPES = [
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

export default function AdminReferencePage() {
  // 입력 상태
  const [adminSecret, setAdminSecret] = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([
    ...ALL_FRAME_TYPES,
  ]);

  // 분석 상태
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisData | null>(null);

  // 승인 맵 상태
  const [approvalMap, setApprovalMap] = useState<Record<string, boolean>>({});

  // 반영 상태
  const [isApplying, setIsApplying] = useState(false);
  const [applyResults, setApplyResults] = useState<ApplyResult[] | null>(null);

  // 에러 상태
  const [error, setError] = useState<string | null>(null);

  // 템플릿 토글 핸들러
  const handleTemplateToggle = (frameType: string) => {
    setSelectedTemplates((prev) =>
      prev.includes(frameType)
        ? prev.filter((t) => t !== frameType)
        : [...prev, frameType]
    );
  };

  // 전체 선택 핸들러
  const handleSelectAll = () => {
    setSelectedTemplates([...ALL_FRAME_TYPES]);
  };

  // 전체 해제 핸들러
  const handleDeselectAll = () => {
    setSelectedTemplates([]);
  };

  // 승인 토글 핸들러
  const handleApprovalToggle = (frameType: string) => {
    setApprovalMap((prev) => ({
      ...prev,
      [frameType]: !prev[frameType],
    }));
  };

  /**
   * 레퍼런스 분석 요청
   * POST /api/admin/analyze-reference
   */
  const handleAnalyze = async () => {
    setError(null);
    setAnalysisResult(null);
    setApplyResults(null);
    setIsAnalyzing(true);

    try {
      const response = await fetch('/api/admin/analyze-reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminSecret,
          referenceUrl,
          selectedTemplates,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body?.error ?? `요청 실패 (HTTP ${response.status})`
        );
      }

      const data: AnalysisData = await response.json();
      setAnalysisResult(data);

      // 모든 제안을 기본 승인 상태로 초기화
      const initialApprovalMap: Record<string, boolean> = {};
      data.templateProposals.forEach((p) => {
        initialApprovalMap[p.frameType] = true;
      });
      setApprovalMap(initialApprovalMap);
    } catch (err) {
      const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
      setError(message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  /**
   * 승인된 템플릿만 실제 파일에 반영
   * POST /api/admin/apply-template
   */
  const handleApply = async () => {
    if (!analysisResult) return;

    // 승인된 frameType 목록 추출
    const approvedFrameTypes = Object.entries(approvalMap)
      .filter(([, approved]) => approved)
      .map(([frameType]) => frameType);

    if (approvedFrameTypes.length === 0) return;

    setError(null);
    setApplyResults(null);
    setIsApplying(true);

    try {
      const response = await fetch('/api/admin/apply-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminSecret,
          approvedFrameTypes,
          templateProposals: analysisResult.templateProposals.filter((p) =>
            approvedFrameTypes.includes(p.frameType)
          ),
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body?.error ?? `반영 요청 실패 (HTTP ${response.status})`
        );
      }

      const data: { results: ApplyResult[] } = await response.json();
      setApplyResults(data.results);
    } catch (err) {
      const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
      setError(message);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#09090b',
        color: '#f4f4f5',
        fontFamily:
          '"Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {/* 상단 헤더 */}
      <header
        style={{
          borderBottom: '1px solid #27272a',
          backgroundColor: '#18181b',
          padding: '0 32px',
          height: '56px',
          display: 'flex',
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: '16px',
            fontWeight: 700,
            letterSpacing: '-0.02em',
          }}
        >
          레퍼런스 학습 관리자
        </h1>
      </header>

      {/* 메인 콘텐츠 */}
      <main
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: '32px',
        }}
      >
        {/* 에러 메시지 */}
        {error && (
          <div
            style={{
              marginBottom: '24px',
              padding: '14px 18px',
              borderRadius: '9px',
              backgroundColor: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.25)',
              color: '#fca5a5',
              fontSize: '13px',
              lineHeight: 1.6,
            }}
          >
            <strong style={{ marginRight: '6px' }}>오류:</strong>
            {error}
          </div>
        )}

        {/* 3단 레이아웃: 좌측 입력 패널 + 우측 결과 패널 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: analysisResult
              ? '380px 1fr'
              : '480px',
            gap: '24px',
            alignItems: 'start',
          }}
        >
          {/* 좌측: 입력 패널 */}
          <ReferenceInputPanel
            adminSecret={adminSecret}
            onAdminSecretChange={setAdminSecret}
            referenceUrl={referenceUrl}
            onUrlChange={setReferenceUrl}
            selectedTemplates={selectedTemplates}
            onTemplateToggle={handleTemplateToggle}
            onSelectAll={handleSelectAll}
            onDeselectAll={handleDeselectAll}
            isAnalyzing={isAnalyzing}
            onAnalyze={handleAnalyze}
          />

          {/* 우측: 분석 결과 패널 (결과 있을 때만 표시) */}
          {analysisResult && (
            <AnalysisResultPanel
              analysisResult={analysisResult}
              approvalMap={approvalMap}
              onApprovalToggle={handleApprovalToggle}
              isApplying={isApplying}
              onApply={handleApply}
              applyResults={applyResults}
            />
          )}
        </div>
      </main>
    </div>
  );
}
