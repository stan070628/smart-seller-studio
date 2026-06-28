'use client';

import React, { useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { AnalyzedSection } from '@/app/api/ai/analyze-detail-page/route';

type ScreenState = 'upload' | 'review' | 'generating' | 'result';

interface GeneratedSection {
  title?: string;
  type?: string;
  imageSlots?: Array<{ slotType: string; promptHint?: string }>;
}

interface ProgressEvent {
  step: string;
  message: string;
  current?: number;
  total?: number;
}

const BRAND_PURPLE = '#6366f1';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: '#1e1e2e',
  border: '1px solid #374151',
  borderRadius: '8px',
  color: '#e2e8f0',
  fontSize: '14px',
  boxSizing: 'border-box',
};

const uploadBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  background: '#1e1e2e',
  border: '2px dashed #374151',
  borderRadius: '8px',
  color: '#6b7280',
  cursor: 'pointer',
  fontSize: '13px',
};

export default function DetailMakerProPage() {
  const params = useParams();
  const router = useRouter();
  const listingId = params.id as string;

  const [screen, setScreen] = useState<ScreenState>('upload');
  const [referenceImages, setReferenceImages] = useState<File[]>([]);
  const [productImages, setProductImages] = useState<File[]>([]);
  const [editedSections, setEditedSections] = useState<AnalyzedSection[]>([]);
  const [productName, setProductName] = useState('');
  const [productPoints, setProductPoints] = useState('');
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [generatedSections, setGeneratedSections] = useState<GeneratedSection[]>([]);
  const [fluxResults, setFluxResults] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState<number | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const refFileRef = useRef<HTMLInputElement>(null);
  const prodFileRef = useRef<HTMLInputElement>(null);

  const containerStyle: React.CSSProperties = {
    minHeight: '100vh',
    background: '#0f0f17',
    color: '#e2e8f0',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    padding: '24px 20px',
    maxWidth: '600px',
    margin: '0 auto',
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve((e.target?.result as string).split(',')[1] ?? '');
      reader.readAsDataURL(file);
    });

  // Step 1 → Step 1.5: OCR 분석
  const handleAnalyze = useCallback(async () => {
    if (referenceImages.length === 0) {
      setError('참고 이미지를 1장 이상 업로드해주세요.');
      return;
    }
    setError(null);
    setIsAnalyzing(true);

    try {
      const imageData = await Promise.all(
        referenceImages.map(async file => ({
          base64: await fileToBase64(file),
          mimeType: file.type as 'image/png' | 'image/jpeg' | 'image/webp',
        }))
      );

      const res = await fetch('/api/ai/analyze-detail-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: imageData, productName }),
      });
      const data = await res.json() as { success: boolean; sections?: AnalyzedSection[]; error?: string };
      if (!data.success || !data.sections) {
        setError(data.error ?? '분석 실패');
        return;
      }
      setEditedSections(data.sections);
      setScreen('review');
    } catch {
      setError('분석 중 오류가 발생했습니다.');
    } finally {
      setIsAnalyzing(false);
    }
  }, [referenceImages, productName]);

  // Step 1.5 → Step 2: DSL 생성 (SSE)
  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setScreen('generating');
    setError(null);
    setProgress({ step: 'start', message: '시작 중...' });

    try {
      const res = await fetch('/api/ai/generate-pro-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productInfo: {
            name: productName,
            points: productPoints
              .split('\n')
              .map(p => p.trim())
              .filter(Boolean),
            category: '',
          },
          analyzedSections: editedSections,
          productImageCount: productImages.length,
        }),
      });

      if (!res.body) {
        setError('스트리밍 응답 없음');
        setScreen('review');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const eventMatch = chunk.match(/^event: (\w+)/m);
          const dataMatch = chunk.match(/^data: (.+)/m);
          if (!eventMatch || !dataMatch) continue;
          const eventType = eventMatch[1];
          const eventData = JSON.parse(dataMatch[1]) as Record<string, unknown>;
          if (eventType === 'progress') {
            setProgress(eventData as unknown as ProgressEvent);
          } else if (eventType === 'complete') {
            setGeneratedSections(eventData.sections as GeneratedSection[]);
            setScreen('result');
          } else if (eventType === 'error') {
            setError((eventData.message as string) ?? '오류 발생');
            setScreen('review');
          }
        }
      }
    } catch {
      setError('생성 중 오류가 발생했습니다.');
      setScreen('review');
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, productName, productPoints, editedSections, productImages.length]);

  // FLUX 이미지 재생성
  const handleFluxRegenerate = useCallback(
    async (sectionIndex: number, _promptHint: string) => {
      if (productImages.length === 0) {
        setError('FLUX 생성을 위해 제품 이미지를 업로드해주세요.');
        return;
      }
      setIsRegenerating(sectionIndex);
      setError(null);
      try {
        // 제품 이미지를 먼저 Supabase에 업로드해야 하지만
        // 간소화를 위해 FLUX API가 base64를 지원하지 않으므로
        // 여기서는 기능적 미완성을 알리고 스킵합니다
        setError('FLUX 이미지 재생성 기능은 현재 준비 중입니다.');
      } finally {
        setIsRegenerating(null);
      }
    },
    [productImages.length]
  );

  const errorBanner = error ? (
    <div
      style={{
        background: '#2a1515',
        border: '1px solid #ef4444',
        borderRadius: '8px',
        padding: '12px',
        marginBottom: '16px',
        fontSize: '13px',
        color: '#fca5a5',
      }}
    >
      {error}
    </div>
  ) : null;

  // ── Upload Screen ──────────────────────────────────────────────────────────
  if (screen === 'upload') {
    return (
      <div style={containerStyle}>
        <button
          onClick={() => router.back()}
          style={{
            background: 'none',
            border: 'none',
            color: '#6b7280',
            cursor: 'pointer',
            marginBottom: '20px',
            fontSize: '14px',
          }}
        >
          &larr; 돌아가기
        </button>
        <h1 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '6px' }}>
          PRO 상세페이지 만들기
        </h1>
        <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '24px' }}>
          참고 스크린샷을 올리면 AI가 분석해서 전문 페이지를 자동 생성합니다.
        </p>

        {errorBanner}

        <div style={{ marginBottom: '20px' }}>
          <label
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: '#a0a0b0',
              display: 'block',
              marginBottom: '8px',
            }}
          >
            상품명 *
          </label>
          <input
            value={productName}
            onChange={e => setProductName(e.target.value)}
            placeholder="예: 덴프스 엔엠엔 NMN 250"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: '#a0a0b0',
              display: 'block',
              marginBottom: '8px',
            }}
          >
            핵심 판매 포인트 (줄 구분)
          </label>
          <textarea
            value={productPoints}
            onChange={e => setProductPoints(e.target.value)}
            rows={4}
            placeholder={'국내 최대 NMN 250mg 함유\n건조효모 유래 NMN\nHACCP 인증'}
            style={{ ...inputStyle, resize: 'vertical' as const }}
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: '#a0a0b0',
              display: 'block',
              marginBottom: '8px',
            }}
          >
            참고 상세페이지 스크린샷 (최대 8장) *
          </label>
          <input
            ref={refFileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={e => setReferenceImages(Array.from(e.target.files ?? []).slice(0, 8))}
          />
          <button onClick={() => refFileRef.current?.click()} style={uploadBtnStyle}>
            {referenceImages.length > 0 ? `${referenceImages.length}장 선택됨` : '클릭해서 이미지 선택'}
          </button>
        </div>

        <div style={{ marginBottom: '28px' }}>
          <label
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: '#a0a0b0',
              display: 'block',
              marginBottom: '8px',
            }}
          >
            제품 이미지 (누끼 — 선택사항)
          </label>
          <input
            ref={prodFileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={e => setProductImages(Array.from(e.target.files ?? []).slice(0, 4))}
          />
          <button onClick={() => prodFileRef.current?.click()} style={uploadBtnStyle}>
            {productImages.length > 0
              ? `${productImages.length}장 선택됨`
              : '제품 이미지 선택 (선택사항)'}
          </button>
        </div>

        <button
          onClick={handleAnalyze}
          disabled={!productName || referenceImages.length === 0 || isAnalyzing}
          style={{
            width: '100%',
            padding: '14px',
            background: BRAND_PURPLE,
            border: 'none',
            borderRadius: '10px',
            color: '#fff',
            fontSize: '15px',
            fontWeight: 700,
            cursor: 'pointer',
            opacity: !productName || referenceImages.length === 0 || isAnalyzing ? 0.5 : 1,
          }}
        >
          {isAnalyzing ? '분석 중...' : '분석 시작 →'}
        </button>
      </div>
    );
  }

  // ── Review Screen ──────────────────────────────────────────────────────────
  if (screen === 'review') {
    return (
      <div style={containerStyle}>
        <h1 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '4px' }}>OCR 결과 확인</h1>
        <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '20px' }}>
          추출된 데이터를 확인하고 수정 후 생성하세요. 임상 수치는 반드시 검토해주세요.
        </p>

        {errorBanner}

        {editedSections.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
            분석된 섹션이 없습니다.
          </div>
        )}

        {editedSections.map((section, i) => (
          <div
            key={i}
            style={{
              background: '#1e1e2e',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '12px',
              border: section.needsReview ? '1px solid #f59e0b' : '1px solid #374151',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px',
              }}
            >
              <span style={{ fontSize: '11px', fontWeight: 700, color: BRAND_PURPLE }}>
                {section.blockType}
              </span>
              {section.needsReview && (
                <span
                  style={{
                    fontSize: '10px',
                    background: '#f59e0b22',
                    color: '#f59e0b',
                    padding: '2px 6px',
                    borderRadius: '4px',
                  }}
                >
                  검토 필요
                </span>
              )}
            </div>
            <textarea
              value={JSON.stringify(section.extractedData, null, 2)}
              onChange={e => {
                try {
                  const parsed = JSON.parse(e.target.value) as AnalyzedSection['extractedData'];
                  setEditedSections(prev =>
                    prev.map((s, j) => (j === i ? { ...s, extractedData: parsed } : s))
                  );
                } catch {
                  // 유효하지 않은 JSON은 무시
                }
              }}
              rows={6}
              style={{
                width: '100%',
                background: '#0f0f17',
                border: '1px solid #374151',
                borderRadius: '6px',
                color: '#a0a0b0',
                fontSize: '11px',
                fontFamily: 'monospace',
                padding: '8px',
                resize: 'vertical' as const,
                boxSizing: 'border-box',
              }}
            />
          </div>
        ))}

        <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
          <button
            onClick={() => setScreen('upload')}
            style={{
              flex: 1,
              padding: '12px',
              background: '#1e1e2e',
              border: '1px solid #374151',
              borderRadius: '8px',
              color: '#e2e8f0',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            &larr; 다시 업로드
          </button>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            style={{
              flex: 2,
              padding: '12px',
              background: BRAND_PURPLE,
              border: 'none',
              borderRadius: '8px',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 700,
              opacity: isGenerating ? 0.5 : 1,
            }}
          >
            생성 시작 →
          </button>
        </div>
      </div>
    );
  }

  // ── Generating Screen ──────────────────────────────────────────────────────
  if (screen === 'generating') {
    return (
      <div
        style={{
          ...containerStyle,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ fontSize: '40px', marginBottom: '20px' }}>&#x26A1;</div>
        <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>생성 중...</h2>
        {progress && (
          <p style={{ fontSize: '13px', color: '#6b7280', textAlign: 'center' }}>
            {progress.message}
          </p>
        )}
        {progress?.current != null && progress?.total != null && (
          <div
            style={{
              width: '200px',
              background: '#1e1e2e',
              borderRadius: '8px',
              height: '6px',
              marginTop: '12px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                background: BRAND_PURPLE,
                height: '100%',
                width: `${Math.round((progress.current / progress.total) * 100)}%`,
                transition: 'width 0.3s',
              }}
            />
          </div>
        )}
      </div>
    );
  }

  // ── Result Screen ──────────────────────────────────────────────────────────
  return (
    <div style={containerStyle}>
      <h1 style={{ fontSize: '18px', fontWeight: 800, marginBottom: '4px' }}>생성 완료</h1>
      <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '20px' }}>
        {generatedSections.length}개 섹션이 생성됐습니다.
      </p>

      {errorBanner}

      {generatedSections.map((section, i) => {
        const s = section as GeneratedSection;
        const hasFluxSlot =
          s.imageSlots?.some(slot => slot.slotType === 'flux_lifestyle') ?? false;
        return (
          <div
            key={i}
            style={{
              background: '#1e1e2e',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '10px',
            }}
          >
            <div
              style={{
                fontSize: '13px',
                fontWeight: 700,
                color: '#e2e8f0',
                marginBottom: '8px',
              }}
            >
              {s.title ?? `섹션 ${i + 1}`}
            </div>
            {fluxResults[i] && (
              <img
                src={fluxResults[i]}
                alt=""
                style={{ width: '100%', borderRadius: '6px', marginBottom: '8px' }}
              />
            )}
            {hasFluxSlot && (
              <button
                onClick={() => handleFluxRegenerate(i, s.imageSlots?.[0]?.promptHint ?? '')}
                disabled={isRegenerating === i}
                style={{
                  padding: '6px 12px',
                  background: '#2d2d3f',
                  border: '1px solid #374151',
                  borderRadius: '6px',
                  color: '#a0a0b0',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                {isRegenerating === i ? '재생성 중...' : 'FLUX 이미지 재생성'}
              </button>
            )}
          </div>
        );
      })}

      <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
        <button
          onClick={() => {
            setScreen('upload');
            setGeneratedSections([]);
            setFluxResults({});
            setError(null);
          }}
          style={{
            flex: 1,
            padding: '12px',
            background: '#1e1e2e',
            border: '1px solid #374151',
            borderRadius: '8px',
            color: '#e2e8f0',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          처음부터
        </button>
        <button
          onClick={() => router.push(`/listing/${listingId}/detail-maker`)}
          style={{
            flex: 2,
            padding: '12px',
            background: BRAND_PURPLE,
            border: 'none',
            borderRadius: '8px',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 700,
          }}
        >
          에디터에서 편집 →
        </button>
      </div>
    </div>
  );
}
