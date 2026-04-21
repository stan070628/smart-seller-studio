'use client';

/**
 * Step1SourceSelect.tsx
 * Step 1 — 소스 선택 (이미지 업로드 OR 도매꾹 상품번호 OR URL 가져오기)
 * + 상품 기본 정보 (상품명, 판매가, 플랫폼 선택)
 *
 * UX 개선 (2026-04-21):
 * - 세 소스를 "1단계: 소스 선택" 섹션에 라디오 카드 방식으로 통합
 * - 선택된 소스의 입력 UI만 펼쳐 표시 (Progressive Disclosure)
 * - 소스별 결과 경로(Step2 이동 vs Step3 바로 이동) 안내 뱃지 추가
 * - "다음 단계" 버튼 비활성화 사유 명시
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Upload, X, ChevronRight, AlertTriangle, CheckCircle, RefreshCw,
  Calculator, Wand2, Link, Image, Hash,
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
type SourceType = 'upload' | 'domeggook' | 'url';

interface PreviewImage {
  id: string;
  url: string;
  name: string;
  size: number;
  file: File;
}

interface DetailImage {
  id: string;
  url: string;
  file: File;
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
// 서브: 썸네일 카드
// ─────────────────────────────────────────────────────────────────────────────
function ThumbnailCard({ image, onRemove }: { image: PreviewImage; onRemove: (id: string) => void }) {
  return (
    <div
      style={{
        position: 'relative',
        borderRadius: '8px',
        border: `1px solid ${C.border}`,
        backgroundColor: C.tableHeader,
        overflow: 'hidden',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.url} alt={image.name} style={{ width: '100%', height: '80px', objectFit: 'cover', display: 'block' }} />
      <button
        onClick={() => onRemove(image.id)}
        style={{
          position: 'absolute', top: '4px', right: '4px',
          width: '20px', height: '20px', borderRadius: '50%',
          backgroundColor: 'rgba(0,0,0,0.6)', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        title="삭제"
      >
        <X size={11} color="#fff" />
      </button>
      <div style={{ padding: '4px 6px' }}>
        <p style={{ fontSize: '10px', color: C.text, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{image.name}</p>
        <p style={{ fontSize: '10px', color: C.textSub, margin: '1px 0 0' }}>{formatFileSize(image.size)}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 서브: 소스 선택 라디오 카드
// ─────────────────────────────────────────────────────────────────────────────
interface SourceCardProps {
  type: SourceType;
  selected: SourceType;
  onSelect: (t: SourceType) => void;
  icon: React.ReactNode;
  label: string;
  description: string;
  badge: string;
  badgeColor: string;
}

function SourceCard({ type, selected, onSelect, icon, label, description, badge, badgeColor }: SourceCardProps) {
  const isSelected = selected === type;
  return (
    <button
      onClick={() => onSelect(type)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '14px',
        padding: '16px 18px',
        borderRadius: '10px',
        border: `2px solid ${isSelected ? C.accent : C.border}`,
        backgroundColor: isSelected ? 'rgba(190,0,20,0.03)' : C.card,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'border-color 0.15s, background-color 0.15s',
        width: '100%',
      }}
    >
      {/* 라디오 원 */}
      <div
        style={{
          flexShrink: 0,
          marginTop: '2px',
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          border: `2px solid ${isSelected ? C.accent : C.border}`,
          backgroundColor: isSelected ? C.accent : '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {isSelected && <div style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: '#fff' }} />}
      </div>

      {/* 아이콘 */}
      <div
        style={{
          flexShrink: 0,
          width: '38px',
          height: '38px',
          borderRadius: '10px',
          backgroundColor: isSelected ? 'rgba(190,0,20,0.08)' : C.tableHeader,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background-color 0.15s',
        }}
      >
        {icon}
      </div>

      {/* 텍스트 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ fontSize: '14px', fontWeight: 700, color: C.text }}>{label}</span>
          <span
            style={{
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: '100px',
              backgroundColor: badgeColor + '18',
              color: badgeColor,
              border: `1px solid ${badgeColor}40`,
              whiteSpace: 'nowrap',
            }}
          >
            {badge}
          </span>
        </div>
        <p style={{ margin: 0, fontSize: '12px', color: C.textSub, lineHeight: 1.5 }}>{description}</p>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export default function Step1SourceSelect() {
  const { sharedDraft, updateSharedDraft, goNextStep } = useListingStore();

  // ─── 소스 선택 상태 ─────────────────────────────────────────────────────────
  const [selectedSource, setSelectedSource] = useState<SourceType>('upload');

  // 소스를 바꿀 때 이전 소스 결과 초기화
  const handleSourceChange = (t: SourceType) => {
    if (t === selectedSource) return;
    setSelectedSource(t);
    // 이전 소스 입력 결과 클리어
    setPreviewImages([]);
    setDomeggookSuccess(false);
    setItemNoInput('');
    setUrlSuccess(false);
    setUrlInput('');
    setUrlExtractedPrice(null);
    updateSharedDraft({
      thumbnailImages: [],
      name: '',
      description: '',
      rawImageFiles: [],
      detailPageSkipped: false,
    });
  };

  // ─── 이미지 업로드 ──────────────────────────────────────────────────────────
  const [previewImages, setPreviewImages] = useState<PreviewImage[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const MAX_IMAGES = 5;

  const [selectedThumbnailIdx, setSelectedThumbnailIdx] = useState<number | null>(null);

  const processFiles = useCallback(
    (files: FileList | File[]) => {
      const remaining = MAX_IMAGES - previewImages.length;
      if (remaining <= 0) return;
      const fileArr = Array.from(files)
        .filter((f) => f.type.match(/^image\/(jpeg|png|webp)$/))
        .slice(0, remaining);
      const newImages: PreviewImage[] = fileArr.map((file) => ({
        id: generateId(), url: URL.createObjectURL(file), name: file.name, size: file.size, file,
      }));
      setPreviewImages((prev) => {
        const updated = [...prev, ...newImages];
        updateSharedDraft({ rawImageFiles: updated.map((img) => img.file) });
        return updated;
      });
    },
    [previewImages.length, updateSharedDraft],
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(e.target.files);
    e.target.value = '';
  };

  const removeImage = (id: string) => {
    setPreviewImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) URL.revokeObjectURL(target.url);
      const updated = prev.filter((img) => img.id !== id);
      updateSharedDraft({ rawImageFiles: updated.map((img) => img.file) });
      return updated;
    });
  };

  // ─── 상세이미지 ─────────────────────────────────────────────────────────────
  const [detailImages, setDetailImages] = useState<DetailImage[]>([]);
  const [detailDragOver, setDetailDragOver] = useState(false);
  const detailFileInputRef = useRef<HTMLInputElement>(null);
  const MAX_DETAIL = 10;

  // ─── AI 편집 모달 ───────────────────────────────────────────────────────────
  const [aiEditModal, setAiEditModal] = useState<{
    open: boolean;
    imageUrl: string;
    imageFile: File | null;
    targetType: 'thumbnail' | 'detail';
    targetId?: string;
  } | null>(null);

  // ─── 도매꾹 ─────────────────────────────────────────────────────────────────
  const [itemNoInput, setItemNoInput] = useState('');
  const [domeggookLoading, setDomeggookLoading] = useState(false);
  const [domeggookError, setDomeggookError] = useState<string | null>(null);
  const [domeggookSuccess, setDomeggookSuccess] = useState(false);

  const handleDomeggookFetch = async () => {
    if (!itemNoInput.trim() || domeggookLoading) return;
    const defaults = loadDomeggookSellerDefaults();
    const sellerName = defaults.sellerName || '셀러';
    const csPhone = defaults.csPhone || '000-0000-0000';
    const csHours = defaults.csHours || '평일 10:00~17:00';

    setDomeggookLoading(true);
    setDomeggookError(null);
    setDomeggookSuccess(false);

    try {
      const body: Record<string, unknown> = { itemNo: parseInt(itemNoInput, 10), sellerName, csPhone, csHours };
      if (defaults.sellerBrandName) body.sellerBrandName = defaults.sellerBrandName;
      if (defaults.returnAddress) body.returnAddress = defaults.returnAddress;

      const res = await fetch('/api/listing/domeggook/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        setDomeggookError(json.error ?? '상품을 불러오지 못했습니다. 상품번호를 확인해주세요.');
        return;
      }

      const data = json.data as DomeggookResult;
      const effectiveDeliFee = data.pricing.deliWho === 'S' ? 0 : (data.pricing.deliFee ?? 0);

      updateSharedDraft({
        name: data.source.title,
        thumbnailImages: [data.thumbnail.processedUrl],
        description: data.detail.processedHtml,
        naverPrice: String(data.pricing.naver.recommendedPrice),
        coupangPrice: String(data.pricing.coupang.recommendedPrice),
        salePrice: String(data.pricing.coupang.recommendedPrice),
        rawImageFiles: [],
        detailPageSkipped: true,
      });

      const { fetchOptions } = useListingStore.getState();
      fetchOptions(parseInt(itemNoInput, 10));

      if (effectiveDeliFee > 0) {
        updateSharedDraft({ deliveryCharge: String(effectiveDeliFee), deliveryChargeType: 'NOT_FREE' });
      } else {
        updateSharedDraft({ deliveryChargeType: 'FREE', deliveryCharge: '0' });
      }

      setDomeggookSuccess(true);
      setPreviewImages([]);
    } catch {
      setDomeggookError('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setDomeggookLoading(false);
    }
  };

  // ─── URL 가져오기 ───────────────────────────────────────────────────────────
  const [urlInput, setUrlInput] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlSuccess, setUrlSuccess] = useState(false);
  const [urlExtractedPrice, setUrlExtractedPrice] = useState<number | null>(null);

  const handleUrlFetch = async () => {
    if (!urlInput.trim() || urlLoading) return;
    setUrlLoading(true);
    setUrlError(null);
    setUrlSuccess(false);

    try {
      const res = await fetch('/api/listing/url-scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        setUrlError(json.error ?? '상품을 불러오지 못했습니다. URL을 확인해주세요.');
        return;
      }

      const data = json.data;
      updateSharedDraft({
        name: data.title || '',
        thumbnailImages: data.thumbnail?.processedUrl ? [data.thumbnail.processedUrl] : [],
        description: data.detailHtml,
        rawImageFiles: [],
        detailPageSkipped: true,
        ...(data.extractedPrice ? {
          salePrice: String(data.extractedPrice),
          coupangPrice: String(data.extractedPrice),
          naverPrice: String(data.extractedPrice),
        } : {}),
      });

      setUrlExtractedPrice(data.extractedPrice);
      setUrlSuccess(true);
    } catch {
      setUrlError('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setUrlLoading(false);
    }
  };

  // ─── 다음 단계 활성 조건 ────────────────────────────────────────────────────
  const canProceed = previewImages.length >= 1 || sharedDraft.thumbnailImages.length >= 1;

  // 비활성화 사유 메시지
  const blockedReason = !canProceed
    ? selectedSource === 'upload'
      ? '사진을 1장 이상 업로드해 주세요.'
      : selectedSource === 'domeggook'
        ? '도매꾹 상품번호를 입력하고 불러오기를 완료해 주세요.'
        : 'URL을 입력하고 가져오기를 완료해 주세요.'
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

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* SECTION 1 — 소스 선택 */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <div
        style={{
          backgroundColor: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: '12px',
          padding: '20px 24px',
        }}
      >
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
            <span style={{ fontSize: '15px', fontWeight: 800, color: C.text }}>상품 소스 선택</span>
          </div>
          <p style={{ margin: '0 0 0 30px', fontSize: '12px', color: C.textSub }}>
            세 가지 방법 중 하나를 선택해 상품 정보를 불러오세요.
          </p>
        </div>

        {/* 소스 선택 카드 3개 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <SourceCard
            type="upload"
            selected={selectedSource}
            onSelect={handleSourceChange}
            icon={<Image size={18} color={selectedSource === 'upload' ? C.accent : C.textSub} />}
            label="사진 직접 업로드"
            description="직접 촬영하거나 보유한 사진으로 AI가 상세페이지를 자동 생성합니다."
            badge="AI 상세페이지 생성"
            badgeColor="#2563eb"
          />
          <SourceCard
            type="domeggook"
            selected={selectedSource}
            onSelect={handleSourceChange}
            icon={<Hash size={18} color={selectedSource === 'domeggook' ? C.accent : C.textSub} />}
            label="도매꾹 상품번호"
            description="상품번호를 입력하면 이미지·상세페이지·가격이 자동으로 채워집니다."
            badge="도매꾹 자동 완성"
            badgeColor="#16a34a"
          />
          <SourceCard
            type="url"
            selected={selectedSource}
            onSelect={handleSourceChange}
            icon={<Link size={18} color={selectedSource === 'url' ? C.accent : C.textSub} />}
            label="상품 페이지 URL"
            description="코스트코 등 상품 페이지 URL을 입력하면 이미지와 정보를 가져와 상세페이지를 생성합니다."
            badge="URL 스크랩"
            badgeColor="#9333ea"
          />
        </div>

        {/* ── 선택된 소스별 입력 UI (Accordion) ─────────────────────────── */}

        {/* 업로드 패널 */}
        {selectedSource === 'upload' && (
          <div
            style={{
              marginTop: '16px',
              paddingTop: '16px',
              borderTop: `1px solid ${C.border}`,
            }}
          >
            {/* 드롭존 */}
            {previewImages.length < MAX_IMAGES && (
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragOver(false); processFiles(e.dataTransfer.files); }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '10px', padding: '32px 16px', borderRadius: '10px',
                  border: `2px dashed ${isDragOver ? C.accent : C.border}`,
                  backgroundColor: isDragOver ? 'rgba(190,0,20,0.03)' : C.tableHeader,
                  cursor: 'pointer', transition: 'border-color 0.15s, background-color 0.15s',
                }}
              >
                <Upload size={24} color={isDragOver ? C.accent : C.textSub} />
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: '13px', color: C.textSub, margin: 0 }}>
                    드래그하거나{' '}
                    <span style={{ color: C.accent, fontWeight: 600 }}>클릭하여 선택</span>
                  </p>
                  <p style={{ fontSize: '11px', color: C.textSub, margin: '4px 0 0' }}>
                    JPEG, PNG, WEBP — 최대 {MAX_IMAGES}장
                  </p>
                </div>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />

            {/* 썸네일 그리드 */}
            {previewImages.length > 0 && (
              <div style={{ marginTop: previewImages.length < MAX_IMAGES ? '12px' : '0' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
                  {previewImages.map((img) => (
                    <ThumbnailCard key={img.id} image={img} onRemove={removeImage} />
                  ))}
                </div>
                <p style={{ fontSize: '11px', color: C.textSub, textAlign: 'right', margin: '6px 0 0' }}>
                  {previewImages.length} / {MAX_IMAGES}장
                </p>
              </div>
            )}

            {/* 대표 썸네일 설정 */}
            {previewImages.length > 0 && (
              <div style={{ marginTop: '16px', padding: '14px 16px', backgroundColor: '#f7f8fa', borderRadius: '10px', border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>대표 썸네일 설정</span>
                  <span style={{ fontSize: '11px', color: C.textSub, backgroundColor: '#fff', padding: '2px 8px', borderRadius: '100px', border: `1px solid ${C.border}` }}>선택 사항</span>
                </div>
                <p style={{ fontSize: '12px', color: C.textSub, margin: '0 0 10px' }}>업로드한 사진 중 1장을 대표이미지로 지정하거나 AI로 편집하세요.</p>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  {previewImages.map((img, idx) => (
                    <div
                      key={img.id}
                      onClick={() => { setSelectedThumbnailIdx(idx); updateSharedDraft({ thumbnailImages: [img.url] }); }}
                      style={{
                        position: 'relative', width: '60px', height: '60px', borderRadius: '8px',
                        overflow: 'hidden', cursor: 'pointer',
                        border: `2px solid ${selectedThumbnailIdx === idx ? C.accent : C.border}`,
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      {selectedThumbnailIdx === idx && (
                        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(190,0,20,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ color: '#fff', fontSize: '16px' }}>✓</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {selectedThumbnailIdx !== null && (
                  <button
                    onClick={() => {
                      const img = previewImages[selectedThumbnailIdx];
                      setAiEditModal({ open: true, imageUrl: img.url, imageFile: img.file, targetType: 'thumbnail' });
                    }}
                    style={{
                      padding: '6px 14px', fontSize: '12px', fontWeight: 600,
                      backgroundColor: 'rgba(190,0,20,0.07)', color: C.accent,
                      border: `1px solid rgba(190,0,20,0.3)`, borderRadius: '8px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: '6px',
                    }}
                  >
                    <Wand2 size={13} />
                    AI로 썸네일 편집
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* 도매꾹 패널 */}
        {selectedSource === 'domeggook' && (
          <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                type="number"
                value={itemNoInput}
                onChange={(e) => setItemNoInput(e.target.value)}
                placeholder="도매꾹 상품번호 (숫자)"
                min="1"
                disabled={domeggookSuccess}
                onKeyDown={(e) => { if (e.key === 'Enter') handleDomeggookFetch(); }}
              />
              <button
                onClick={handleDomeggookFetch}
                disabled={!itemNoInput.trim() || domeggookLoading || domeggookSuccess}
                style={{
                  padding: '9px 16px', fontSize: '13px', fontWeight: 600,
                  backgroundColor: itemNoInput.trim() && !domeggookLoading && !domeggookSuccess ? C.accent : '#ccc',
                  color: '#fff', border: 'none', borderRadius: '8px',
                  cursor: itemNoInput.trim() && !domeggookLoading && !domeggookSuccess ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                {domeggookLoading ? (
                  <>
                    <div style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    불러오는 중...
                  </>
                ) : (
                  <><ChevronRight size={14} />불러오기</>
                )}
              </button>
            </div>

            {domeggookError && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px 12px', backgroundColor: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', fontSize: '12px', color: '#b91c1c', marginBottom: '12px' }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                {domeggookError}
              </div>
            )}

            {domeggookSuccess && sharedDraft.thumbnailImages.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', backgroundColor: '#dcfce7', border: '1px solid #86efac', borderRadius: '8px', fontSize: '12px', color: '#15803d' }}>
                  <CheckCircle size={14} />
                  <span>도매꾹 상품 불러오기 완료 — 상품 기본 정보가 자동으로 채워졌습니다.</span>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px', backgroundColor: C.tableHeader, borderRadius: '8px' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sharedDraft.thumbnailImages[0]} alt="대표이미지" style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: C.text, margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sharedDraft.name}
                    </p>
                    <p style={{ fontSize: '12px', color: C.textSub, margin: 0 }}>
                      쿠팡 {Number(sharedDraft.coupangPrice || 0).toLocaleString()}원 / 네이버 {Number(sharedDraft.naverPrice || 0).toLocaleString()}원
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setDomeggookSuccess(false);
                      setItemNoInput('');
                      updateSharedDraft({ thumbnailImages: [], name: '', description: '', naverPrice: '', coupangPrice: '', rawImageFiles: [], detailPageSkipped: false });
                    }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textSub, padding: '2px' }}
                    title="초기화"
                  >
                    <RefreshCw size={14} />
                  </button>
                </div>
              </div>
            ) : (
              !domeggookError && (
                <div style={{ fontSize: '11px', color: C.textSub, lineHeight: 1.5 }}>
                  도매꾹 상품 상세 페이지 URL에서 상품번호를 확인하세요.
                  <br />예: domeggook.com/goods/<strong>12345678</strong>
                </div>
              )
            )}
          </div>
        )}

        {/* URL 패널 */}
        {selectedSource === 'url' && (
          <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://www.costco.co.kr/..."
                disabled={urlSuccess}
                onKeyDown={(e) => { if (e.key === 'Enter') handleUrlFetch(); }}
              />
              <button
                onClick={handleUrlFetch}
                disabled={!urlInput.trim() || urlLoading || urlSuccess}
                style={{
                  padding: '9px 16px', fontSize: '13px', fontWeight: 600,
                  backgroundColor: urlInput.trim() && !urlLoading && !urlSuccess ? C.accent : '#ccc',
                  color: '#fff', border: 'none', borderRadius: '8px',
                  cursor: urlInput.trim() && !urlLoading && !urlSuccess ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                {urlLoading ? (
                  <>
                    <div style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                    분석 중...
                  </>
                ) : (
                  <><ChevronRight size={14} />가져오기</>
                )}
              </button>
            </div>

            {urlLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', fontSize: '12px', color: '#1d4ed8', marginBottom: '12px' }}>
                <div style={{ width: '14px', height: '14px', border: '2px solid rgba(29,78,216,0.3)', borderTopColor: '#1d4ed8', borderRadius: '50%', flexShrink: 0, animation: 'spin 0.8s linear infinite' }} />
                페이지를 분석하고 AI 상세페이지를 생성 중입니다...
              </div>
            )}

            {urlError && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px 12px', backgroundColor: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', fontSize: '12px', color: '#b91c1c', marginBottom: '12px' }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                {urlError}
              </div>
            )}

            {urlSuccess && sharedDraft.thumbnailImages.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', backgroundColor: '#dcfce7', border: '1px solid #86efac', borderRadius: '8px', fontSize: '12px', color: '#15803d' }}>
                  <CheckCircle size={14} />
                  <span>URL 가져오기 완료 — 상품 기본 정보가 자동으로 채워졌습니다.</span>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px', backgroundColor: C.tableHeader, borderRadius: '8px' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sharedDraft.thumbnailImages[0]} alt="대표이미지" style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: C.text, margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sharedDraft.name}
                    </p>
                    {urlExtractedPrice && (
                      <p style={{ fontSize: '12px', color: C.textSub, margin: 0 }}>
                        가격: {urlExtractedPrice.toLocaleString()}원
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setUrlSuccess(false);
                      setUrlInput('');
                      setUrlExtractedPrice(null);
                      updateSharedDraft({ thumbnailImages: [], name: '', description: '', rawImageFiles: [], detailPageSkipped: false });
                    }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textSub, padding: '2px' }}
                    title="초기화"
                  >
                    <RefreshCw size={14} />
                  </button>
                </div>
              </div>
            ) : (
              !urlError && !urlLoading && (
                <div style={{ fontSize: '11px', color: C.textSub, lineHeight: 1.5 }}>
                  코스트코, 이마트몰 등 상품 URL을 지원합니다.
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* SECTION 2 — 상세 이미지 등록 (선택 사항) */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '22px', height: '22px', borderRadius: '50%',
                backgroundColor: C.tableHeader, color: C.textSub,
                fontSize: '12px', fontWeight: 800, flexShrink: 0,
                border: `1px solid ${C.border}`,
              }}
            >2</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: C.text }}>상세 이미지 등록</h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: C.textSub }}>AI 상세페이지 생성 시 함께 분석됩니다 (미입력 시 소스 이미지만 사용)</p>
            </div>
          </div>
          <span style={{ fontSize: '11px', color: C.textSub, backgroundColor: C.tableHeader, padding: '2px 8px', borderRadius: '100px', border: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>선택 사항</span>
        </div>

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
            setDetailImages(prev => { const updated = [...prev, ...toAdd]; updateSharedDraft({ detailImageFiles: updated.map(d => d.file) }); return updated; });
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
            setDetailImages(prev => { const updated = [...prev, ...toAdd]; updateSharedDraft({ detailImageFiles: updated.map(d => d.file) }); return updated; });
            e.target.value = '';
          }}
        />

        {detailImages.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px' }}>
            {detailImages.map((img, idx) => (
              <div
                key={img.id}
                style={{ position: 'relative', borderRadius: '8px', border: `1px solid ${C.border}`, overflow: 'hidden', backgroundColor: C.tableHeader }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" style={{ width: '100%', height: '80px', objectFit: 'cover', display: 'block' }} />
                <div style={{ position: 'absolute', top: '4px', left: '4px', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '10px', color: '#fff', fontWeight: 700 }}>{idx + 1}</span>
                </div>
                <button
                  onClick={() => {
                    URL.revokeObjectURL(img.url);
                    setDetailImages(prev => { const updated = prev.filter(d => d.id !== img.id); updateSharedDraft({ detailImageFiles: updated.map(d => d.file) }); return updated; });
                  }}
                  style={{ position: 'absolute', top: '4px', right: '4px', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.55)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <X size={10} color="#fff" />
                </button>
                <button
                  onClick={() => setAiEditModal({ open: true, imageUrl: img.url, imageFile: img.file, targetType: 'detail', targetId: img.id })}
                  style={{ width: '100%', padding: '4px', fontSize: '10px', fontWeight: 600, backgroundColor: 'rgba(190,0,20,0.07)', color: C.accent, border: 'none', cursor: 'pointer', borderTop: `1px solid ${C.border}` }}
                >
                  AI 편집
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* SECTION 3 — 상품 기본 정보 */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <div
        style={{
          backgroundColor: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: '12px',
          padding: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '22px', height: '22px', borderRadius: '50%',
              backgroundColor: C.tableHeader, color: C.textSub,
              fontSize: '12px', fontWeight: 800, flexShrink: 0,
              border: `1px solid ${C.border}`,
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
        <PriceWithMarginCalc />
      </div>

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* 다음 단계 버튼 */}
      {/* ────────────────────────────────────────────────────────────────────── */}
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
          onClose={() => setAiEditModal(null)}
          onSave={(resultUrl) => {
            if (aiEditModal.targetType === 'thumbnail') {
              updateSharedDraft({ thumbnailImages: [resultUrl] });
            } else if (aiEditModal.targetType === 'detail' && aiEditModal.targetId) {
              setDetailImages(prev => prev.map(d => d.id === aiEditModal.targetId ? { ...d, url: resultUrl } : d));
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

function PriceWithMarginCalc() {
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
