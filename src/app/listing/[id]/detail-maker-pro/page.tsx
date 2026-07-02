'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
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

  const [refPreviews, setRefPreviews] = useState<string[]>([]);
  const [prodPreviews, setProdPreviews] = useState<string[]>([]);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);


  useEffect(() => {
    const urls = referenceImages.map(f => URL.createObjectURL(f));
    setRefPreviews(urls);
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [referenceImages]);

  useEffect(() => {
    const urls = productImages.map(f => URL.createObjectURL(f));
    setProdPreviews(urls);
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [productImages]);

  useEffect(() => {
    if (!lightbox) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setLightbox(p => p ? { ...p, index: (p.index + 1) % p.images.length } : null);
      else if (e.key === 'ArrowLeft') setLightbox(p => p ? { ...p, index: (p.index - 1 + p.images.length) % p.images.length } : null);
      else if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightbox]);

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
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve((e.target?.result as string).split(',')[1] ?? '');
      reader.onerror = () => reject(new Error(`파일을 읽을 수 없습니다: ${file.name}`));
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
    } catch (err) {
      const message = err instanceof Error ? err.message : '분석 중 오류가 발생했습니다.';
      setError(message);
    } finally {
      setIsAnalyzing(false);
    }
  }, [referenceImages, productName]);

  // Step 1.5 → Step 2: DSL 생성
  const handleGenerate = useCallback(async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setScreen('generating');
    setError(null);
    setProgress({ step: 'start', message: 'Claude가 레이아웃을 설계하는 중...' });

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
              .filter(Boolean)
              .slice(0, 30),
            category: '',
          },
          analyzedSections: editedSections,
          productImageCount: productImages.length,
        }),
      });

      const data = await res.json() as { success: boolean; sections?: GeneratedSection[]; error?: string; _debug?: string };
      if (!data.success || !data.sections) {
        const debugInfo = data._debug ? `\n[debug] ${data._debug}` : '';
        setError((data.error ?? '레이아웃 생성 실패') + debugInfo);
        setScreen('review');
        return;
      }

      setGeneratedSections(data.sections);
      setScreen('result');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[handleGenerate] 오류:', e);
      setError(`생성 중 오류: ${msg}`);
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
            id="ref-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={e => { setReferenceImages(Array.from(e.target.files ?? []).slice(0, 8)); e.target.value = ''; }}
          />
          {refPreviews.length > 0 ? (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: '8px' }}>
                {refPreviews.map((url, idx) => (
                  <div key={idx} onClick={() => setLightbox({ images: refPreviews, index: idx })}
                    style={{ aspectRatio: '1', borderRadius: '6px', overflow: 'hidden', cursor: 'zoom-in', background: '#1e1e2e' }}>
                    <img src={url} alt={`참고 ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                ))}
              </div>
              <label htmlFor="ref-file-input"
                style={{ ...uploadBtnStyle, display: 'block', textAlign: 'center', cursor: 'pointer', fontSize: '12px', padding: '8px' }}>
                이미지 교체 / 추가 ({refPreviews.length}/8장)
              </label>
            </div>
          ) : (
            <label htmlFor="ref-file-input"
              style={{ ...uploadBtnStyle, display: 'block', textAlign: 'center', cursor: 'pointer' }}>
              클릭해서 이미지 선택 (최대 8장)
            </label>
          )}
        </div>

        <div style={{ marginBottom: '28px' }}>
          <label
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: '#a0a0b0',
              display: 'block',
              marginBottom: '4px',
            }}
          >
            제품 이미지 <span style={{ color: BRAND_PURPLE }}>★ 상세페이지에 삽입됩니다</span>
          </label>
          <p style={{ fontSize: '11px', color: '#6b7280', marginBottom: '8px', marginTop: 0 }}>
            누끼 또는 제품 사진을 올리면 각 섹션에 자동으로 들어갑니다 (최대 4장)
          </p>
          {/* 추가 전용 input — 기존 이미지에 합산 (최대 4장) */}
          <input
            id="prod-add-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={e => {
              const newFiles = Array.from(e.target.files ?? []);
              setProductImages(prev => [...prev, ...newFiles].slice(0, 4));
              e.target.value = '';
            }}
          />
          {/* 교체 전용 input — 전체 교체 */}
          <input
            id="prod-replace-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={e => { setProductImages(Array.from(e.target.files ?? []).slice(0, 4)); e.target.value = ''; }}
          />
          {prodPreviews.length > 0 ? (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: '8px' }}>
                {prodPreviews.map((url, idx) => (
                  <div key={idx} onClick={() => setLightbox({ images: prodPreviews, index: idx })}
                    style={{ aspectRatio: '1', borderRadius: '6px', overflow: 'hidden', cursor: 'zoom-in', background: '#1e1e2e', position: 'relative' }}>
                    <img src={url} alt={`제품 ${idx + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); setProductImages(prev => prev.filter((_, i) => i !== idx)); }}
                      style={{
                        position: 'absolute', top: 3, right: 3,
                        width: 18, height: 18, borderRadius: '50%',
                        background: 'rgba(0,0,0,0.65)', border: 'none',
                        color: '#fff', fontSize: 11, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        lineHeight: 1,
                      }}
                    >×</button>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {prodPreviews.length < 4 && (
                  <label
                    htmlFor="prod-add-input"
                    style={{
                      flex: 1, textAlign: 'center', cursor: 'pointer',
                      padding: '9px 0', borderRadius: '8px', fontSize: '12px', fontWeight: 700,
                      border: '1.5px solid #6366f1', color: '#6366f1', background: 'rgba(99,102,241,0.08)',
                      display: 'block',
                    }}
                  >
                    + 추가 ({prodPreviews.length}/4장)
                  </label>
                )}
                <label
                  htmlFor="prod-replace-input"
                  style={{
                    flex: 1, textAlign: 'center', cursor: 'pointer',
                    padding: '9px 0', borderRadius: '8px', fontSize: '12px', fontWeight: 700,
                    border: '1.5px solid #374151', color: '#9ca3af', background: 'transparent',
                    display: 'block',
                  }}
                >
                  ↺ 교체
                </label>
              </div>
            </div>
          ) : (
            <label htmlFor="prod-add-input"
              style={{ ...uploadBtnStyle, display: 'block', textAlign: 'center', cursor: 'pointer', borderColor: '#6366f1' }}>
              📷 제품 이미지 선택 (최대 4장)
            </label>
          )}
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

        {lightbox && (
          <div onClick={() => setLightbox(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.9)',
                     display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
              <img src={lightbox.images[lightbox.index]} alt=""
                style={{ maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain', borderRadius: '8px' }} />
              <button onClick={() => setLightbox(null)}
                style={{ position: 'absolute', top: '-12px', right: '-12px', background: '#374151',
                         border: 'none', borderRadius: '50%', width: '32px', height: '32px',
                         color: '#e2e8f0', cursor: 'pointer', fontSize: '16px', lineHeight: '32px' }}>✕</button>
              {lightbox.images.length > 1 && (<>
                <button onClick={e => { e.stopPropagation(); setLightbox(p => p ? { ...p, index: (p.index - 1 + p.images.length) % p.images.length } : null); }}
                  style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)',
                           background: 'rgba(55,65,81,0.8)', border: 'none', borderRadius: '50%',
                           width: '36px', height: '36px', color: '#e2e8f0', cursor: 'pointer', fontSize: '22px', lineHeight: '36px' }}>‹</button>
                <button onClick={e => { e.stopPropagation(); setLightbox(p => p ? { ...p, index: (p.index + 1) % p.images.length } : null); }}
                  style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                           background: 'rgba(55,65,81,0.8)', border: 'none', borderRadius: '50%',
                           width: '36px', height: '36px', color: '#e2e8f0', cursor: 'pointer', fontSize: '22px', lineHeight: '36px' }}>›</button>
                <div style={{ position: 'absolute', bottom: '-28px', left: '50%', transform: 'translateX(-50%)',
                              color: '#9ca3af', fontSize: '13px', whiteSpace: 'nowrap' }}>
                  {lightbox.index + 1} / {lightbox.images.length}
                </div>
              </>)}
            </div>
          </div>
        )}
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
                    prev.map((s, j) => (j === i ? { ...s, extractedData: parsed, needsReview: false } : s))
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

      {productImages.length === 0 && (
        <div style={{
          background: '#2a1f10',
          border: '1px solid #f59e0b',
          borderRadius: '8px',
          padding: '12px 14px',
          marginBottom: '16px',
          fontSize: '13px',
          color: '#fbbf24',
        }}>
          ⚠️ 제품 이미지를 업로드하지 않았습니다. 에디터로 이동하면 섹션에 이미지가 없습니다.{' '}
          <button
            onClick={() => setScreen('upload')}
            style={{ background: 'none', border: 'none', color: '#f59e0b', textDecoration: 'underline', cursor: 'pointer', fontSize: '13px', padding: 0 }}
          >
            돌아가서 이미지 추가 →
          </button>
        </div>
      )}

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
          onClick={async () => {
            const editBtn = document.getElementById('edit-btn') as HTMLButtonElement | null;

            // Step 1: 제품 이미지 업로드 → Supabase URL 확보
            let uploadedImageUrls: string[] = [];
            if (productImages.length > 0) {
              uploadedImageUrls = (
                await Promise.allSettled(
                  productImages.map(async (file) => {
                    const fd = new FormData();
                    fd.append('file', file);
                    fd.append('usageContext', 'listing_detail');
                    const res = await fetch('/api/listing/upload-image', { method: 'POST', body: fd });
                    const json = await res.json() as { success: boolean; data?: { url: string } };
                    if (!json.success || !json.data?.url) throw new Error('upload failed');
                    return json.data.url;
                  })
                )
              )
                .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
                .map((r) => r.value);
            }

            // Step 2: flux_lifestyle 슬롯 섹션마다 Gemini 씬 생성
            // generate-scene-image: 누끼 제거(Replicate) → 배경 생성(Gemini) → 합성(Sharp) 자동 처리
            const geminiUrlMap: Record<number, string> = {};
            if (uploadedImageUrls.length > 0) {
              if (editBtn) editBtn.textContent = 'AI 이미지 생성 중...';

              const fluxItems = generatedSections
                .map((s, i) => ({ s, i }))
                .filter(({ s }) => s.imageSlots?.some(slot => slot.slotType === 'flux_lifestyle'));

              await Promise.allSettled(
                fluxItems.map(async ({ s, i }) => {
                  try {
                    const slot = s.imageSlots?.find(sl => sl.slotType === 'flux_lifestyle');
                    const sceneRes = await fetch('/api/ai/generate-scene-image', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        sectionType: 'lifestyle',
                        productImageUrls: uploadedImageUrls.slice(0, 2),
                        scenePrompt: slot?.promptHint,
                      }),
                    });
                    const sceneJson = await sceneRes.json() as {
                      success: boolean;
                      data?: { imageBase64: string; mimeType: string };
                    };
                    if (!sceneJson.success || !sceneJson.data) return;

                    const uploadRes = await fetch('/api/image/upload-ai', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        imageBase64: sceneJson.data.imageBase64,
                        mimeType: sceneJson.data.mimeType,
                        role: 'lifestyle',
                      }),
                    });
                    const uploadJson = await uploadRes.json() as { success: boolean; url?: string };
                    if (uploadJson.success && uploadJson.url) {
                      geminiUrlMap[i] = uploadJson.url;
                    }
                  } catch {
                    // 실패 시 제품 이미지 원본으로 fallback
                  }
                })
              );
            }

            // Step 3: 섹션 조립 (Gemini 씬 → 원본 제품 이미지 순으로 fallback)
            const detailSections = generatedSections.map((s, i) => {
              const geminiUrl = geminiUrlMap[i];
              const imageUrl = geminiUrl ?? fluxResults[i] ?? uploadedImageUrls[i] ?? uploadedImageUrls[0];
              return {
                id: crypto.randomUUID(),
                type: 'claude_layout' as const,
                order: i,
                content: {
                  type: 'claude_layout' as const,
                  title: s.title ?? `섹션 ${i + 1}`,
                  blocks: (s as Record<string, unknown>).blocks ?? [],
                  bgStyle: (s as Record<string, unknown>).bgStyle,
                  padding: (s as Record<string, unknown>).padding,
                  imageSlots: s.imageSlots,
                },
                attachedImages: (() => {
                  const slotCount = Math.max(s.imageSlots?.length ?? 0, imageUrl ? 1 : 0);
                  if (slotCount === 0) return [];
                  return Array.from({ length: slotCount }, (_, idx) => ({
                    url: idx === 0 && geminiUrl ? geminiUrl : (uploadedImageUrls[idx] ?? imageUrl ?? ''),
                    order: idx,
                    processingMode: 'original' as const,
                  })).filter(item => item.url);
                })(),
              };
            });

            sessionStorage.setItem('pro_sections', JSON.stringify(detailSections));
            sessionStorage.setItem('pro_meta', JSON.stringify({ productName, uploadedImageUrls }));
            router.push('/listing/detail-maker');
          }}
          id="edit-btn"
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
          onClickCapture={(e) => {
            const btn = e.currentTarget as HTMLButtonElement;
            btn.disabled = true;
            btn.textContent = productImages.length > 0 ? '이미지 업로드 중...' : '이동 중...';
          }}
        >
          에디터에서 편집 →
        </button>
      </div>
    </div>
  );
}
