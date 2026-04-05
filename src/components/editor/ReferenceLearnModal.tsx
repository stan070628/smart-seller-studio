'use client';

/**
 * ReferenceLearnModal.tsx
 * 레퍼런스 학습 기능의 전체 화면 오버레이 모달
 * 3단계(input → result → history)로 구성
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Upload,
  Check,
  Loader2,
  ChevronLeft,
  History,
} from 'lucide-react';

// ─────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────

interface TemplateProposal {
  frameType: string;
  templateFileName: string;
  currentCode: string;
  proposedCode: string;
  changeSummary: string;
  diffHighlights: { lineRange: string; description: string }[];
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

interface VersionRecord {
  id: string;
  createdAt: string;
  referenceSource: string;
  frameType: string;
  versionNumber: number;
  changeSummary: string | null;
  isCurrent: boolean;
}

// ─────────────────────────────────────────────
// 상수: 13개 프레임 레이블
// ─────────────────────────────────────────────

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

const ALL_FRAME_KEYS = Object.keys(FRAME_LABELS);

// ─────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────

interface ReferenceLearnModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// ─────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────

const ReferenceLearnModal: React.FC<ReferenceLearnModalProps> = ({
  isOpen,
  onClose,
}) => {
  // ── 단계 상태 ──
  const [step, setStep] = useState<'input' | 'result' | 'history'>('input');

  // ── 입력 단계 상태 ──
  const [srcMode, setSrcMode] = useState<'url' | 'file'>('url');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [fileMime, setFileMime] = useState<string>('image/jpeg');
  const [fileName, setFileName] = useState<string>('');
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── 결과 단계 상태 ──
  const [analysisResult, setAnalysisResult] = useState<AnalysisData | null>(null);
  const [approvalMap, setApprovalMap] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<string>('');
  const [isApplying, setIsApplying] = useState(false);
  const [applyDone, setApplyDone] = useState(false);

  // ── 이력 단계 상태 ──
  const [historyFilter, setHistoryFilter] = useState<string>('');
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);

  // ── 드래그앤드롭 상태 ──
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // ── 파일 input ref ──
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 토스트 상태 ──
  const [toast, setToast] = useState<string | null>(null);

  // ─────────────────────────────────────────────
  // ESC 키 닫기
  // ─────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // ─────────────────────────────────────────────
  // 모달 닫힐 때 상태 초기화
  // ─────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      setStep('input');
      setError(null);
      setApplyDone(false);
    }
  }, [isOpen]);

  // ─────────────────────────────────────────────
  // 버전 이력 불러오기
  // ─────────────────────────────────────────────
  const fetchVersions = useCallback(async (frameType: string) => {
    setIsLoadingVersions(true);
    try {
      const url = frameType
        ? `/api/admin/versions?frameType=${encodeURIComponent(frameType)}`
        : '/api/admin/versions';
      const res = await fetch(url);
      if (!res.ok) throw new Error('버전 이력을 불러오지 못했습니다.');
      const data = await res.json();
      setVersions(data.versions ?? []);
    } catch (err) {
      setVersions([]);
    } finally {
      setIsLoadingVersions(false);
    }
  }, []);

  useEffect(() => {
    if (step === 'history') {
      fetchVersions(historyFilter);
    }
  }, [step, historyFilter, fetchVersions]);

  // ─────────────────────────────────────────────
  // 파일 처리 (FileReader → base64)
  // ─────────────────────────────────────────────
  const handleFileSelect = (file: File) => {
    setFileMime(file.type || 'image/jpeg');
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result === 'string') {
        setFileBase64(result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      handleFileSelect(file);
    }
  };

  // ─────────────────────────────────────────────
  // 템플릿 선택/해제
  // ─────────────────────────────────────────────
  const toggleTemplate = (key: string) => {
    setSelectedTemplates((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const selectAll = () => setSelectedTemplates([...ALL_FRAME_KEYS]);
  const deselectAll = () => setSelectedTemplates([]);

  // ─────────────────────────────────────────────
  // 학습 시작 (분석 요청)
  // ─────────────────────────────────────────────
  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const body =
        srcMode === 'url'
          ? {
              referenceImageUrl: referenceUrl,
              referenceSource: referenceUrl,
              targetTemplates: selectedTemplates,
            }
          : {
              referenceImageBase64: fileBase64,
              referenceImageMimeType: fileMime,
              referenceSource: fileName,
              targetTemplates: selectedTemplates,
            };

      const res = await fetch('/api/admin/analyze-reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error ?? '분석 중 오류가 발생했습니다.');
      }

      const data: AnalysisData = await res.json();
      setAnalysisResult(data);

      // 승인 맵 전부 true로 초기화
      const initMap: Record<string, boolean> = {};
      data.templateProposals.forEach((p) => {
        initMap[p.frameType] = true;
      });
      setApprovalMap(initMap);

      // 첫 번째 탭 활성화
      if (data.templateProposals.length > 0) {
        setActiveTab(data.templateProposals[0].frameType);
      }

      setStep('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ─────────────────────────────────────────────
  // 최종 반영
  // ─────────────────────────────────────────────
  const handleApply = async () => {
    setIsApplying(true);
    setError(null);
    try {
      const approvals = Object.entries(approvalMap)
        .filter(([, approved]) => approved)
        .map(([frameType]) => ({
          frameType,
          proposal: analysisResult?.templateProposals.find(
            (p) => p.frameType === frameType,
          ),
        }));

      const res = await fetch('/api/admin/apply-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referenceSource: srcMode === 'url' ? referenceUrl : fileName,
          approvals,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error ?? '반영 중 오류가 발생했습니다.');
      }

      setApplyDone(true);
      showToast('템플릿이 성공적으로 반영되었습니다.');
      setTimeout(() => {
        setApplyDone(false);
        setStep('input');
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setIsApplying(false);
    }
  };

  // ─────────────────────────────────────────────
  // 롤백
  // ─────────────────────────────────────────────
  const handleRollback = async (versionId: string) => {
    try {
      const res = await fetch('/api/admin/versions/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId }),
      });
      if (!res.ok) throw new Error('롤백에 실패했습니다.');
      showToast('롤백이 완료되었습니다.');
      fetchVersions(historyFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : '롤백 중 오류가 발생했습니다.');
    }
  };

  // ─────────────────────────────────────────────
  // 토스트 표시
  // ─────────────────────────────────────────────
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // ─────────────────────────────────────────────
  // 학습 시작 버튼 활성화 조건
  // ─────────────────────────────────────────────
  const canAnalyze =
    !isAnalyzing &&
    selectedTemplates.length > 0 &&
    (srcMode === 'url' ? referenceUrl.trim() !== '' : fileBase64 !== null);

  // 현재 활성 탭의 proposal
  const activeProposal = analysisResult?.templateProposals.find(
    (p) => p.frameType === activeTab,
  );

  // 승인된 개수
  const approvedCount = Object.values(approvalMap).filter(Boolean).length;

  if (!isOpen) return null;

  // ─────────────────────────────────────────────
  // 공통 스타일
  // ─────────────────────────────────────────────
  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 200,
    backgroundColor: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
  };

  const panelStyle: React.CSSProperties = {
    width: 'min(900px, 95vw)',
    maxHeight: '90vh',
    overflowY: 'auto',
    backgroundColor: '#18181b',
    borderRadius: '16px',
    border: '1px solid #3f3f46',
    padding: '28px',
    position: 'relative',
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: '13px',
    fontWeight: '600',
    color: '#a1a1aa',
    marginBottom: '10px',
    marginTop: '20px',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: '#09090b',
    border: '1px solid #3f3f46',
    borderRadius: '8px',
    color: '#e4e4e7',
    fontSize: '14px',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const primaryButtonStyle: React.CSSProperties = {
    padding: '10px 24px',
    backgroundColor: '#4f46e5',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  };

  const disabledButtonStyle: React.CSSProperties = {
    ...primaryButtonStyle,
    backgroundColor: '#27272a',
    color: '#52525b',
    cursor: 'not-allowed',
  };

  const ghostButtonStyle: React.CSSProperties = {
    padding: '8px 14px',
    backgroundColor: 'transparent',
    color: '#a1a1aa',
    border: '1px solid #3f3f46',
    borderRadius: '8px',
    fontSize: '13px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  };

  const closeButtonStyle: React.CSSProperties = {
    position: 'absolute',
    top: '20px',
    right: '20px',
    background: 'transparent',
    border: 'none',
    color: '#71717a',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  // ─────────────────────────────────────────────
  // Step 1: 입력 단계
  // ─────────────────────────────────────────────
  const renderInputStep = () => (
    <>
      {/* 헤더 */}
      <div style={{ marginBottom: '24px', paddingRight: '40px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#ffffff', margin: 0 }}>
          레퍼런스 학습
        </h2>
        <p style={{ fontSize: '13px', color: '#71717a', marginTop: '6px', marginBottom: 0 }}>
          레퍼런스 이미지나 URL을 분석하여 템플릿을 자동으로 개선합니다.
        </p>
      </div>

      {/* 소스 탭 */}
      <div>
        <p style={sectionTitleStyle}>레퍼런스 소스</p>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          {(['url', 'file'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setSrcMode(mode)}
              style={{
                padding: '6px 16px',
                borderRadius: '6px',
                border: '1px solid',
                borderColor: srcMode === mode ? '#6366f1' : '#3f3f46',
                backgroundColor: srcMode === mode ? 'rgba(99,102,241,0.1)' : 'transparent',
                color: srcMode === mode ? '#818cf8' : '#71717a',
                fontSize: '13px',
                fontWeight: '500',
                cursor: 'pointer',
              }}
            >
              {mode === 'url' ? 'URL 입력' : '파일 업로드'}
            </button>
          ))}
        </div>

        {/* URL 입력 모드 */}
        {srcMode === 'url' && (
          <input
            type="text"
            value={referenceUrl}
            onChange={(e) => setReferenceUrl(e.target.value)}
            placeholder="https://..."
            style={inputStyle}
          />
        )}

        {/* 파일 업로드 모드 */}
        {srcMode === 'file' && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleFileInputChange}
            />
            {!fileBase64 ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(true);
                }}
                onDragLeave={() => setIsDraggingOver(false)}
                onDrop={handleDrop}
                style={{
                  border: `2px dashed ${isDraggingOver ? '#6366f1' : '#3f3f46'}`,
                  borderRadius: '12px',
                  padding: '32px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  backgroundColor: isDraggingOver ? 'rgba(99,102,241,0.05)' : 'transparent',
                  transition: 'all 0.2s',
                }}
              >
                <Upload size={28} color="#52525b" style={{ margin: '0 auto 12px' }} />
                <p style={{ fontSize: '14px', color: '#71717a', margin: '0 0 4px' }}>
                  JPG, PNG, WEBP 파일을 올려주세요
                </p>
                <p style={{ fontSize: '12px', color: '#52525b', margin: 0 }}>
                  클릭하거나 파일을 드래그하세요
                </p>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  backgroundColor: 'rgba(99,102,241,0.08)',
                  borderRadius: '8px',
                  border: '1px solid rgba(99,102,241,0.3)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Check size={16} color="#34d399" />
                  <span style={{ fontSize: '13px', color: '#e4e4e7' }}>{fileName}</span>
                </div>
                <button
                  onClick={() => {
                    setFileBase64(null);
                    setFileName('');
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#71717a',
                    cursor: 'pointer',
                    padding: '2px',
                    display: 'flex',
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 템플릿 선택 */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '24px', marginBottom: '10px' }}>
          <p style={{ fontSize: '13px', fontWeight: '600', color: '#a1a1aa', margin: 0 }}>
            적용할 템플릿 선택
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={selectAll} style={ghostButtonStyle}>전체선택</button>
            <button onClick={deselectAll} style={ghostButtonStyle}>전체해제</button>
          </div>
        </div>

        {/* 4열 그리드 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '8px',
          }}
        >
          {ALL_FRAME_KEYS.map((key) => {
            const selected = selectedTemplates.includes(key);
            return (
              <button
                key={key}
                onClick={() => toggleTemplate(key)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: `1px solid ${selected ? '#6366f1' : '#3f3f46'}`,
                  backgroundColor: selected ? 'rgba(99,102,241,0.1)' : 'transparent',
                  color: selected ? '#818cf8' : '#71717a',
                  fontSize: '13px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {/* 체크박스 */}
                <span
                  style={{
                    width: '14px',
                    height: '14px',
                    borderRadius: '3px',
                    border: `1.5px solid ${selected ? '#6366f1' : '#52525b'}`,
                    backgroundColor: selected ? '#6366f1' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {selected && <Check size={9} color="#fff" />}
                </span>
                {FRAME_LABELS[key]}
              </button>
            );
          })}
        </div>
      </div>

      {/* 에러 메시지 */}
      {error && (
        <div
          style={{
            marginTop: '16px',
            padding: '10px 14px',
            backgroundColor: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: '8px',
            color: '#f87171',
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}

      {/* 학습 시작 버튼 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
        <button
          onClick={handleAnalyze}
          disabled={!canAnalyze}
          style={canAnalyze ? primaryButtonStyle : disabledButtonStyle}
        >
          {isAnalyzing ? (
            <>
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              분석 중...
            </>
          ) : (
            '학습 시작'
          )}
        </button>
      </div>
    </>
  );

  // ─────────────────────────────────────────────
  // Step 2: 결과 비교 단계
  // ─────────────────────────────────────────────
  const renderResultStep = () => {
    if (!analysisResult) return null;

    const { referenceAnalysis, templateProposals } = analysisResult;

    return (
      <>
        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', paddingRight: '40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button onClick={() => setStep('input')} style={ghostButtonStyle}>
              <ChevronLeft size={15} />
              다시 입력
            </button>
            <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#ffffff', margin: 0 }}>
              AS-IS / TO-BE 비교
            </h2>
          </div>
        </div>

        {/* 레퍼런스 분석 요약 바 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '10px 14px',
            backgroundColor: 'rgba(99,102,241,0.06)',
            borderRadius: '8px',
            border: '1px solid rgba(99,102,241,0.15)',
            marginBottom: '20px',
            flexWrap: 'wrap',
          }}
        >
          {/* 색상 팔레트 칩 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: '#71717a' }}>팔레트</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {referenceAnalysis.colorPalette.slice(0, 6).map((color, i) => (
                <div
                  key={i}
                  title={color}
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '3px',
                    backgroundColor: color,
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                />
              ))}
            </div>
          </div>
          <span style={{ color: '#3f3f46', fontSize: '13px' }}>|</span>
          <span style={{ fontSize: '12px', color: '#a1a1aa' }}>{referenceAnalysis.layoutStyle}</span>
        </div>

        {/* 탭 네비게이션 */}
        <div
          style={{
            display: 'flex',
            gap: 0,
            borderBottom: '1px solid #27272a',
            marginBottom: '20px',
            overflowX: 'auto',
          }}
        >
          {selectedTemplates
            .filter((t) => templateProposals.some((p) => p.frameType === t))
            .map((frameType) => {
              const isActive = activeTab === frameType;
              const approved = approvalMap[frameType];
              return (
                <button
                  key={frameType}
                  onClick={() => setActiveTab(frameType)}
                  style={{
                    padding: '8px 16px',
                    fontSize: '13px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: `2px solid ${isActive ? '#6366f1' : 'transparent'}`,
                    color: isActive ? '#818cf8' : '#52525b',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  {/* 승인/거부 점 표시 */}
                  {approved === true && (
                    <span style={{ color: '#34d399', fontSize: '10px' }}>●</span>
                  )}
                  {approved === false && (
                    <span style={{ color: '#f87171', fontSize: '10px' }}>●</span>
                  )}
                  {FRAME_LABELS[frameType] ?? frameType}
                </button>
              );
            })}
        </div>

        {/* 탭 컨텐츠 */}
        {activeProposal && (
          <div>
            {/* changeSummary */}
            <div
              style={{
                backgroundColor: 'rgba(99,102,241,0.08)',
                borderRadius: '8px',
                padding: '12px 16px',
                fontSize: '13px',
                color: '#a1a1aa',
                marginBottom: '16px',
                lineHeight: '1.6',
              }}
            >
              {activeProposal.changeSummary}
            </div>

            {/* 승인/거부 토글 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '16px' }}>
              <button
                onClick={() => setApprovalMap((m) => ({ ...m, [activeTab]: true }))}
                style={{
                  padding: '7px 14px',
                  borderRadius: '7px',
                  border: '1px solid',
                  borderColor: approvalMap[activeTab] === true ? 'rgba(16,185,129,0.4)' : '#3f3f46',
                  backgroundColor: approvalMap[activeTab] === true ? 'rgba(16,185,129,0.15)' : 'transparent',
                  color: approvalMap[activeTab] === true ? '#34d399' : '#71717a',
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <Check size={14} />
                반영
              </button>
              <button
                onClick={() => setApprovalMap((m) => ({ ...m, [activeTab]: false }))}
                style={{
                  padding: '7px 14px',
                  borderRadius: '7px',
                  border: '1px solid',
                  borderColor: approvalMap[activeTab] === false ? 'rgba(239,68,68,0.4)' : '#3f3f46',
                  backgroundColor: approvalMap[activeTab] === false ? 'rgba(239,68,68,0.1)' : 'transparent',
                  color: approvalMap[activeTab] === false ? '#f87171' : '#71717a',
                  fontSize: '13px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <X size={14} />
                제외
              </button>
            </div>

            {/* AS-IS / TO-BE 코드 비교 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              {/* AS-IS */}
              <div>
                <div
                  style={{
                    padding: '8px 12px',
                    backgroundColor: '#1c1c1f',
                    borderRadius: '8px 8px 0 0',
                    borderBottom: '1px solid #27272a',
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#71717a',
                  }}
                >
                  AS-IS (현재)
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: '12px',
                    backgroundColor: '#0d0d10',
                    borderRadius: '0 0 8px 8px',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    color: '#a1a1aa',
                    maxHeight: '400px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  {activeProposal.currentCode}
                </pre>
              </div>

              {/* TO-BE */}
              <div>
                <div
                  style={{
                    padding: '8px 12px',
                    backgroundColor: 'rgba(16,185,129,0.06)',
                    borderRadius: '8px 8px 0 0',
                    borderBottom: '1px solid rgba(16,185,129,0.15)',
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#34d399',
                  }}
                >
                  TO-BE (제안)
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: '12px',
                    backgroundColor: 'rgba(16,185,129,0.04)',
                    borderRadius: '0 0 8px 8px',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    color: '#e4e4e7',
                    maxHeight: '400px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  {activeProposal.proposedCode}
                </pre>
              </div>
            </div>

            {/* diffHighlights */}
            {activeProposal.diffHighlights.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {activeProposal.diffHighlights.map((highlight, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                    <span
                      style={{
                        backgroundColor: 'rgba(99,102,241,0.15)',
                        borderRadius: '4px',
                        padding: '2px 6px',
                        fontSize: '11px',
                        color: '#818cf8',
                        fontFamily: 'monospace',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {highlight.lineRange}
                    </span>
                    <span style={{ fontSize: '12px', color: '#a1a1aa', lineHeight: '1.5' }}>
                      {highlight.description}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 에러 메시지 */}
        {error && (
          <div
            style={{
              marginTop: '16px',
              padding: '10px 14px',
              backgroundColor: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '8px',
              color: '#f87171',
              fontSize: '13px',
            }}
          >
            {error}
          </div>
        )}

        {/* 하단 버튼 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '24px', borderTop: '1px solid #27272a', paddingTop: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', color: '#71717a' }}>
              <span style={{ color: '#818cf8', fontWeight: '600' }}>{approvedCount}개</span> 반영 예정
            </span>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => setStep('history')} style={ghostButtonStyle}>
              <History size={15} />
              버전 이력
            </button>
            <button
              onClick={handleApply}
              disabled={approvedCount === 0 || isApplying}
              style={approvedCount === 0 || isApplying ? disabledButtonStyle : primaryButtonStyle}
            >
              {isApplying ? (
                <>
                  <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                  반영 중...
                </>
              ) : (
                '최종 반영'
              )}
            </button>
          </div>
        </div>
      </>
    );
  };

  // ─────────────────────────────────────────────
  // Step 3: 버전 이력 단계
  // ─────────────────────────────────────────────
  const renderHistoryStep = () => (
    <>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', paddingRight: '40px' }}>
        <button onClick={() => setStep('result')} style={ghostButtonStyle}>
          <ChevronLeft size={15} />
          결과로 돌아가기
        </button>
        <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#ffffff', margin: 0 }}>
          버전 이력
        </h2>
      </div>

      {/* 프레임 타입 필터 */}
      <div style={{ marginBottom: '20px' }}>
        <select
          value={historyFilter}
          onChange={(e) => setHistoryFilter(e.target.value)}
          style={{
            ...inputStyle,
            width: 'auto',
            minWidth: '180px',
            cursor: 'pointer',
          }}
        >
          <option value="">전체 프레임</option>
          {ALL_FRAME_KEYS.map((key) => (
            <option key={key} value={key}>
              {FRAME_LABELS[key]}
            </option>
          ))}
        </select>
      </div>

      {/* 버전 목록 */}
      {isLoadingVersions ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '40px', color: '#71717a' }}>
          <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : versions.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '40px',
            color: '#52525b',
            fontSize: '14px',
          }}
        >
          버전 이력이 없습니다.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {versions.map((v) => (
            <div
              key={v.id}
              style={{
                padding: '14px 16px',
                backgroundColor: '#09090b',
                borderRadius: '10px',
                border: `1px solid ${v.isCurrent ? 'rgba(16,185,129,0.3)' : '#27272a'}`,
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '12px',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                  {/* 버전 번호 배지 */}
                  <span
                    style={{
                      backgroundColor: 'rgba(99,102,241,0.15)',
                      color: '#818cf8',
                      fontSize: '11px',
                      fontWeight: '600',
                      padding: '2px 8px',
                      borderRadius: '4px',
                    }}
                  >
                    v{v.versionNumber}
                  </span>
                  {/* 현재 적용 중 배지 */}
                  {v.isCurrent && (
                    <span
                      style={{
                        backgroundColor: 'rgba(16,185,129,0.15)',
                        color: '#34d399',
                        fontSize: '11px',
                        fontWeight: '600',
                        padding: '2px 8px',
                        borderRadius: '4px',
                      }}
                    >
                      현재 적용 중
                    </span>
                  )}
                  {/* 프레임 타입 */}
                  <span style={{ fontSize: '12px', color: '#71717a' }}>
                    {FRAME_LABELS[v.frameType] ?? v.frameType}
                  </span>
                  {/* 날짜 */}
                  <span style={{ fontSize: '11px', color: '#52525b', marginLeft: 'auto' }}>
                    {new Date(v.createdAt).toLocaleString('ko-KR')}
                  </span>
                </div>
                <p style={{ fontSize: '12px', color: '#71717a', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {v.referenceSource}
                </p>
                {v.changeSummary && (
                  <p style={{ fontSize: '12px', color: '#a1a1aa', margin: 0, lineHeight: '1.5' }}>
                    {v.changeSummary}
                  </p>
                )}
              </div>

              {/* 롤백 버튼 */}
              {!v.isCurrent && (
                <button
                  onClick={() => handleRollback(v.id)}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: 'transparent',
                    border: '1px solid #3f3f46',
                    borderRadius: '6px',
                    color: '#a1a1aa',
                    fontSize: '12px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  이 버전으로 롤백
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );

  // ─────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────
  return (
    <>
      {/* spin 키프레임 (인라인 style 방식) */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div style={overlayStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div style={panelStyle}>
          {/* 공통 닫기 버튼 */}
          <button onClick={onClose} style={closeButtonStyle} title="닫기">
            <X size={20} />
          </button>

          {/* 단계별 렌더 */}
          {step === 'input' && renderInputStep()}
          {step === 'result' && renderResultStep()}
          {step === 'history' && renderHistoryStep()}
        </div>
      </div>

      {/* 토스트 알림 */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '90px',
            right: '28px',
            zIndex: 300,
            backgroundColor: '#18181b',
            border: '1px solid rgba(16,185,129,0.4)',
            borderRadius: '10px',
            padding: '12px 18px',
            fontSize: '13px',
            color: '#34d399',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Check size={15} />
          {toast}
        </div>
      )}
    </>
  );
};

export default ReferenceLearnModal;
