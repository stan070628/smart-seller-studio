'use client';

/**
 * Step1SourceSelect.tsx
 * Step 1 — 썸네일 만들기 / 상품 상세 만들기 / 상품 기본 정보
 *
 * 섹션 구조:
 * ① 썸네일 만들기 — 1장 업로드 + AI 편집 인라인 프롬프트
 * ② 상품 상세 만들기 — [이미지로 만들기] / [URL로 가져오기] 탭
 * ③ 상품 기본 정보 — PriceWithMarginCalc 유지
 */

import React, { useMemo, useRef, useState } from 'react';
import {
  Upload, X, ChevronRight, AlertTriangle, CheckCircle, RefreshCw,
  Calculator, Wand2, Link,
} from 'lucide-react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';
import { calcCoupangWing, calcNaver } from '@/lib/calculator/calculate';
import { getCoupangFeeFromPath } from '@/lib/calculator/fees';
import AiEditModal from '@/components/listing/AiEditModal';

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
// 타입
// ─────────────────────────────────────────────────────────────────────────────
interface DetailImage {
  id: string;
  url: string;
  file?: File;
  name: string;
}

interface ChannelPricing {
  minPrice: number;
  recommendedPrice: number;
  feeRate: number;
}

interface DomeggookResult {
  thumbnail: { processedUrl: string };
  detail: { processedHtml: string; failedImageCount: number };
  source: { title: string; licenseUsable: boolean };
  pricing: {
    priceDome: number;
    moq: number;
    costTotal: number;
    strategy: string | null;
    deliWho: string | null;
    deliFee: number | null;
    naver: ChannelPricing;
    coupang: ChannelPricing;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────────────────
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function loadDomeggookSellerDefaults() {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('sss_domeggook_seller_defaults') : null;
    if (raw) return JSON.parse(raw) as { sellerName: string; sellerBrandName: string; csPhone: string; csHours: string; returnAddress: string };
  } catch { /* ignore */ }
  return { sellerName: '', sellerBrandName: '', csPhone: '', csHours: '', returnAddress: '' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export default function Step1SourceSelect() {
  const { sharedDraft, updateSharedDraft, goNextStep } = useListingStore();

  // ─── ① 썸네일 ──────────────────────────────────────────────────────────────
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreviewUrl, setThumbnailPreviewUrl] = useState<string | null>(
    () => sharedDraft.thumbnailImages[0] ?? null
  );
  const thumbInputRef = useRef<HTMLInputElement>(null);
  const [showAiEdit, setShowAiEdit] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');

  // ─── ② 상세 탭 ─────────────────────────────────────────────────────────────
  const [detailTab, setDetailTab] = useState<'image' | 'url'>('image');

  // ─── ② 이미지 탭 ───────────────────────────────────────────────────────────
  const [detailImages, setDetailImages] = useState<DetailImage[]>(() =>
    sharedDraft.detailImages.map((url) => ({
      id: url,
      url,
      name: url.split('/').pop() ?? 'image',
    }))
  );
  const [detailDragOver, setDetailDragOver] = useState(false);
  const detailFileInputRef = useRef<HTMLInputElement>(null);
  const MAX_DETAIL = 10;

  // ─── ② URL 탭 (도매꾹 + 일반 URL 통합) ────────────────────────────────────
  const [urlInput, setUrlInput] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlSuccess, setUrlSuccess] = useState(false);
  const [urlExtractedPrice, setUrlExtractedPrice] = useState<number | null>(null);

  // URL 입력값 타입 감지
  const urlInputType = useMemo((): 'domeggook' | 'url' | 'empty' => {
    const v = urlInput.trim();
    if (!v) return 'empty';
    if (/^\d+$/.test(v)) return 'domeggook';
    if (v.startsWith('http://') || v.startsWith('https://')) return 'url';
    return 'empty';
  }, [urlInput]);

  // ─── AI 편집 모달 ───────────────────────────────────────────────────────────
  const [aiEditModal, setAiEditModal] = useState<{
    open: boolean;
    imageUrl: string;
    imageFile: File | null;
    initialPrompt?: string;
    /** 편집 대상: 썸네일이면 undefined, 상세이미지면 해당 id */
    detailImageId?: string;
  } | null>(null);

  // ─── 통합 URL 가져오기 핸들러 ───────────────────────────────────────────────
  const handleUnifiedFetch = async () => {
    if (urlInputType === 'empty' || urlLoading || urlSuccess) return;
    setUrlLoading(true);
    setUrlError(null);
    try {
      if (urlInputType === 'domeggook') {
        const defaults = loadDomeggookSellerDefaults();
        const body = {
          itemNo: parseInt(urlInput.trim(), 10),
          sellerName: defaults.sellerName || '셀러',
          csPhone: defaults.csPhone || '000-0000-0000',
          csHours: defaults.csHours || '평일 10:00~17:00',
          ...(defaults.sellerBrandName ? { sellerBrandName: defaults.sellerBrandName } : {}),
          ...(defaults.returnAddress ? { returnAddress: defaults.returnAddress } : {}),
        };
        const res = await fetch('/api/listing/domeggook/prepare', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok || !json.success) { setUrlError(json.error ?? '상품을 불러오지 못했습니다.'); return; }
        const data = json.data as DomeggookResult;
        const effectiveDeliFee = data.pricing.deliWho === 'S' ? 0 : (data.pricing.deliFee ?? 0);
        // 썸네일도 함께 채우기 (직접 업로드한 파일이 없을 때만)
        if (!thumbnailFile) {
          setThumbnailPreviewUrl(data.thumbnail.processedUrl);
          updateSharedDraft({ thumbnailImages: [data.thumbnail.processedUrl] });
        }
        updateSharedDraft({
          name: data.source.title,
          description: data.detail.processedHtml,
          rawImageFiles: [],
          detailPageSkipped: true,
          costPrice: String(data.pricing.priceDome),
          naverPrice: String(data.pricing.naver.recommendedPrice),
          coupangPrice: String(data.pricing.coupang.recommendedPrice),
          salePrice: String(data.pricing.coupang.recommendedPrice),
          ...(effectiveDeliFee > 0
            ? { deliveryCharge: String(effectiveDeliFee), deliveryChargeType: 'NOT_FREE' as const }
            : { deliveryChargeType: 'FREE' as const, deliveryCharge: '0' }),
        });
        setUrlExtractedPrice(data.pricing.priceDome);
        const { fetchOptions } = useListingStore.getState();
        fetchOptions(parseInt(urlInput.trim(), 10));
      } else {
        // 일반 URL 스크랩
        const res = await fetch('/api/listing/url-scrape', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: urlInput.trim() }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) { setUrlError(json.error ?? '상품을 불러오지 못했습니다.'); return; }
        const data = json.data;
        if (!thumbnailFile && data.thumbnail?.processedUrl) {
          setThumbnailPreviewUrl(data.thumbnail.processedUrl);
          updateSharedDraft({ thumbnailImages: [data.thumbnail.processedUrl] });
        }
        updateSharedDraft({
          name: data.title || '',
          description: data.detailHtml,
          rawImageFiles: [],
          detailPageSkipped: true,
          ...(data.extractedPrice ? { costPrice: String(data.extractedPrice) } : {}),
        });
        setUrlExtractedPrice(data.extractedPrice ?? null);
      }
      setUrlSuccess(true);
    } catch {
      setUrlError('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setUrlLoading(false);
    }
  };

  // ─── 다음 단계 활성 조건 ────────────────────────────────────────────────────
  const canProceed =
    thumbnailFile !== null ||
    sharedDraft.thumbnailImages.length >= 1;

  const blockedReason = !canProceed
    ? '썸네일 이미지를 업로드하거나 URL로 상품을 가져와 주세요.'
    : null;

  const handleNext = () => {
    if (!canProceed) return;
    goNextStep();
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* 섹션 ① — 썸네일 만들기 */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '20px 24px' }}>
        {/* 섹션 헤더 */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '22px', height: '22px', borderRadius: '50%',
                backgroundColor: C.accent, color: '#fff', fontSize: '12px', fontWeight: 800, flexShrink: 0,
              }}
            >1</span>
            <span style={{ fontSize: '15px', fontWeight: 800, color: C.text }}>썸네일 만들기</span>
            {/* AI 편집 뱃지 */}
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '3px',
                fontSize: '10px', fontWeight: 700,
                padding: '2px 7px', borderRadius: '100px',
                backgroundColor: 'rgba(37,99,235,0.1)', color: '#2563eb',
                border: '1px solid rgba(37,99,235,0.2)',
              }}
            >
              <Wand2 size={10} /> AI 편집
            </span>
          </div>
          <p style={{ margin: '0 0 0 30px', fontSize: '12px', color: C.textSub }}>
            상품 대표 이미지를 업로드하세요. AI로 배경 제거, 색상 보정 등 편집이 가능합니다.
          </p>
        </div>

        {/* 상태 A: 썸네일 없음 → 드롭존 */}
        {!thumbnailFile && !sharedDraft.thumbnailImages[0] ? (
          <div
            role="button"
            tabIndex={0}
            onClick={() => thumbInputRef.current?.click()}
            onKeyDown={(e) => e.key === 'Enter' && thumbInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (!file || !file.type.match(/^image\/(jpeg|png|webp)$/)) return;
              if (thumbnailPreviewUrl) URL.revokeObjectURL(thumbnailPreviewUrl);
              const objUrl = URL.createObjectURL(file);
              setThumbnailFile(file);
              setThumbnailPreviewUrl(objUrl);
              updateSharedDraft({ thumbnailImages: [objUrl], rawImageFiles: [file] });
            }}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: '10px', padding: '32px 16px', borderRadius: '10px',
              border: `2px dashed ${C.border}`,
              backgroundColor: C.tableHeader,
              cursor: 'pointer',
            }}
          >
            <Upload size={24} color={C.textSub} />
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '13px', color: C.textSub, margin: 0 }}>
                드래그하거나 <span style={{ color: C.accent, fontWeight: 600 }}>클릭하여 선택</span>
              </p>
              <p style={{ fontSize: '11px', color: C.textSub, margin: '4px 0 0' }}>JPEG, PNG, WEBP — 1장</p>
            </div>
          </div>
        ) : (
          /* 상태 B: 썸네일 있음 → 미리보기 */
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', backgroundColor: C.tableHeader, borderRadius: '10px', border: `1px solid ${C.border}` }}>
              {/* 썸네일 미리보기 80×80 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbnailPreviewUrl || sharedDraft.thumbnailImages[0]}
                alt="썸네일"
                style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0, border: `1px solid ${C.border}` }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: '13px', fontWeight: 600, color: C.text, margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {thumbnailFile ? thumbnailFile.name : '외부 이미지'}
                </p>
                {thumbnailFile && (
                  <p style={{ fontSize: '11px', color: C.textSub, margin: '0 0 8px' }}>{formatFileSize(thumbnailFile.size)}</p>
                )}
                <div style={{ display: 'flex', gap: '8px' }}>
                  {/* AI로 편집 버튼 */}
                  <button
                    onClick={() => setShowAiEdit(v => !v)}
                    style={{
                      padding: '6px 12px', fontSize: '12px', fontWeight: 700,
                      backgroundColor: showAiEdit ? 'rgba(37,99,235,0.12)' : 'rgba(37,99,235,0.07)',
                      color: '#2563eb',
                      border: `1px solid rgba(37,99,235,0.3)`,
                      borderRadius: '7px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '5px',
                    }}
                  >
                    <Wand2 size={12} /> AI로 편집
                  </button>
                  {/* 변경 버튼 */}
                  <button
                    onClick={() => {
                      if (thumbnailPreviewUrl) URL.revokeObjectURL(thumbnailPreviewUrl);
                      setThumbnailFile(null);
                      setThumbnailPreviewUrl(null);
                      setShowAiEdit(false);
                      setAiPrompt('');
                      thumbInputRef.current?.click();
                    }}
                    style={{
                      padding: '6px 12px', fontSize: '12px', fontWeight: 600,
                      backgroundColor: '#fff', color: C.textSub,
                      border: `1px solid ${C.border}`, borderRadius: '7px', cursor: 'pointer',
                    }}
                  >
                    변경
                  </button>
                </div>
              </div>
            </div>

            {/* AI 편집 인라인 박스 */}
            {showAiEdit && (thumbnailFile || sharedDraft.thumbnailImages[0]) && (
              <div
                style={{
                  marginTop: '12px', padding: '14px 16px',
                  background: 'rgba(37,99,235,0.04)',
                  border: '1px solid rgba(37,99,235,0.2)',
                  borderRadius: '10px',
                }}
              >
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#2563eb', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Wand2 size={11} /> AI 편집 프롬프트
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    style={{ ...inputStyle, flex: 1, border: '1px solid rgba(37,99,235,0.3)' }}
                    type="text"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="예: 배경을 흰색으로 바꿔줘 / 그림자 제거 / 상품 밝기 높여줘"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const url = thumbnailPreviewUrl || sharedDraft.thumbnailImages[0];
                        if (url) setAiEditModal({ open: true, imageUrl: url, imageFile: thumbnailFile, initialPrompt: aiPrompt });
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      const url = thumbnailPreviewUrl || sharedDraft.thumbnailImages[0];
                      if (url) setAiEditModal({ open: true, imageUrl: url, imageFile: thumbnailFile, initialPrompt: aiPrompt });
                    }}
                    style={{
                      padding: '9px 16px', fontSize: '12px', fontWeight: 700,
                      backgroundColor: '#2563eb', color: '#fff',
                      border: 'none', borderRadius: '8px', cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    생성
                  </button>
                </div>
                <p style={{ fontSize: '11px', color: '#93c5fd', marginTop: '6px' }}>
                  자연어로 원하는 편집 내용을 입력하면 AI가 처리합니다.
                </p>
              </div>
            )}
          </div>
        )}

        {/* hidden file input — 썸네일 1장 */}
        <input
          ref={thumbInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (thumbnailPreviewUrl) URL.revokeObjectURL(thumbnailPreviewUrl);
            const objUrl = URL.createObjectURL(file);
            setThumbnailFile(file);
            setThumbnailPreviewUrl(objUrl);
            setShowAiEdit(false);
            setAiPrompt('');
            updateSharedDraft({ thumbnailImages: [objUrl], rawImageFiles: [file] });
            e.target.value = '';
          }}
        />
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* 섹션 ② — 상품 상세 만들기 */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '20px 24px' }}>
        {/* 섹션 헤더 */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '22px', height: '22px', borderRadius: '50%',
                backgroundColor: '#2563eb', color: '#fff', fontSize: '12px', fontWeight: 800, flexShrink: 0,
              }}
            >2</span>
            <span style={{ fontSize: '15px', fontWeight: 800, color: C.text }}>상품 상세 만들기</span>
          </div>
          <p style={{ margin: '0 0 0 30px', fontSize: '12px', color: C.textSub }}>
            이미지를 직접 올리거나 URL을 입력하면 AI가 상세페이지를 생성합니다.
          </p>
        </div>

        {/* 탭 2개 */}
        <div style={{ display: 'flex', borderRadius: '10px', overflow: 'hidden', marginBottom: '16px', border: `1px solid ${C.border}` }}>
          {(
            [
              { value: 'image' as const, label: '🖼 이미지로 만들기' },
              { value: 'url' as const, label: '🔗 URL로 가져오기' },
            ]
          ).map((tab) => (
            <button
              key={tab.value}
              onClick={() => setDetailTab(tab.value)}
              style={{
                flex: 1, padding: '10px 0', fontSize: '13px', fontWeight: 700,
                border: 'none', cursor: 'pointer',
                backgroundColor: detailTab === tab.value ? C.accent : C.tableHeader,
                color: detailTab === tab.value ? '#fff' : C.textSub,
                transition: 'background-color 0.15s, color 0.15s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── 이미지 탭 ──────────────────────────────────────────────────── */}
        {detailTab === 'image' && (
          <div>
            <p style={{ fontSize: '12px', color: C.textSub, margin: '0 0 12px' }}>
              상세페이지에 들어갈 이미지를 올려주세요. AI가 분석해 상세페이지를 자동 생성합니다 (최대 10장).
            </p>

            {/* 드롭존 */}
            <div
              onClick={() => detailFileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDetailDragOver(true); }}
              onDragLeave={() => setDetailDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDetailDragOver(false);
                const files = Array.from(e.dataTransfer.files).filter(f => f.type.match(/^image\/(jpeg|png|webp)$/));
                const remaining = MAX_DETAIL - detailImages.length;
                const toAdd: DetailImage[] = files.slice(0, remaining).map(file => ({ id: generateId(), url: URL.createObjectURL(file), file, name: file.name }));
                setDetailImages(prev => {
                  const updated = [...prev, ...toAdd];
                  updateSharedDraft({ detailImageFiles: updated.map(d => d.file).filter((f): f is File => f !== undefined), detailImages: updated.map(d => d.url), detailPageSkipped: false });
                  return updated;
                });
              }}
              style={{
                border: `2px dashed ${detailDragOver ? C.accent : C.border}`, borderRadius: '8px', padding: '16px',
                textAlign: 'center', cursor: 'pointer',
                backgroundColor: detailDragOver ? 'rgba(190,0,20,0.03)' : '#fafafa',
                marginBottom: detailImages.length > 0 ? '12px' : 0,
              }}
            >
              <p style={{ margin: 0, fontSize: '13px', color: C.textSub }}>
                {detailImages.length >= MAX_DETAIL
                  ? `최대 ${MAX_DETAIL}장 업로드 완료`
                  : `클릭하거나 드래그하여 추가 (${detailImages.length}/${MAX_DETAIL}장)`}
              </p>
            </div>

            <input
              ref={detailFileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                if (!e.target.files) return;
                const files = Array.from(e.target.files).filter(f => f.type.match(/^image\/(jpeg|png|webp)$/));
                const remaining = MAX_DETAIL - detailImages.length;
                const toAdd: DetailImage[] = files.slice(0, remaining).map(file => ({ id: generateId(), url: URL.createObjectURL(file), file, name: file.name }));
                setDetailImages(prev => {
                  const updated = [...prev, ...toAdd];
                  updateSharedDraft({ detailImageFiles: updated.map(d => d.file).filter((f): f is File => f !== undefined), detailImages: updated.map(d => d.url), detailPageSkipped: false });
                  return updated;
                });
                e.target.value = '';
              }}
            />

            {/* 이미지 그리드 */}
            {detailImages.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px' }}>
                {detailImages.map((img, idx) => (
                  <div
                    key={img.id}
                    style={{ position: 'relative', borderRadius: '8px', border: `1px solid ${C.border}`, overflow: 'hidden', backgroundColor: C.tableHeader }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="" style={{ width: '100%', height: '80px', objectFit: 'cover', display: 'block' }} />
                    {/* 순번 배지 */}
                    <div style={{ position: 'absolute', top: '4px', left: '4px', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: '10px', color: '#fff', fontWeight: 700 }}>{idx + 1}</span>
                    </div>
                    {/* 삭제 버튼 */}
                    <button
                      onClick={() => {
                        URL.revokeObjectURL(img.url);
                        setDetailImages(prev => {
                          const updated = prev.filter(d => d.id !== img.id);
                          updateSharedDraft({ detailImageFiles: updated.map(d => d.file).filter((f): f is File => f !== undefined), detailImages: updated.map(d => d.url), detailPageSkipped: false });
                          return updated;
                        });
                      }}
                      style={{ position: 'absolute', top: '4px', right: '4px', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.55)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <X size={10} color="#fff" />
                    </button>
                    {/* AI 편집 버튼 */}
                    <button
                      onClick={() => setAiEditModal({ open: true, imageUrl: img.url, imageFile: img.file ?? null, detailImageId: img.id })}
                      style={{ width: '100%', padding: '4px', fontSize: '10px', fontWeight: 600, backgroundColor: 'rgba(190,0,20,0.07)', color: C.accent, border: 'none', cursor: 'pointer', borderTop: `1px solid ${C.border}` }}
                    >
                      AI 편집
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── URL 탭 ─────────────────────────────────────────────────────── */}
        {detailTab === 'url' && (
          <div>
            <p style={{ fontSize: '12px', color: C.textSub, margin: '0 0 12px' }}>
              도매꾹 상품번호 또는 상품 페이지 URL을 입력하면 이미지와 정보를 자동으로 가져옵니다.
            </p>

            {/* 입력 필드 */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <input
                style={{
                  ...inputStyle,
                  flex: 1,
                  border: `1px solid ${urlInputType === 'domeggook' ? '#16a34a' : urlInputType === 'url' ? '#9333ea' : C.border}`,
                  backgroundColor: urlInputType === 'domeggook' ? 'rgba(22,163,74,0.03)' : urlInputType === 'url' ? 'rgba(147,51,234,0.03)' : '#fff',
                }}
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="도매꾹 상품번호(숫자) 또는 https://... URL"
                disabled={urlSuccess}
                onKeyDown={(e) => { if (e.key === 'Enter') handleUnifiedFetch(); }}
              />
              <button
                onClick={handleUnifiedFetch}
                disabled={urlInputType === 'empty' || urlLoading || urlSuccess}
                style={{
                  padding: '9px 16px', fontSize: '13px', fontWeight: 600,
                  backgroundColor: (urlInputType !== 'empty' && !urlLoading && !urlSuccess) ? C.accent : '#ccc',
                  color: '#fff', border: 'none', borderRadius: '8px',
                  cursor: (urlInputType !== 'empty' && !urlLoading && !urlSuccess) ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                {urlLoading ? (
                  <>
                    <div style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    불러오는 중...
                  </>
                ) : (
                  <><Link size={14} />가져오기</>
                )}
              </button>
            </div>

            {/* 힌트 뱃지 (성공 전에만 표시) */}
            {!urlSuccess && (
              <div style={{ marginBottom: '12px' }}>
                {urlInputType === 'empty' && (
                  <span style={{ fontSize: '11px', color: C.textSub, padding: '3px 8px', backgroundColor: C.tableHeader, borderRadius: '100px', border: `1px solid ${C.border}` }}>
                    숫자만 입력하면 도매꾹 · https://로 시작하면 URL 스크랩
                  </span>
                )}
                {urlInputType === 'domeggook' && (
                  <span style={{ fontSize: '11px', color: '#16a34a', padding: '3px 8px', backgroundColor: 'rgba(22,163,74,0.06)', borderRadius: '100px', border: '1px solid rgba(22,163,74,0.3)' }}>
                    도매꾹 상품번호로 인식됩니다 · 이미지·상세페이지·가격 자동 완성
                  </span>
                )}
                {urlInputType === 'url' && (
                  <span style={{ fontSize: '11px', color: '#9333ea', padding: '3px 8px', backgroundColor: 'rgba(147,51,234,0.06)', borderRadius: '100px', border: '1px solid rgba(147,51,234,0.3)' }}>
                    상품 URL로 인식됩니다 · 이미지 스크랩 후 AI 상세페이지 생성
                  </span>
                )}
              </div>
            )}

            {/* 로딩 중 */}
            {urlLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', fontSize: '12px', color: '#1d4ed8', marginBottom: '12px' }}>
                <div style={{ width: '14px', height: '14px', border: '2px solid rgba(29,78,216,0.3)', borderTopColor: '#1d4ed8', borderRadius: '50%', flexShrink: 0, animation: 'spin 0.8s linear infinite' }} />
                페이지를 분석하고 상품 정보를 가져오는 중입니다...
              </div>
            )}

            {/* 에러 */}
            {urlError && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px 12px', backgroundColor: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', fontSize: '12px', color: '#b91c1c', marginBottom: '12px' }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                {urlError}
              </div>
            )}

            {/* 성공 */}
            {urlSuccess && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', backgroundColor: '#dcfce7', border: '1px solid #86efac', borderRadius: '8px', fontSize: '12px', color: '#15803d' }}>
                  <CheckCircle size={14} />
                  <span>가져오기 완료 — 상품 기본 정보가 자동으로 채워졌습니다.</span>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px', backgroundColor: C.tableHeader, borderRadius: '8px' }}>
                  {/* 썸네일 미리보기 */}
                  {(thumbnailPreviewUrl || sharedDraft.thumbnailImages[0]) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbnailPreviewUrl || sharedDraft.thumbnailImages[0]}
                      alt="대표이미지"
                      style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: C.text, margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sharedDraft.name || '—'}
                    </p>
                    <p style={{ fontSize: '12px', color: '#15803d', margin: '0 0 2px' }}>
                      ✓ 이미지·상세페이지 자동 완성
                    </p>
                    {urlExtractedPrice && (
                      <p style={{ fontSize: '11px', color: '#f59e0b', margin: 0 }}>
                        ⚠ 수집 가격 {urlExtractedPrice.toLocaleString()}원 → 구입가(원가)에 입력됨
                      </p>
                    )}
                  </div>
                  {/* 초기화 버튼 */}
                  <button
                    onClick={() => {
                      setUrlSuccess(false);
                      setUrlInput('');
                      setUrlExtractedPrice(null);
                      setUrlError(null);
                      // 직접 업로드한 썸네일이 없었던 경우(URL로 자동 채워진 경우)만 초기화
                      if (!thumbnailFile) {
                        setThumbnailPreviewUrl(null);
                        updateSharedDraft({
                          thumbnailImages: [],
                          name: '', description: '', rawImageFiles: [], detailPageSkipped: false,
                          costPrice: '', naverPrice: '', coupangPrice: '', salePrice: '',
                        });
                      } else {
                        updateSharedDraft({
                          name: '', description: '', rawImageFiles: [], detailPageSkipped: false,
                          costPrice: '', naverPrice: '', coupangPrice: '', salePrice: '',
                        });
                      }
                    }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textSub, padding: '2px', flexShrink: 0 }}
                    title="초기화"
                  >
                    <RefreshCw size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* 섹션 ③ — 상품 기본 정보 */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '22px', height: '22px', borderRadius: '50%',
              backgroundColor: '#f59e0b', color: '#fff',
              fontSize: '12px', fontWeight: 800, flexShrink: 0,
            }}
          >3</span>
          <span style={{ fontSize: '15px', fontWeight: 800, color: C.text }}>상품 기본 정보</span>
        </div>

        {/* 1행: 상품명 + 플랫폼 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '16px', alignItems: 'start' }}>
          <div>
            <label style={labelStyle}>상품명</label>
            <input
              style={inputStyle}
              type="text"
              value={sharedDraft.name}
              onChange={(e) => updateSharedDraft({ name: e.target.value })}
              placeholder="상품명을 입력하세요"
            />
          </div>
          <div>
            <label style={labelStyle}>등록 플랫폼</label>
            <div style={{ display: 'flex', gap: '12px' }}>
              {(
                [
                  { value: 'both', label: '쿠팡 + 네이버' },
                  { value: 'coupang', label: '쿠팡만' },
                  { value: 'naver', label: '네이버만' },
                ] as const
              ).map((opt) => (
                <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: C.text, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <input
                    type="radio"
                    name="selectedPlatform"
                    value={opt.value}
                    checked={sharedDraft.selectedPlatform === opt.value}
                    onChange={() => updateSharedDraft({ selectedPlatform: opt.value })}
                    style={{ accentColor: C.accent }}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* 2행: 가격 계산기 */}
        <PriceWithMarginCalc urlSuccess={urlSuccess} urlExtractedPrice={urlExtractedPrice} />
      </div>

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* 다음 단계 버튼 */}
      {/* ────────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
        {blockedReason && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: C.textSub }}>
            <AlertTriangle size={13} color={C.textSub} />
            {blockedReason}
          </div>
        )}
        <button
          onClick={handleNext}
          disabled={!canProceed}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '11px 28px', fontSize: '14px', fontWeight: 700,
            backgroundColor: canProceed ? C.accent : '#ccc',
            color: '#fff', border: 'none', borderRadius: '8px',
            cursor: canProceed ? 'pointer' : 'not-allowed',
            transition: 'background-color 0.15s',
          }}
        >
          다음 단계
          <ChevronRight size={16} />
        </button>
      </div>

      {/* AI 편집 모달 */}
      {aiEditModal?.open && (
        <AiEditModal
          imageUrl={aiEditModal.imageUrl}
          imageFile={aiEditModal.imageFile}
          initialPrompt={aiEditModal.initialPrompt}
          onClose={() => setAiEditModal(null)}
          onSave={async (resultUrl) => {
            if (aiEditModal?.detailImageId) {
              const targetId = aiEditModal.detailImageId;
              // 편집된 URL → File 변환 (Step2에서 File 배열을 사용하므로)
              let editedFile: File | undefined;
              try {
                const res = await fetch(resultUrl);
                const blob = await res.blob();
                editedFile = new File([blob], `ai-edited-${Date.now()}.jpg`, {
                  type: blob.type || 'image/jpeg',
                });
              } catch {
                // fetch 실패 시 File 없이 URL만 업데이트
              }
              setDetailImages((prev) => {
                const updated = prev.map((d) =>
                  d.id === targetId
                    ? { ...d, url: resultUrl, ...(editedFile ? { file: editedFile } : {}) }
                    : d
                );
                updateSharedDraft({
                  detailImageFiles: updated.map((d) => d.file).filter(Boolean) as File[],
                  detailImages: updated.map((d) => d.url),
                });
                return updated;
              });
            } else {
              // 썸네일 AI 편집 결과: URL 업데이트 + rawImageFiles도 교체 (Step2 AI 분석에 편집본 사용)
              setThumbnailPreviewUrl(resultUrl);
              let editedThumbnailFile: File | undefined;
              try {
                const res = await fetch(resultUrl);
                const blob = await res.blob();
                editedThumbnailFile = new File(
                  [blob],
                  `ai-thumbnail-${Date.now()}.jpg`,
                  { type: blob.type || 'image/jpeg' }
                );
              } catch {
                // fetch 실패 시 rawImageFiles 기존 값 유지
              }
              updateSharedDraft({
                thumbnailImages: [resultUrl],
                ...(editedThumbnailFile ? { rawImageFiles: [editedThumbnailFile] } : {}),
              });
            }
            setAiEditModal(null);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 서브 컴포넌트: 가격 입력 + 추천가 계산기
// ─────────────────────────────────────────────────────────────────────────────

function calcRecommendedPrice(costPrice: number, shippingFee: number, commissionRate: number, targetMarginRate: number): number {
  const denominator = 1 - commissionRate - targetMarginRate / 100;
  if (denominator <= 0) return 0;
  return Math.ceil((costPrice + shippingFee * 1.033) / denominator / 100) * 100;
}

interface PriceWithMarginCalcProps {
  urlSuccess?: boolean;
  urlExtractedPrice?: number | null;
}

function PriceWithMarginCalc({ urlSuccess, urlExtractedPrice }: PriceWithMarginCalcProps) {
  const { sharedDraft, updateSharedDraft } = useListingStore();
  const [shippingFee, setShippingFee] = useState(3000);

  const costPrice = Number(sharedDraft.costPrice) || 0;
  const targetMargin = sharedDraft.targetMarginRate;

  const coupangFee = useMemo(
    () => getCoupangFeeFromPath(sharedDraft.coupangCategoryPath || ''),
    [sharedDraft.coupangCategoryPath],
  );

  const rec = useMemo(() => {
    if (!costPrice) return null;
    const coupangPrice = calcRecommendedPrice(costPrice, shippingFee, coupangFee.rate, targetMargin);
    const naverPrice   = calcRecommendedPrice(costPrice, shippingFee, 0.036, targetMargin);
    const cr = calcCoupangWing({ costPrice, sellingPrice: coupangPrice, category: coupangFee.categoryName, shippingFee, adCost: 0 });
    const nr = calcNaver({ costPrice, sellingPrice: naverPrice, shippingFee, grade: '일반', inflow: '네이버쇼핑', adCost: 0 });
    return {
      coupang: { price: coupangPrice, margin: cr.marginRate, profit: cr.netProfit },
      naver:   { price: naverPrice,   margin: nr.marginRate, profit: nr.netProfit },
    };
  }, [costPrice, shippingFee, targetMargin, coupangFee]);

  const numInputStyle: React.CSSProperties = { ...inputStyle, paddingRight: '28px' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', background: '#f7f8fa', border: `1px solid ${C.border}`, borderRadius: '12px', marginTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color: C.text }}>
        <Calculator size={14} color={C.accent} />
        가격 설정
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
        <div>
          <label style={labelStyle}>구입가 (원가)</label>
          <div style={{ position: 'relative' }}>
            <input style={{ ...numInputStyle, backgroundColor: '#fff' }} type="number" value={sharedDraft.costPrice} onChange={(e) => updateSharedDraft({ costPrice: e.target.value })} placeholder="0" min={0} />
            <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: C.textSub }}>원</span>
          </div>
          {/* URL 수집 가격 안내 */}
          {urlSuccess && urlExtractedPrice && (
            <p style={{ fontSize: '11px', color: '#f59e0b', marginTop: '4px' }}>
              URL에서 수집한 가격 ({urlExtractedPrice.toLocaleString()}원)이 자동 입력되었습니다.
            </p>
          )}
        </div>
        <div>
          <label style={labelStyle}>배송비</label>
          <div style={{ position: 'relative' }}>
            <input style={{ ...numInputStyle, backgroundColor: '#fff' }} type="number" value={shippingFee} onChange={(e) => setShippingFee(Number(e.target.value))} min={0} />
            <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: C.textSub }}>원</span>
          </div>
        </div>
        <div>
          <label style={labelStyle}>목표 마진율</label>
          <div style={{ position: 'relative' }}>
            <input style={{ ...numInputStyle, backgroundColor: '#fff' }} type="number" value={targetMargin} onChange={(e) => updateSharedDraft({ targetMarginRate: Math.max(1, Math.min(80, Number(e.target.value))) })} min={1} max={80} />
            <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: C.textSub }}>%</span>
          </div>
        </div>
      </div>

      {rec ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          {([
            { key: 'coupang', label: '쿠팡 윙', sub: `${coupangFee.categoryName} · 수수료 ${(coupangFee.rate * 100).toFixed(1)}%${sharedDraft.coupangCategoryPath ? '' : ' (기본값)'}`, data: rec.coupang, priceField: 'coupangPrice' as const },
            { key: 'naver',   label: '네이버 스마트스토어', sub: '수수료 3.6% 기준', data: rec.naver, priceField: 'naverPrice' as const },
          ]).map(({ key, label, sub, data, priceField }) => (
            <div key={key} style={{ background: '#fff', border: `1.5px solid ${C.border}`, borderRadius: '10px', padding: '14px 16px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: C.text, marginBottom: '2px' }}>{label}</div>
              <div style={{ fontSize: '11px', color: C.textSub, marginBottom: '10px' }}>{sub}</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: C.text, letterSpacing: '-0.5px' }}>
                {data.price.toLocaleString()}원
              </div>
              <div style={{ display: 'flex', gap: '12px', margin: '4px 0 12px', fontSize: '12px' }}>
                <span style={{ color: data.margin >= targetMargin - 1 ? '#16a34a' : '#f59e0b', fontWeight: 600 }}>
                  마진 {data.margin.toFixed(1)}%
                </span>
                <span style={{ color: C.textSub }}>
                  순익 {data.profit.toLocaleString()}원
                </span>
              </div>
              <button
                type="button"
                onClick={() => updateSharedDraft({ salePrice: String(data.price), [priceField]: String(data.price) } as Parameters<typeof updateSharedDraft>[0])}
                style={{
                  width: '100%', padding: '7px 0', fontSize: '12px', fontWeight: 700,
                  color: sharedDraft[priceField] === String(data.price) ? '#fff' : C.accent,
                  background: sharedDraft[priceField] === String(data.price) ? C.accent : 'rgba(190,0,20,0.07)',
                  border: `1.5px solid ${sharedDraft[priceField] === String(data.price) ? C.accent : 'rgba(190,0,20,0.25)'}`,
                  borderRadius: '7px', cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                {sharedDraft[priceField] === String(data.price) ? '✓ 선택됨' : '이 가격으로 설정'}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '12px 0', fontSize: '13px', color: C.textSub }}>
          구입가를 입력하면 플랫폼별 추천 판매가를 바로 계산해드려요
        </div>
      )}

      <div>
        <label style={labelStyle}>
          판매가 (공통)
          <span style={{ fontSize: '11px', fontWeight: 400, marginLeft: '6px', color: C.textSub }}>위 추천가 적용 또는 직접 입력</span>
        </label>
        <div style={{ position: 'relative' }}>
          <input
            style={{ ...numInputStyle, backgroundColor: '#fff', fontWeight: 600 }}
            type="number"
            value={sharedDraft.salePrice}
            onChange={(e) => updateSharedDraft({ salePrice: e.target.value })}
            placeholder="0"
            min={0}
          />
          <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: C.textSub }}>원</span>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: '11px', color: C.textSub }}>
        {sharedDraft.coupangCategoryPath
          ? `✓ 카테고리 "${sharedDraft.coupangCategoryPath.split('>').slice(-1)[0].trim()}" 수수료 자동 적용됨`
          : '* 다음 단계(AI 처리)에서 카테고리를 선택하면 수수료율이 자동으로 반영됩니다.'}
      </p>
    </div>
  );
}
