'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import type { AnalyzedSection } from '@/app/api/ai/analyze-detail-page/route';
import type { LayoutBlock } from '@/types/detail-page';
import { normalizeImageBlocks } from '@/lib/detail-page/layout-image-blocks';
import { extractDetailCloseupShots, serializeShotChecklist, countUploaded, resolveSlotUrl } from '@/lib/detail-page/shot-guide';
import type { ShotCard, ShootSlot } from '@/types/shot-guide';
import ImageCleanupModal from '@/components/common/ImageCleanupModal';
import { deriveOptions, isOptionMode } from '@/lib/detail-page/product-options';
// gen-slots.ts는 import 없는 leaf 모듈이다 — layout-validator.ts를 대신 import하면
// 거기 딸린 zod 스키마가 tree-shake되지 않고 클라이언트 번들에 그대로 들어간다.
import { resolveGenSlot, sceneTypeFor } from '@/lib/detail-page/gen-slots';
import {
  stripCloseupClaims,
  findReusedImages,
  imageHygieneWarnings,
  type SectionImages,
} from '@/lib/detail-page/image-hygiene';

type ScreenState = 'upload' | 'review' | 'generating' | 'result' | 'shootguide';

interface GeneratedSection {
  title?: string;
  type?: string;
  imageSlots?: Array<{
    slotType: string;
    promptHint?: string;
    imageRef?: number;
    faceVisible?: boolean;
    modelGender?: 'male' | 'female';
  }>;
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
  // productImages와 인덱스가 1:1로 대응한다. 빈 문자열 = 옵션명 미지정.
  const [optionNames, setOptionNames] = useState<string[]>([]);
  const [cleanupTarget, setCleanupTarget] = useState<{
    index: number; url: string; base64: string; mimeType: string;
  } | null>(null);
  const [editedSections, setEditedSections] = useState<AnalyzedSection[]>([]);
  const [productName, setProductName] = useState('');
  const [productPoints, setProductPoints] = useState('');
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [generatedSections, setGeneratedSections] = useState<GeneratedSection[]>([]);
  // 레이아웃 검증·위생에서 사용자가 알아야 할 사항 — repair 후 잔존 위반, 근거 없는 수치 제거 등
  const [layoutWarnings, setLayoutWarnings] = useState<string[]>([]);
  const [fluxResults, setFluxResults] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState<number | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [shotGuide, setShotGuide] = useState<ShotCard[] | null>(null);
  const [slots, setSlots] = useState<ShootSlot[]>([]);
  const [productImageUrls, setProductImageUrls] = useState<string[]>([]);
  const [shotGuideLoading, setShotGuideLoading] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [retouchPreview, setRetouchPreview] = useState<{ index: number; url: string } | null>(null);
  const [retouchLoading, setRetouchLoading] = useState<number | null>(null);
  const searchParams = useSearchParams();

