'use client';

/**
 * Step1SourceSelect.tsx
 * Step 1 — 소스 선택 (이미지 업로드 OR 도매꾹 상품번호)
 * + 상품 기본 정보 (상품명, 판매가, 플랫폼 선택)
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Upload, X, ChevronRight, AlertTriangle, CheckCircle, RefreshCw, Loader2, Calculator, ChevronDown, ChevronUp } from 'lucide-react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';
import { calcCoupangWing, calcNaver } from '@/lib/calculator/calculate';

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
// 업로드된 이미지 타입
// ─────────────────────────────────────────────────────────────────────────────
interface PreviewImage {
  id: string;
  url: string;
  name: string;
  size: number;
  file: File;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 썸네일 카드
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
          position: 'absolute',
          top: '4px',
          right: '4px',
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          backgroundColor: 'rgba(0,0,0,0.6)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
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
// 도매꾹 API 응답 타입
// ─────────────────────────────────────────────────────────────────────────────
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

// localStorage에서 도매꾹 셀러 기본값 로드
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

  // ─── 이미지 업로드 로컬 상태 ────────────────────────────────────────────────
  const [previewImages, setPreviewImages] = useState<PreviewImage[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const MAX_IMAGES = 5;

  const processFiles = useCallback(
    (files: FileList | File[]) => {
      const remaining = MAX_IMAGES - previewImages.length;
      if (remaining <= 0) return;

      const fileArr = Array.from(files)
        .filter((f) => f.type.match(/^image\/(jpeg|png|webp)$/))
        .slice(0, remaining);

      const newImages: PreviewImage[] = fileArr.map((file) => ({
        id: generateId(),
        url: URL.createObjectURL(file),
        name: file.name,
        size: file.size,
        file,
      }));

      setPreviewImages((prev) => {
        const updated = [...prev, ...newImages];
        // store에도 File 객체 저장
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

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    processFiles(e.dataTransfer.files);
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

  // ─── 도매꾹 불러오기 로컬 상태 ──────────────────────────────────────────────
  const [itemNoInput, setItemNoInput] = useState('');
  const [domeggookLoading, setDomeggookLoading] = useState(false);
  const [domeggookError, setDomeggookError] = useState<string | null>(null);
  const [domeggookSuccess, setDomeggookSuccess] = useState(false);

  const handleDomeggookFetch = async () => {
    if (!itemNoInput.trim() || domeggookLoading) return;

    const defaults = loadDomeggookSellerDefaults();

    // 셀러 정보가 없으면 최소 기본값으로 시도
    const sellerName = defaults.sellerName || '셀러';
    const csPhone = defaults.csPhone || '000-0000-0000';
    const csHours = defaults.csHours || '평일 10:00~17:00';

    setDomeggookLoading(true);
    setDomeggookError(null);
    setDomeggookSuccess(false);

    try {
      const body: Record<string, unknown> = {
        itemNo: parseInt(itemNoInput, 10),
        sellerName,
        csPhone,
        csHours,
      };
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

      // sharedDraft 자동 채우기
      updateSharedDraft({
        name: data.source.title,
        thumbnailImages: [data.thumbnail.processedUrl],
        description: data.detail.processedHtml,
        naverPrice: String(data.pricing.naver.recommendedPrice),
        coupangPrice: String(data.pricing.coupang.recommendedPrice),
        salePrice: String(data.pricing.coupang.recommendedPrice),
        // rawImageFiles는 비워둠 (도매꾹 경로는 AI 생성 스킵)
        rawImageFiles: [],
        detailPageSkipped: true,
      });

      // 도매꾹 옵션 자동 로드
      const { fetchOptions } = useListingStore.getState();
      fetchOptions(parseInt(itemNoInput, 10));

      // 배송비 정보
      if (effectiveDeliFee > 0) {
        updateSharedDraft({
          deliveryCharge: String(effectiveDeliFee),
          deliveryChargeType: 'NOT_FREE',
        });
      } else {
        updateSharedDraft({ deliveryChargeType: 'FREE', deliveryCharge: '0' });
      }

      setDomeggookSuccess(true);
      // 로컬 previewImages 초기화 (도매꾹 경로로 진행)
      setPreviewImages([]);
    } catch {
      setDomeggookError('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setDomeggookLoading(false);
    }
  };

  // ─── 다음 단계 활성 조건 ────────────────────────────────────────────────────
  const canProceed = previewImages.length >= 1 || sharedDraft.thumbnailImages.length >= 1;

  const handleNext = () => {
    if (!canProceed) return;
    // 도매꾹 경로면 step 3로 바로, 이미지 업로드면 step 2 (AI 생성) 로
    // detailPageSkipped가 true면 goNextStep이 2→3으로 건너뛰지 않고 store에서 처리
    goNextStep();
  };

  // ─── 렌더 ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* 상단 2컬럼 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>

        {/* 좌측: 이미지 업로드 카드 */}
        <div
          style={{
            backgroundColor: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: '12px',
            padding: '20px',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 700, color: C.text, marginBottom: '4px' }}>
            사진 직접 업로드
          </div>
          <div style={{ fontSize: '12px', color: C.textSub, marginBottom: '16px' }}>
            AI가 상품 사진을 분석해 상세페이지를 자동 생성합니다.
          </div>

          {/* 드롭존 */}
          {previewImages.length < MAX_IMAGES && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                padding: '32px 16px',
                borderRadius: '10px',
                border: `2px dashed ${isDragOver ? C.accent : C.border}`,
                backgroundColor: isDragOver ? 'rgba(190,0,20,0.03)' : C.tableHeader,
                cursor: 'pointer',
                transition: 'border-color 0.15s, background-color 0.15s',
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                {previewImages.map((img) => (
                  <ThumbnailCard key={img.id} image={img} onRemove={removeImage} />
                ))}
              </div>
              <p style={{ fontSize: '11px', color: C.textSub, textAlign: 'right', margin: '6px 0 0' }}>
                {previewImages.length} / {MAX_IMAGES}장
              </p>
            </div>
          )}
        </div>

        {/* 우측: 도매꾹 카드 */}
        <div
          style={{
            backgroundColor: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: '12px',
            padding: '20px',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 700, color: C.text, marginBottom: '4px' }}>
            도매꾹 상품 불러오기
          </div>
          <div style={{ fontSize: '12px', color: C.textSub, marginBottom: '16px' }}>
            상품번호를 입력하면 이미지와 상세페이지를 자동으로 가져옵니다.
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              type="number"
              value={itemNoInput}
              onChange={(e) => setItemNoInput(e.target.value)}
              placeholder="도매꾹 상품번호 (숫자)"
              min="1"
              onKeyDown={(e) => { if (e.key === 'Enter') handleDomeggookFetch(); }}
            />
            <button
              onClick={handleDomeggookFetch}
              disabled={!itemNoInput.trim() || domeggookLoading}
              style={{
                padding: '9px 16px',
                fontSize: '13px',
                fontWeight: 600,
                backgroundColor: itemNoInput.trim() && !domeggookLoading ? C.accent : '#ccc',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: itemNoInput.trim() && !domeggookLoading ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {domeggookLoading ? (
                <>
                  <div style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  불러오는 중...
                </>
              ) : (
                <>
                  <ChevronRight size={14} />
                  불러오기
                </>
              )}
            </button>
          </div>

          {/* 에러 */}
          {domeggookError && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px 12px', backgroundColor: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', fontSize: '12px', color: '#b91c1c', marginBottom: '12px' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
              {domeggookError}
            </div>
          )}

          {/* 성공 */}
          {domeggookSuccess && sharedDraft.thumbnailImages.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', backgroundColor: '#dcfce7', border: '1px solid #86efac', borderRadius: '8px', fontSize: '12px', color: '#15803d' }}>
                <CheckCircle size={14} />
                <span>도매꾹 상품 불러오기 완료</span>
              </div>

              {/* 불러온 상품 미리보기 */}
              {sharedDraft.thumbnailImages[0] && (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px', backgroundColor: C.tableHeader, borderRadius: '8px' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={sharedDraft.thumbnailImages[0]}
                    alt="대표이미지"
                    style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: C.text, margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sharedDraft.name}
                    </p>
                    <p style={{ fontSize: '12px', color: C.textSub, margin: 0 }}>
                      쿠팡 {Number(sharedDraft.coupangPrice || 0).toLocaleString()}원 /
                      네이버 {Number(sharedDraft.naverPrice || 0).toLocaleString()}원
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
              )}
            </div>
          )}

          {!domeggookSuccess && (
            <div style={{ fontSize: '11px', color: C.textSub, lineHeight: 1.5 }}>
              도매꾹 상품 상세 페이지 URL에서 상품번호를 확인하세요.
              <br />
              예: domeggook.com/goods/<strong>12345678</strong>
            </div>
          )}
        </div>
      </div>

      {/* 하단: 상품 기본 정보 */}
      <div
        style={{
          backgroundColor: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: '12px',
          padding: '20px',
        }}
      >
        <div style={{ fontSize: '14px', fontWeight: 700, color: C.text, marginBottom: '16px' }}>
          상품 기본 정보
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '16px', alignItems: 'start' }}>
          {/* 상품명 */}
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

          {/* 판매가 + 마진 계산기 */}
          <PriceWithMarginCalc />


          {/* 플랫폼 선택 */}
          <div>
            <label style={labelStyle}>등록 플랫폼</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {(
                [
                  { value: 'both', label: '쿠팡 + 네이버 동시' },
                  { value: 'coupang', label: '쿠팡만' },
                  { value: 'naver', label: '네이버만' },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '13px',
                    color: C.text,
                    cursor: 'pointer',
                  }}
                >
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
      </div>

      {/* 하단 버튼 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>

        {!canProceed && (
          <p style={{ fontSize: '12px', color: C.textSub, margin: 0 }}>
            사진을 1장 이상 업로드하거나 도매꾹 상품번호를 불러와 주세요.
          </p>
        )}
        <button
          onClick={handleNext}
          disabled={!canProceed}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '11px 28px',
            fontSize: '14px',
            fontWeight: 700,
            backgroundColor: canProceed ? C.accent : '#ccc',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: canProceed ? 'pointer' : 'not-allowed',
            transition: 'background-color 0.15s',
          }}
        >
          다음 단계
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 서브 컴포넌트: 판매가 + 추천가 계산기
// ─────────────────────────────────────────────────────────────────────────────

// 목표 마진율로 역산한 추천 판매가 계산
// 쿠팡 윙: commission(10.8%) + shippingCommission(배송비×3.3%) + shippingFee
// → sellingPrice = (costPrice + shippingFee × 1.033) / (1 - commissionRate - targetMargin/100)
function calcRecommendedPrice(costPrice: number, shippingFee: number, commissionRate: number, targetMarginRate: number): number {
  const denominator = 1 - commissionRate - targetMarginRate / 100;
  if (denominator <= 0) return 0;
  const raw = (costPrice + shippingFee * 1.033) / denominator;
  return Math.ceil(raw / 100) * 100; // 100원 단위 올림
}

function PriceWithMarginCalc() {
  const { sharedDraft, updateSharedDraft } = useListingStore();
  const [open, setOpen] = useState(false);
  const [shippingFee, setShippingFee] = useState(3000);

  const costPrice = Number(sharedDraft.costPrice) || 0;
  const targetMargin = sharedDraft.targetMarginRate;

  const recommendations = useMemo(() => {
    if (!costPrice) return null;

    const coupangPrice = calcRecommendedPrice(costPrice, shippingFee, 0.108, targetMargin);
    const naverPrice = calcRecommendedPrice(costPrice, shippingFee, 0.036, targetMargin);

    // 실제 마진율 검증
    const coupangResult = calcCoupangWing({ costPrice, sellingPrice: coupangPrice, category: '생활용품', shippingFee, adCost: 0 });
    const naverResult = calcNaver({ costPrice, sellingPrice: naverPrice, shippingFee, grade: '일반', inflow: '네이버쇼핑', adCost: 0 });

    return {
      coupang: { price: coupangPrice, margin: coupangResult.marginRate },
      naver: { price: naverPrice, margin: naverResult.marginRate },
    };
  }, [costPrice, shippingFee, targetMargin]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* 판매가 직접 입력 */}
      <div>
        <label style={labelStyle}>판매가</label>
        <div style={{ position: 'relative' }}>
          <input
            style={{ ...inputStyle, paddingRight: '28px' }}
            type="number"
            value={sharedDraft.salePrice}
            onChange={(e) => updateSharedDraft({ salePrice: e.target.value })}
            placeholder="0"
            min={0}
          />
          <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '12px', color: C.textSub }}>원</span>
        </div>
      </div>

      {/* 마진 계산기 토글 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          fontSize: '12px', fontWeight: 600, color: C.accent,
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        }}
      >
        <Calculator size={13} />
        추천 판매가 계산
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {open && (
        <div style={{ background: '#f7f8fa', border: `1px solid ${C.border}`, borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* 입력 행 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <div>
              <label style={labelStyle}>원가 (공급가)</label>
              <div style={{ position: 'relative' }}>
                <input
                  style={{ ...inputStyle, paddingRight: '24px', backgroundColor: '#fff' }}
                  type="number"
                  value={sharedDraft.costPrice}
                  onChange={(e) => updateSharedDraft({ costPrice: e.target.value })}
                  placeholder="0"
                  min={0}
                />
                <span style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: C.textSub }}>원</span>
              </div>
            </div>
            <div>
              <label style={labelStyle}>배송비</label>
              <div style={{ position: 'relative' }}>
                <input
                  style={{ ...inputStyle, paddingRight: '24px', backgroundColor: '#fff' }}
                  type="number"
                  value={shippingFee}
                  onChange={(e) => setShippingFee(Number(e.target.value))}
                  min={0}
                />
                <span style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: C.textSub }}>원</span>
              </div>
            </div>
            <div>
              <label style={labelStyle}>목표 마진율</label>
              <div style={{ position: 'relative' }}>
                <input
                  style={{ ...inputStyle, paddingRight: '24px', backgroundColor: '#fff' }}
                  type="number"
                  value={targetMargin}
                  onChange={(e) => updateSharedDraft({ targetMarginRate: Number(e.target.value) })}
                  min={1}
                  max={80}
                />
                <span style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: C.textSub }}>%</span>
              </div>
            </div>
          </div>

          {/* 추천가 결과 */}
          {recommendations ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {[
                { label: '쿠팡 (윙·생활용품)', price: recommendations.coupang.price, margin: recommendations.coupang.margin, platform: 'coupang' as const },
                { label: '네이버 스마트스토어', price: recommendations.naver.price, margin: recommendations.naver.margin, platform: 'naver' as const },
              ].map((item) => (
                <div
                  key={item.platform}
                  style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '10px 12px' }}
                >
                  <div style={{ fontSize: '11px', color: C.textSub, marginBottom: '4px' }}>{item.label}</div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: C.text }}>
                    {item.price.toLocaleString()}원
                  </div>
                  <div style={{ fontSize: '11px', color: item.margin >= targetMargin - 1 ? '#16a34a' : '#ef4444', marginBottom: '8px' }}>
                    마진율 {item.margin.toFixed(1)}%
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const patch: Record<string, string> = {
                        salePrice: String(item.price),
                        [`${item.platform}Price`]: String(item.price),
                      };
                      updateSharedDraft(patch as Parameters<typeof updateSharedDraft>[0]);
                    }}
                    style={{
                      fontSize: '11px', fontWeight: 600, color: C.accent,
                      background: 'rgba(190,0,20,0.06)', border: `1px solid rgba(190,0,20,0.2)`,
                      borderRadius: '5px', padding: '4px 10px', cursor: 'pointer',
                    }}
                  >
                    이 가격으로 설정
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: '12px', color: C.textSub, margin: 0, textAlign: 'center' }}>
              원가를 입력하면 플랫폼별 추천 판매가를 계산합니다
            </p>
          )}

          <p style={{ fontSize: '11px', color: C.textSub, margin: 0 }}>
            * 쿠팡 수수료 10.8%(생활용품 기준), 네이버 수수료 3.6% 기준. 실제 수수료와 다를 수 있습니다.
          </p>
        </div>
      )}
    </div>
  );
}