  const [refPreviews, setRefPreviews] = useState<string[]>([]);
  const [prodPreviews, setProdPreviews] = useState<string[]>([]);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [shootDrafts, setShootDrafts] = useState<Array<{ id: string; productName: string | null; updatedAt: string; step: string | null; shotCount: number }>>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/detail-page/draft?list=1');
        const json = await res.json();
        if (json?.success && Array.isArray(json.drafts)) setShootDrafts(json.drafts);
      } catch { /* 무시 */ }
    })();
  }, []);

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

  // Claude 비전 입력용: 제품 이미지를 512px JPEG로 다운스케일 → base64 (토큰 절감).
  const fileToDownscaledBase64 = async (
    file: File,
    max = 512,
  ): Promise<{ base64: string; mimeType: string }> => {
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas 2d 컨텍스트 없음');
      ctx.drawImage(bitmap, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      return { base64: dataUrl.split(',')[1] ?? '', mimeType: 'image/jpeg' };
    } catch {
      // 다운스케일 실패 시 원본 base64로 폴백
      return { base64: await fileToBase64(file), mimeType: file.type || 'image/jpeg' };
    }
  };

  // Step 1 → Step 1.5: OCR 분석
  const handleAnalyze = useCallback(async () => {
    // 무엇이 빠졌는지 알려주는 게 버튼 비활성화보다 낫다.
    if (!productName.trim()) {
      setError('상품명을 입력해주세요.');
      return;
    }
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
      // Claude가 실물을 보고 색상·디테일·카피를 정하도록 제품 이미지를 다운스케일해 전달.
      const productImagePayload = await Promise.all(
        productImages.slice(0, 4).map(f => fileToDownscaledBase64(f)),
      );
      const res = await fetch('/api/ai/generate-pro-layout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productInfo: {
            name: productName,
            points: productPoints
              .split('\n')
              .map(p => p.trim().slice(0, 200)) // 서버 항목 200자 제한 → 초과 시 400 방지
              .filter(Boolean)
              .slice(0, 30),
            category: '',
          },
          analyzedSections: editedSections,
          productImageCount: productImages.length,
          productImages: productImagePayload,
          productOptions: deriveOptions(optionNames),
        }),
      });

      const data = await res.json() as { success: boolean; sections?: GeneratedSection[]; error?: string; _debug?: string; warnings?: string[] };
      if (!data.success || !data.sections) {
        const debugInfo = data._debug ? `\n[debug] ${data._debug}` : '';
        setError((data.error ?? '레이아웃 생성 실패') + debugInfo);
        setScreen('review');
        // 에러 배너는 리뷰 화면 상단에 있으므로, 하단 버튼에서 실패해도 보이도록 스크롤.
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      setGeneratedSections(data.sections);
      setLayoutWarnings(data.warnings ?? []);
      setScreen('result');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[handleGenerate] 오류:', e);
      setError(`생성 중 오류: ${msg}`);
      setScreen('review');
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, productName, productPoints, editedSections, productImages, optionNames]);

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

  // 촬영 초안 저장: shootSession(shotGuide+slots+step+productImageUrls)을 draft API에 upsert. 반환된 id를 재사용.
  async function saveShootDraft(
    nextId: string | null,
    session: { shotGuide: ShotCard[]; slots: ShootSlot[]; step: 'guide' | 'shooting'; productImageUrls: string[] },
  ): Promise<string | null> {
    const res = await fetch('/api/detail-page/draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: nextId ?? undefined, productName, sections: generatedSections, theme: {}, shootSession: session }),
    });
    const json = await res.json();
    return (json?.id as string) ?? nextId;
  }
  function currentStep(sl: ShootSlot[]): 'guide' | 'shooting' { return sl.some(s => s.uploadedUrl) ? 'shooting' : 'guide'; }

  // 디바운스 자동저장: draftId가 잡힌 뒤 shotGuide/slots/productImageUrls가 바뀌면 1.5s 후 전체 세션 저장.
  useEffect(() => {
    if (!draftId || !shotGuide) return;
    const t = setTimeout(() => {
      saveShootDraft(draftId, { shotGuide, slots, step: currentStep(slots), productImageUrls }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [draftId, shotGuide, slots, productImageUrls]); // eslint-disable-line react-hooks/exhaustive-deps

  // 마운트 시 ?draftId= 로 초안 재개.
  useEffect(() => {
    const rid = searchParams.get('draftId');
    if (!rid) return;
    (async () => {
      try {
        const res = await fetch(`/api/detail-page/draft?id=${rid}`);
        const json = await res.json();
        const d = json?.draft;
        if (!d) return;
        setDraftId(d.id);
        if (d.productName) setProductName(d.productName);
        if (Array.isArray(d.sections)) setGeneratedSections(d.sections);
        const sg = d.shootSession?.shotGuide;
        if (Array.isArray(sg)) setShotGuide(sg);
        const ss = d.shootSession ?? {};
        if (Array.isArray(ss.slots)) setSlots(ss.slots);
        if (Array.isArray(ss.productImageUrls)) setProductImageUrls(ss.productImageUrls);
        setScreen('shootguide');
      } catch { /* 무시 */ }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 촬영 가이드: 생성된 레이아웃의 detail_closeup 슬롯 → 폰 촬영용 컷 카드 생성.
  async function handleShotGuide() {
    const shots = extractDetailCloseupShots(
      generatedSections as unknown as { title?: string; imageSlots?: { slotType?: string; promptHint?: string }[] }[]
    );
    if (shots.length === 0) {
      alert('이 레이아웃엔 디테일 접사(detail_closeup) 컷이 없어요.');
      return;
    }
    setShotGuideLoading(true);
    try {
      const res = await fetch('/api/ai/generate-shot-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productInfo: {
            name: productName,
            points: productPoints.split('\n').map(s => s.trim()).filter(Boolean),
            category: '',
          },
          shots,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '가이드 생성 실패');
      setShotGuide(json.data.shots as ShotCard[]);
      // 슬롯 초기화(추출 shots와 1:1). `shots`는 이 함수 상단에서 extractDetailCloseupShots로 만든 값(sectionIndex/slotIndex 포함).
      const initSlots: ShootSlot[] = shots.map(sh => ({ sectionIndex: sh.sectionIndex, slotIndex: sh.slotIndex, uploadedUrl: null }));
      setSlots(initSlots);
      // 제품 이미지를 지금 업로드해 URL 확보(재개-적용에서 라이프스타일/누끼용). 실패는 빈 배열.
      let prodUrls: string[] = [];
      try {
        prodUrls = (await Promise.allSettled(productImages.map(async (file) => {
          const fd = new FormData(); fd.append('file', file); fd.append('usageContext', 'listing_detail');
          const r = await fetch('/api/listing/upload-image', { method: 'POST', body: fd });
          const j = await r.json() as { success: boolean; data?: { url: string } };
          if (!j.success || !j.data?.url) throw new Error('upload failed');
          return j.data.url;
        }))).filter((x): x is PromiseFulfilledResult<string> => x.status === 'fulfilled').map(x => x.value);
      } catch { /* 무시 */ }
      setProductImageUrls(prodUrls);
      setScreen('shootguide');
      try {
        const id = await saveShootDraft(draftId, { shotGuide: json.data.shots as ShotCard[], slots: initSlots, step: 'guide', productImageUrls: prodUrls });
        if (id) {
          setDraftId(id);
          const url = new URL(window.location.href);
          url.searchParams.set('draftId', id);
          window.history.replaceState(null, '', url.toString());
        }
      } catch { /* 저장 실패는 조용히 무시 — 가이드 표시는 유지 */ }
    } catch (e) {
      alert(e instanceof Error ? e.message : '가이드 생성 실패');
    } finally {
      setShotGuideLoading(false);
    }
  }

  async function handleSlotUpload(index: number, file: File) {
    const fd = new FormData(); fd.append('file', file); fd.append('usageContext', 'listing_detail');
    const r = await fetch('/api/listing/upload-image', { method: 'POST', body: fd });
    const j = await r.json() as { success: boolean; data?: { url: string }; error?: string };
    if (!j.success || !j.data?.url) { alert(j.error || '업로드 실패 (jpg/png/webp 형식으로 다시 시도하세요).'); return; }
    const url = j.data.url;
    setSlots(prev => prev.map((s, i) => i === index ? { ...s, uploadedUrl: url } : s));
  }

  async function handleRetouch(index: number) {
    const src = slots[index]?.uploadedUrl;
    if (!src) return;
    setRetouchLoading(index);
    try {
      const r = await fetch('/api/ai/retouch-photo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: src }),
      });
      const j = await r.json() as { success: boolean; url?: string; error?: string };
      if (!j.success || !j.url) { alert(j.error || '보정 실패'); return; }
      setRetouchPreview({ index, url: j.url });
    } catch (e) {
      alert(e instanceof Error ? e.message : '보정 실패');
    } finally {
      setRetouchLoading(null);
    }
  }
  function applyRetouch(index: number, url: string) {
    setSlots(prev => prev.map((s, i) => i === index ? { ...s, retouchedUrl: url } : s));
    setRetouchPreview(null);
  }

  function copyShotChecklist() {
    navigator.clipboard?.writeText(serializeShotChecklist(shotGuide ?? []));
  }

  function downloadShotChecklist() {
    const blob = new Blob([serializeShotChecklist(shotGuide ?? [])], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '촬영가이드.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

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

        {shootDrafts.length > 0 && (
          <div style={{ marginBottom: 16, padding: 12, background: '#1e1e2e', border: '1px solid #374151', borderRadius: 8 }}>
            <div style={{ fontSize: 13, color: '#a0a0b0', marginBottom: 8 }}>이어서 진행할 촬영</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {shootDrafts.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    const url = new URL(window.location.href);
                    url.searchParams.set('draftId', d.id);
                    window.location.href = url.toString();
                  }}
                  style={{ textAlign: 'left', padding: '8px 10px', borderRadius: 6, border: '1px solid #374151', background: 'transparent', color: '#e2e8f0', cursor: 'pointer', fontSize: '13px' }}
                >
                  {(d.productName || '(제목 없음)') + ' · 컷 ' + d.shotCount + '개 · ' + new Date(d.updatedAt).toLocaleDateString('ko-KR')}
                </button>
              ))}
            </div>
          </div>
        )}

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
              setOptionNames(prev => [...prev, ...newFiles.map(() => '')].slice(0, 4));
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
            onChange={e => {
              const files = Array.from(e.target.files ?? []).slice(0, 4);
              setProductImages(files);
              setOptionNames(files.map(() => ''));
              e.target.value = '';
            }}
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
                      onClick={e => {
                        e.stopPropagation();
                        setProductImages(prev => prev.filter((_, i) => i !== idx));
                        setOptionNames(prev => prev.filter((_, i) => i !== idx));
                      }}
                      style={{
                        position: 'absolute', top: 3, right: 3,
                        width: 18, height: 18, borderRadius: '50%',
                        background: 'rgba(0,0,0,0.65)', border: 'none',
                        color: '#fff', fontSize: 11, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        lineHeight: 1,
                      }}
                    >×</button>
                    <button
                      type="button"
                      title="워터마크 제거"
                      onClick={async e => {
                        e.stopPropagation();
                        const file = productImages[idx];
                        if (!file) return;
                        const { base64, mimeType } = await fileToDownscaledBase64(file, 2000);
                        setCleanupTarget({ index: idx, url, base64, mimeType });
                      }}
                      style={{
                        position: 'absolute', top: 3, left: 3,
                        width: 18, height: 18, borderRadius: '50%',
                        background: 'rgba(0,0,0,0.65)', border: 'none',
                        color: '#fff', fontSize: 10, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        lineHeight: 1,
                      }}
                    >✦</button>
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: '8px' }}>
                {prodPreviews.map((_, idx) => (
                  <input
                    key={idx}
                    type="text"
                    value={optionNames[idx] ?? ''}
                    onChange={e => {
                      const v = e.target.value.slice(0, 40);
                      setOptionNames(prev => {
                        const next = [...prev];
                        while (next.length <= idx) next.push('');
                        next[idx] = v;
                        return next;
                      });
                    }}
                    placeholder="옵션명"
                    style={{ ...inputStyle, padding: '6px 8px', fontSize: '12px' }}
                  />
                ))}
              </div>
              <p style={{ fontSize: '11px', color: '#6b7280', margin: '0 0 8px' }}>
                옵션명을 2개 이상 적으면 옵션별로 고르게 노출되는 상세페이지가 만들어집니다. (선택)
              </p>
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

        {(!productName.trim() || referenceImages.length === 0) && !isAnalyzing && (
          <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>
            {!productName.trim() && '상품명을 입력하세요.'}
            {!productName.trim() && referenceImages.length === 0 && ' '}
            {referenceImages.length === 0 && '참고 스크린샷을 1장 이상 올리세요.'}
          </p>
        )}
        <button
          onClick={handleAnalyze}
          disabled={isAnalyzing}
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
            opacity: isAnalyzing ? 0.5 : 1,
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

        {cleanupTarget && (
          <ImageCleanupModal
            mode="watermark"
            imageUrl={cleanupTarget.url}
            imageBase64={cleanupTarget.base64}
            mimeType={cleanupTarget.mimeType}
            canAdd={false}
            onReplace={() => setCleanupTarget(null)}
            onAdd={() => setCleanupTarget(null)}
            onClose={() => setCleanupTarget(null)}
            onResultBase64={(base64, mime) => {
              const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
              const ext = mime === 'image/png' ? 'png' : 'jpg';
              const file = new File([bytes], `cleaned-${cleanupTarget.index}.${ext}`, { type: mime });
              setProductImages(prev => prev.map((f, i) => (i === cleanupTarget.index ? file : f)));
              setCleanupTarget(null);
            }}
          />
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

  // ── Shoot Guide Screen ─────────────────────────────────────────────────────
  if (screen === 'shootguide') {
    const cards = shotGuide ?? [];
    return (
      <div style={containerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <h1 style={{ fontSize: '18px', fontWeight: 800 }}>📸 촬영 가이드</h1>
            <span style={{ fontSize: 12, color: '#a0a0b0' }}>업로드 {countUploaded(slots)}/{(shotGuide ?? []).length}</span>
          </div>
          <button
            type="button"
            onClick={() => setScreen('result')}
            style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '13px' }}
          >
            &larr; 뒤로
          </button>
        </div>
        <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
          아래 디테일 컷들을 폰으로 직접 찍어보세요. (라이프스타일 씬은 AI가 생성합니다.)
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {cards.map((c, i) => (
            <div
              key={i}
              style={{
                background: '#1e1e2e',
                border: '1px solid #374151',
                borderRadius: '8px',
                padding: '14px',
              }}
            >
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#e2e8f0', marginBottom: '6px' }}>
                {i + 1}. {c.subject}{' '}
                <span style={{ fontSize: '11px', color: '#6b7280' }}>[{c.sectionTitle}]</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: '4px', listStyle: 'none', fontSize: '13px', color: '#a0a0b0', lineHeight: 1.7 }}>
                <li>· 구도·각도: {c.angle}</li>
                <li>· 프레이밍: {c.framing}</li>
                <li>· 조명: {c.lighting}</li>
                <li>· 배경: {c.background}</li>
                <li style={{ color: '#6b7280' }}>· 팁: {c.tip}</li>
              </ul>
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                {slots[i]?.uploadedUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={slots[i]!.retouchedUrl ?? slots[i]!.uploadedUrl!} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, border: '1px solid #374151' }} />
                    <span style={{ fontSize: 12, color: '#4ade80' }}>완료</span>
                    {slots[i]?.retouchedUrl ? <span style={{ fontSize: 12, color: '#60a5fa' }}>보정됨</span> : null}
                  </>
                ) : null}
                <label style={{ fontSize: 12, color: '#e2e8f0', border: '1px solid #374151', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>
                  {slots[i]?.uploadedUrl ? '다시 업로드' : '사진 업로드'}
                  <input type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleSlotUpload(i, f); e.currentTarget.value = ''; }} />
                </label>
                {slots[i]?.uploadedUrl && (
                  <button type="button" onClick={() => handleRetouch(i)} disabled={retouchLoading === i}
                    style={{ fontSize: 12, color: '#e2e8f0', border: '1px solid #374151', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', background: 'transparent' }}>
                    {retouchLoading === i ? '보정 중…' : (slots[i]?.retouchedUrl ? '다시 보정' : 'AI 보정')}
                  </button>
                )}
              </div>
              {retouchPreview?.index === i && (
                <div style={{ marginTop: 8, padding: 8, border: '1px solid #374151', borderRadius: 6 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                    <div><div style={{ fontSize: 11, color: '#a0a0b0' }}>원본</div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={slots[i]!.uploadedUrl!} alt="" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 6 }} /></div>
                    <div><div style={{ fontSize: 11, color: '#60a5fa' }}>보정본</div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={retouchPreview.url} alt="" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 6 }} /></div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button type="button" onClick={() => applyRetouch(i, retouchPreview.url)}
                      style={{ fontSize: 12, color: '#fff', background: '#2563eb', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>적용</button>
                    <button type="button" onClick={() => setRetouchPreview(null)}
                      style={{ fontSize: 12, color: '#e2e8f0', border: '1px solid #374151', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', background: 'transparent' }}>원본 유지</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '16px' }}>
          <button
            type="button"
            onClick={copyShotChecklist}
            style={{
              padding: '10px 14px',
              background: '#1e1e2e',
              border: '1px solid #374151',
              borderRadius: '8px',
              color: '#e2e8f0',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            체크리스트 복사
          </button>
          <button
            type="button"
            onClick={downloadShotChecklist}
            style={{
              padding: '10px 14px',
              background: '#1e1e2e',
              border: '1px solid #374151',
              borderRadius: '8px',
              color: '#e2e8f0',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            다운로드 (.txt)
          </button>
        </div>
        <p style={{ fontSize: '11px', color: '#6b7280', marginTop: '12px' }}>
          찍은 사진을 각 컷에 업로드하세요. AI 보정은 다음 단계에서 적용됩니다.
        </p>
      </div>
    );
  }

  // ── Result Screen ──────────────────────────────────────────────────────────
  return (
    <div style={containerStyle}>
      {layoutWarnings.length > 0 && (
        <div style={{
          background: '#2a1f10',
          border: '1px solid #f59e0b',
          borderRadius: '8px',
          padding: '12px 14px',
          marginBottom: '16px',
          fontSize: '13px',
          color: '#fbbf24',
          lineHeight: 1.6,
        }}>
          <strong>생성 결과에서 확인할 점이 있습니다.</strong>
          {/* 각 경고 문구가 이미 스스로 행동을 안내한다(재생성/에디터 수정/실측값 입력) —
              공통 안내를 덧붙이면 hygiene 경고엔 "재생성" 조언이 거짓이 된다(수치가
              그대로 다시 사라진다). 그래서 여기엔 공통 문구를 두지 않는다. */}
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {layoutWarnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

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
            setShotGuide(null); setSlots([]); setProductImageUrls([]);
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
            try {

            // Step 1: 제품 이미지 업로드 → Supabase URL 확보
            let uploadedImageUrls: (string | null)[] = [];
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
                // 자리 유지 — imageRef는 업로드 전 productImages 인덱스 기준이라
                // 실패분을 당겨내면 화이트 슬롯에 블랙이 들어간다.
                .map((r) => (r.status === 'fulfilled' ? r.value : null));
            }

            // Step 2: 생성형 슬롯(flux_lifestyle=라이프스타일, detail_closeup=디테일 접사,
            // model_wearing=인물 착용컷) 섹션마다 Gemini 씬 생성.
            // generate-scene-image: 누끼 → 배경 생성 → 합성(model_wearing은 비합성 경로).
            const geminiUrlMap: Record<number, string> = {};

            // 재개 시 productImages(File) 없음 → 저장해둔 productImageUrls로 폴백
            const effectiveProductUrls: (string | null)[] =
              uploadedImageUrls.length > 0 ? uploadedImageUrls : productImageUrls;

            if (uploadedImageUrls.some((u) => u === null) && isOptionMode(deriveOptions(optionNames))) {
              setError('일부 이미지 업로드에 실패했습니다. 옵션 배분이 정확하지 않을 수 있습니다.');
            }
            // 실사진 override: 업로드된 detail_closeup이 그 섹션의 targeting gen 슬롯(genSlotIdx)일 때만.
            // model_wearing은 의도적으로 제외한다(GEN_SLOT_TYPES를 쓰지 않고 두 타입만 직접
            // 나열) — shot-guide는 detail_closeup 슬롯만 촬영 카드로 만들므로 업로드 사진은
            // 전부 제품 접사이고, 그것이 인물 씬 자리를 먹으면 "모델 착용컷이 없다"는 원래
            // 문제가 그대로 돌아온다.
            const realBySection: Record<number, string> = {};
            for (const sl of slots) {
              const u = resolveSlotUrl(sl);
              if (!u) continue;
              const sec = generatedSections[sl.sectionIndex];
              const genSlotIdx = (sec?.imageSlots ?? []).findIndex(
                x => x.slotType === 'flux_lifestyle' || x.slotType === 'detail_closeup',
              );
              if (genSlotIdx === sl.slotIndex) realBySection[sl.sectionIndex] = u;
            }
            Object.assign(geminiUrlMap, realBySection);

            if (effectiveProductUrls.length > 0) {
              if (editBtn) editBtn.textContent = 'AI 이미지 생성 중...';

              // resolveGenSlot(gen-slots.ts) 하나만 쓴다 — 이 생성 루프와 아래 렌더
              // 조립부(genSlotIdx)가 서로 다른 판정을 쓰면 "검증 통과, 이미지 없음"이
              // 조용히 재발한다.
              const genItems = generatedSections
                .map((s, i) => ({ s, i, genSlot: resolveGenSlot(s.imageSlots) }))
                .filter(({ i, genSlot }) => realBySection[i] === undefined && genSlot !== null);

              await Promise.allSettled(
                genItems.map(async ({ s, i, genSlot }) => {
                  try {
                    const slot = genSlot ? s.imageSlots?.[genSlot.index] : undefined;
                    // 옵션 모드에선 다른 옵션 사진이 섞이면 Gemini가 색을 섞는다 →
                    // imageRef가 가리키는 1장만(같은 옵션명이면 최대 2장) 보낸다.
                    const options = deriveOptions(optionNames);
                    const optionMode = isOptionMode(options);
                    const nameByIdx = new Map(options.map(o => [o.imageIndex, o.name]));
                    const ref = typeof slot?.imageRef === 'number' ? slot.imageRef : null;
                    const primary = ref !== null ? effectiveProductUrls[ref] ?? null : null;

                    let refImages: string[];
                    if (optionMode) {
                      if (!primary || ref === null) return; // 해당 옵션 이미지가 없으면 이 슬롯은 건너뛴다
                      const refName = nameByIdx.get(ref);
                      const sameOption = effectiveProductUrls
                        .map((u, idx) => ({ u, idx }))
                        .filter(({ u, idx }) => !!u && idx !== ref && nameByIdx.get(idx) === refName)
                        .map(({ u }) => u as string);
                      refImages = [primary, ...sameOption].slice(0, 2);
                    } else {
                      const available = effectiveProductUrls.filter((u): u is string => !!u);
                      refImages = primary ? [primary, ...available].slice(0, 2) : available.slice(0, 2);
                    }
                    if (refImages.length === 0) return;
                    // sceneTypeFor가 model_wearing만 'wearing'으로 매핑하므로
                    // sceneType === 'wearing'과 slot?.slotType === 'model_wearing'은
                    // 같은 사실이다 — 한 번만 계산해 두 판정을 만들지 않는다.
                    const sceneType = sceneTypeFor(slot?.slotType);
                    const sceneRes = await fetch('/api/ai/generate-scene-image', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        sectionType: sceneType,
                        // wearing 전용: 얼굴 노출과 모델 성별. 자연어 sceneHint로는
                        // 서버가 수위를 판정할 수 없어 필드로 보낸다.
                        // 기본값은 route.ts의 Zod가 채우므로 여기서 ??를 쓰지 않는다 —
                        // 두 계층이 각각 기본값을 주면 한쪽만 바뀔 때 경로에 따라
                        // 동작이 갈린다. undefined는 JSON에서 사라지고 Zod가 채운다.
                        ...(sceneType === 'wearing' && {
                          wearing: { faceVisible: slot?.faceVisible, gender: slot?.modelGender },
                        }),
                        productImageUrls: refImages,
                        // scenePrompt(직결) 대신 sceneHint로 전달 → Claude 프롬프트 정교화
                        // (조명·앵글·무드 + anti-AI 규칙) 단계를 경유해 씬 품질을 높인다.
                        // zod가 600자로 제한한다(generate-scene-image/route.ts의 sceneHint).
                        // 넘기면 400이 나고 아래 catch가 삼켜 이 섹션 이미지만 조용히 사라진다.
                        sceneHint: (() => {
                          const optionName = ref !== null ? nameByIdx.get(ref) : undefined;
                          const base = slot?.promptHint ?? '';
                          const withOption = optionName ? `${base} (제품 색상: ${optionName})` : base;
                          return withOption.slice(0, 600);
                        })(),
                        productInfo: { headline: productName },
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

            // Step 3: 섹션 조립. Claude가 imageSlots로 선언한 섹션에만 이미지를 배치한다.
            // (텍스트/공지/배송 등 슬롯 없는 섹션에 제품 사진을 강제로 넣지 않는다.)
            // 조립하면서 이미지-카피 정합성 재료를 모은다 — 최종 URL이 정해지는 게
            // 여기라, 생성 단계 validator는 볼 수 없는 정보다(image-hygiene.ts 참고).
            let fallbackSections = 0;
            let strippedClaims = 0;
            const headingClaims: string[] = [];
            const sectionImages: SectionImages[] = [];

            const detailSections = generatedSections.map((s, i) => {
              const geminiUrl = geminiUrlMap[i];
              const slots = s.imageSlots ?? [];
              // 생성 씬을 만든 슬롯 위치에 넣는다. 위 생성 루프와 반드시 같은 함수
              // (resolveGenSlot)를 써야 한다 — 각자 findIndex를 하드코딩하면
              // "검증 통과, 이미지 없음"이 재발한다.
              const genSlotIdx = resolveGenSlot(slots)?.index ?? -1;

              const attachedImages = slots
                .map((slot, idx) => {
                  // Claude가 지정한 imageRef(실물 보고 고른 인덱스)를 우선 사용.
                  // 없으면 (섹션+슬롯) 로테이션으로 폴백.
                  const refIdx =
                    typeof slot.imageRef === 'number' ? slot.imageRef : i + idx;
                  const chosen =
                    effectiveProductUrls.length > 0
                      ? effectiveProductUrls[refIdx % effectiveProductUrls.length]
                      : undefined;
                  // 생성 씬 슬롯 → Gemini 씬, 그 외 슬롯 → imageRef/로테이션 제품 이미지.
                  const url =
                    idx === genSlotIdx && geminiUrl ? geminiUrl : (chosen ?? '');
                  return { url, order: idx, processingMode: 'original' as const };
                })
                .filter(item => item.url);

              // 렌더러는 attachedImages를 직접 그리지 않고 blocks의 image 블록으로만
              // 그린다 → 실제 이미지 개수에 맞춰 attachedIndex 리매핑 + image 블록
              // 부재 시 주입. 이게 없으면 첫 섹션 외 나머지 슬롯 이미지가 누락된다.
              let blocks = normalizeImageBlocks(
                (s as Record<string, unknown>).blocks as LayoutBlock[] | undefined,
                attachedImages.length,
              );

              // 씬 생성이 실패해 원본 전체컷으로 대체된 섹션에서는 "접사입니다" 류
              // 문구가 거짓이 된다. 사진을 바꿀 수 없으니 카피를 사진에 맞춘다.
              if (genSlotIdx >= 0 && !geminiUrl) {
                fallbackSections++;
                const stripped = stripCloseupClaims(blocks);
                blocks = stripped.blocks as LayoutBlock[];
                strippedClaims += stripped.removed;
                headingClaims.push(...stripped.headingClaims);
              }

              sectionImages.push({
                title: s.title ?? `섹션 ${i + 1}`,
                urls: attachedImages.map((a) => a.url),
              });

              return {
                id: crypto.randomUUID(),
                type: 'claude_layout' as const,
                order: i,
                content: {
                  type: 'claude_layout' as const,
                  title: s.title ?? `섹션 ${i + 1}`,
                  blocks,
                  bgStyle: (s as Record<string, unknown>).bgStyle,
                  padding: (s as Record<string, unknown>).padding,
                  imageSlots: s.imageSlots,
                },
                attachedImages,
              };
            });

            // 조립 결과 경고를 생성 단계 경고 뒤에 덧붙인다. 에디터로 넘어가기 전
            // 이 화면에서 보여주므로, 셀러가 사진을 더 올릴지 그대로 갈지 판단할 수 있다.
            const hygiene = imageHygieneWarnings({
              reused: findReusedImages(sectionImages),
              fallbackSections,
              strippedClaims,
              headingClaims,
            });
            if (hygiene.length > 0) {
              setLayoutWarnings((prev) => [...prev, ...hygiene]);
            }

            sessionStorage.setItem('pro_sections', JSON.stringify(detailSections));
            sessionStorage.setItem('pro_meta', JSON.stringify({
              productName,
              uploadedImageUrls: effectiveProductUrls.filter((u): u is string => !!u),
            }));
            router.push('/listing/detail-maker');
            } catch (err) {
              // 업로드/씬 생성/조립 중 실패 시 버튼을 되살리고 원인을 표시한다
              // (onClickCapture에서 비활성화만 하므로 catch가 없으면 영구 잠긴다).
              console.error('[pro apply] 오류:', err);
              if (editBtn) {
                editBtn.disabled = false;
                editBtn.textContent = '에디터에서 편집 →';
              }
              const msg = err instanceof Error ? err.message : String(err);
              setError(`적용 중 오류가 발생했습니다: ${msg}`);
              if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
            }
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

      <button
        type="button"
        onClick={handleShotGuide}
        disabled={shotGuideLoading}
        style={{
          width: '100%',
          marginTop: '10px',
          padding: '12px',
          background: '#1e1e2e',
          border: '1px solid #374151',
          borderRadius: '8px',
          color: '#e2e8f0',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: 700,
          opacity: shotGuideLoading ? 0.5 : 1,
        }}
      >
        {shotGuideLoading ? '가이드 생성 중…' : '📸 촬영 가이드 만들기'}
      </button>
    </div>
  );
}
