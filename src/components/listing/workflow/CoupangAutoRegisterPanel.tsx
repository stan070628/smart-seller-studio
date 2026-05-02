'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useListingStore } from '@/store/useListingStore';
import { resolveCoupangFee } from '@/lib/calculator/coupang-fees';
import { calcCoupangWing } from '@/lib/calculator/calculate';
import type { MappedCoupangFields } from '@/lib/auto-register/types';

// ─── buildDraftData: 로컬 state → /api/listing/coupang/drafts 페이로드 변환 ───

export interface DraftFormState {
  name: string;
  categoryCode: string;
  brand: string;
  manufacturer: string;
  salePrice: number;
  originalPrice: number;
  stock: number;
  thumbnail: string;
  detailHtml: string;
  deliveryChargeType: 'FREE' | 'NOT_FREE';
  deliveryCharge: number;
  outboundCode: string;
  returnCode: string;
  notices: { categoryName: string; detailName: string; content: string }[];
  tags: string[];
  detailImages: string[];
  adultOnly: 'EVERYONE' | 'ADULTS_ONLY';
  taxType: 'TAX' | 'TAX_FREE';
  parallelImported: 'NOT_PARALLEL_IMPORTED' | 'PARALLEL_IMPORTED';
}

export interface DraftData {
  name: string;
  categoryCode: string;
  brand: string;
  manufacturer: string;
  salePrice: number;
  originalPrice: number;
  stock: number;
  thumbnail: string;
  detailHtml: string;
  deliveryChargeType: 'FREE' | 'NOT_FREE';
  deliveryCharge: number;
  outboundCode: string;
  returnCode: string;
  notices: { categoryName: string; detailName: string; content: string }[];
  tags: string[];
  detailImages: string[];
  adultOnly: 'EVERYONE' | 'ADULTS_ONLY';
  taxType: 'TAX' | 'TAX_FREE';
  parallelImported: 'NOT_PARALLEL_IMPORTED' | 'PARALLEL_IMPORTED';
}

export function buildDraftData(s: DraftFormState): DraftData {
  // thumbnail 폴백: thumbnail 없으면 detailImages[0] 사용
  const thumbnail = s.thumbnail || s.detailImages[0] || '';

  // originalPrice 보정: salePrice 이하면 salePrice × 1.25 올림
  const safeOriginal =
    s.originalPrice > s.salePrice
      ? s.originalPrice
      : Math.ceil((s.salePrice * 1.25) / 1000) * 1000;

  return {
    name: s.name,
    categoryCode: s.categoryCode,
    brand: s.brand,
    manufacturer: s.manufacturer,
    salePrice: s.salePrice,
    originalPrice: safeOriginal,
    stock: s.stock,
    thumbnail,
    detailHtml: s.detailHtml,
    deliveryChargeType: s.deliveryChargeType,
    deliveryCharge: s.deliveryCharge,
    outboundCode: s.outboundCode,
    returnCode: s.returnCode,
    notices: s.notices,
    tags: s.tags,
    detailImages: s.detailImages,
    adultOnly: s.adultOnly,
    taxType: s.taxType,
    parallelImported: s.parallelImported,
  };
}

export interface CoupangAutoRegisterPanelProps {
  onSuccess: () => void;
}

export default function CoupangAutoRegisterPanel({ onSuccess }: CoupangAutoRegisterPanelProps) {
  const { sharedDraft } = useListingStore();

  // ── 기본 정보 ─────────────────────────────────────────────────────────────
  const [name, setName] = useState(sharedDraft.name);
  const [categoryCode, setCategoryCode] = useState(sharedDraft.coupangCategoryCode || '');
  const [categorySearch, setCategorySearch] = useState('');
  const [categoryResults, setCategoryResults] = useState<
    { displayCategoryCode: number; displayCategoryName: string; fullPath: string }[]
  >([]);
  const [isCategorySearching, setIsCategorySearching] = useState(false);
  const [categoryValid, setCategoryValid] = useState<boolean | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [categoryFullPath, setCategoryFullPath] = useState(sharedDraft.coupangCategoryPath || '');

  // ── 상품 주요 정보 ─────────────────────────────────────────────────────────
  const [brand, setBrand] = useState('');
  const [manufacturer, setManufacturer] = useState(sharedDraft.manufacturer || '');
  const [adultOnly, setAdultOnly] = useState<'EVERYONE' | 'ADULTS_ONLY'>('EVERYONE');
  const [taxType, setTaxType] = useState<'TAX' | 'TAX_FREE'>('TAX');
  const [parallelImported, setParallelImported] = useState<
    'NOT_PARALLEL_IMPORTED' | 'PARALLEL_IMPORTED'
  >('NOT_PARALLEL_IMPORTED');

  // ── 가격·재고 ─────────────────────────────────────────────────────────────
  const [salePrice, setSalePrice] = useState(Number(sharedDraft.salePrice) || 0);
  const initSale = Number(sharedDraft.salePrice) || 0;
  const initOrig = Number(sharedDraft.originalPrice) || 0;
  const [originalPrice, setOriginalPrice] = useState(
    initOrig > initSale && initOrig > 0
      ? initOrig
      : initSale > 0
        ? Math.ceil((initSale * 1.25) / 1000) * 1000
        : 0,
  );
  const [stock, setStock] = useState(Number(sharedDraft.stock) || 100);
  const [customFeeRate, setCustomFeeRate] = useState('');

  // ── 배송·반품: 계정 고정값(무료배송) — UI 없음, outbound/return은 API에서 자동 로드 ──
  const [outboundCode, setOutboundCode] = useState('');
  const [returnCode, setReturnCode] = useState('');

  // ── 고시정보 ──────────────────────────────────────────────────────────────
  const [notices, setNotices] = useState<
    { categoryName: string; detailName: string; content: string }[]
  >([]);
  const [isNoticeFetching, setIsNoticeFetching] = useState(false);

  // ── 검색 태그 ─────────────────────────────────────────────────────────────
  const [tags, setTags] = useState<string[]>(sharedDraft.tags || []);
  const [tagInput, setTagInput] = useState('');

  // ── 임시저장 / 제출 ───────────────────────────────────────────────────────
  // draft 목록에서 불러온 경우 sharedDraft.coupangDraftId가 세팅되어 있음
  const [draftId, setDraftId] = useState<string | null>(sharedDraft.coupangDraftId ?? null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    sellerProductId: number;
    wingsUrl: string;
  } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draftFeedback, setDraftFeedback] = useState<'saved' | 'error' | null>(null);
  const [draftSaveError, setDraftSaveError] = useState('');

  // ── AI 매핑 ───────────────────────────────────────────────────────────────
  const [isAiMapping, setIsAiMapping] = useState(true);
  const [mappedFields, setMappedFields] = useState<MappedCoupangFields | null>(null);
  const aiMappingDone = useRef(false);

  // ── 마운트: 배송 기본값 + AI 매핑 ─────────────────────────────────────────
  useEffect(() => {
    // 배송 기본값 로드
    fetch('/api/auto-register/delivery-defaults')
      .then((r) => r.json())
      .then((d: { outboundShippingPlaceCode?: string; returnCenterCode?: string }) => {
        if (d.outboundShippingPlaceCode) setOutboundCode((p) => p || d.outboundShippingPlaceCode!);
        if (d.returnCenterCode) setReturnCode((p) => p || d.returnCenterCode!);
      })
      .catch(() => {});

    // AI 매핑 (1회만)
    if (aiMappingDone.current || !sharedDraft.name) {
      setIsAiMapping(false);
      return;
    }
    aiMappingDone.current = true;

    const product = {
      itemId: '',
      title: sharedDraft.name,
      price: Number(sharedDraft.salePrice) || 0,
      imageUrls: sharedDraft.thumbnailImages || [],
      description:
        (sharedDraft.description || '').replace(/<[^>]*>/g, '').slice(0, 500),
      categoryHint: sharedDraft.categoryHint || '',
    };

    fetch('/api/auto-register/ai-map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product }),
    })
      .then((r) => r.json())
      .then((data: { fields?: MappedCoupangFields; timedOut?: boolean }) => {
        if (!data.fields) return;
        const f = data.fields;
        setMappedFields(f);

        const aiBrand = f.brand.value;
        setBrand((prev) => (!prev && aiBrand && aiBrand !== '기타') ? aiBrand : (prev || '기타'));
        // 카테고리 코드는 AI 자동 채움 안 함 — 검증 안 된 코드라 사용자가 명시적으로 검색·선택해야 함
        // (참고용으로 mappedFields에만 보존되어 화면에 "AI 추천 참고: ..." 표시됨)
        setTags((prev) => (f.searchTags.value.length > 0 && prev.length === 0)
          ? f.searchTags.value.slice(0, 10)
          : prev);
      })
      .catch(() => {})
      .finally(() => setIsAiMapping(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 카테고리 코드 변경 시 유효성 검증 (800ms debounce) ───────────────────
  useEffect(() => {
    const code = categoryCode.trim();
    if (!code) { setCategoryValid(null); return; }
    setCategoryValid(null);
    setIsValidating(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/auto-register/validate-category?categoryCode=${encodeURIComponent(code)}`,
        );
        const data = (await res.json()) as { valid: boolean; fullPath?: string };
        setCategoryValid(data.valid);
        if (data.valid && data.fullPath) setCategoryFullPath(data.fullPath);
      } catch {
        setCategoryValid(null);
      } finally {
        setIsValidating(false);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [categoryCode]);

  // ── 카테고리 코드 변경 시 고시정보 자동 생성 ─────────────────────────────
  useEffect(() => {
    const code = categoryCode.trim();
    if (!code || !name) return;
    const timer = setTimeout(async () => {
      setIsNoticeFetching(true);
      try {
        const cert = sharedDraft.certification ?? '';
        // productSpecText: 구조화된 스펙 텍스트 (Costco features 등). 없으면 description HTML을 텍스트로 변환.
        const rawDesc = sharedDraft.productSpecText ?? (sharedDraft.description ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const params = new URLSearchParams({ categoryCode: code, productName: name });
        if (cert) params.set('certification', cert);
        if (rawDesc) params.set('productDesc', rawDesc.slice(0, 1000));
        if (sharedDraft.countryOfOrigin) params.set('countryOfOrigin', sharedDraft.countryOfOrigin);
        const url = `/api/auto-register/category-notices?${params.toString()}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = (await res.json()) as {
            notices?: { categoryName: string; detailName: string; content: string }[];
          };
          if (data.notices && data.notices.length > 0) {
            const AS_MANAGER_RE = /A\/S|애프터서비스|서비스\s*책임자/i;
            const AS_PHONE_RE = /A\/S\s*전화|전화\s*번호|연락처/i;
            const fixed = data.notices.map((n) => {
              if (AS_MANAGER_RE.test(n.detailName)) return { ...n, content: '청연코퍼레이션' };
              if (AS_PHONE_RE.test(n.detailName)) return { ...n, content: '010-5169-2357' };
              return n;
            });
            setNotices(fixed);
          }
        }
      } catch { /* 실패 시 기존 notices 유지 */ } finally {
        setIsNoticeFetching(false);
      }
    }, 800);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryCode]);

  // ── 개선 2: 고시정보 품질 경고 카운트 ────────────────────────────────────
  const vagueNoticeCount = notices.filter((n) => n.content.includes('상품 상세 참조')).length;

  // ── 개선 3: 상세설명 유무 ─────────────────────────────────────────────────
  const hasDetailHtml = !!sharedDraft.detailPageSnippet;

  // ── 가격 계산 ─────────────────────────────────────────────────────────────
  const feeMatch = resolveCoupangFee(categoryFullPath || sharedDraft.categoryHint || '');
  const customRate = customFeeRate ? parseFloat(customFeeRate) / 100 : null;
  const effectiveFeeRate =
    customRate && customRate > 0 && customRate < 1 ? customRate : feeMatch.rate;
  const sourcingCost = Number(sharedDraft.costPrice) || 0;   // 소싱 원가 (Step1에서 저장)
  const ACTUAL_SHIPPING_COST = 3000;                          // 무료배송 시 판매자 부담 택배비
  const calc = calcCoupangWing({
    costPrice: sourcingCost + ACTUAL_SHIPPING_COST,
    sellingPrice: salePrice,
    feeRate: effectiveFeeRate,
    shippingFee: 0,
    adCost: 0,
  });
  const commission = calc.items[0]?.amount ?? 0;
  const netProfit = calc.netProfit;
  const marginRate = calc.marginRate;

  // ── 카테고리 검색 ─────────────────────────────────────────────────────────
  async function doCategorySearch(kw: string) {
    if (!kw) return;
    setIsCategorySearching(true);
    try {
      const res = await fetch(
        `/api/auto-register/search-category?keyword=${encodeURIComponent(kw)}`,
      );
      const data = (await res.json()) as {
        categories: { displayCategoryCode: number; displayCategoryName: string; fullPath: string }[];
      };
      setCategoryResults(data.categories ?? []);
    } catch { setCategoryResults([]); } finally { setIsCategorySearching(false); }
  }

  // ── 임시저장 ─────────────────────────────────────────────────────────────
  async function handleSaveDraft() {
    // 카테고리 코드 가드 — 비어있거나 검증 실패 시 임시저장 차단
    const code = categoryCode.trim();
    if (!code || !/^\d+$/.test(code)) {
      alert('카테고리를 먼저 선택하세요.\n\n"이름으로 검색"에서 키워드(예: 반팔티)로 검색 후 결과를 클릭하면 코드가 자동 입력됩니다.');
      return;
    }
    if (categoryValid === false) {
      alert('유효하지 않은 카테고리 코드입니다.\n\n"이름으로 검색"으로 다시 선택하세요.');
      return;
    }

    setIsSavingDraft(true);
    setDraftFeedback(null);

    const detailImages = sharedDraft.pickedDetailImages.length > 0
      ? sharedDraft.pickedDetailImages
      : sharedDraft.detailImages;

    const draftData = {
      // 쿠팡 등록 폼 필드
      ...buildDraftData({
        name,
        categoryCode,
        brand,
        manufacturer,
        salePrice,
        originalPrice,
        stock,
        thumbnail: sharedDraft.thumbnailImages[0] || '',
        detailHtml: sharedDraft.detailPageSnippet || sharedDraft.description || '',
        deliveryChargeType: 'FREE',
        deliveryCharge: 0,
        outboundCode,
        returnCode,
        notices,
        tags,
        detailImages,
        adultOnly,
        taxType,
        parallelImported,
      }),
      // sharedDraft 복원용 미디어·AI 필드 (불러오기 시 초기화 방지)
      thumbnailImages: sharedDraft.thumbnailImages,
      detailImages: sharedDraft.detailImages,
      pickedDetailImages: sharedDraft.pickedDetailImages,
      description: sharedDraft.description,
      detailPageFullHtml: sharedDraft.detailPageFullHtml,
      detailPageSnippet: sharedDraft.detailPageSnippet,
      detailPageSnippetNaver: sharedDraft.detailPageSnippetNaver,
      detailPageStatus: sharedDraft.detailPageStatus,
      detailPageSkipped: sharedDraft.detailPageSkipped,
      categoryHint: sharedDraft.categoryHint,
      coupangCategoryCode: categoryCode,
      coupangCategoryPath: categoryFullPath,
      costPrice: sharedDraft.costPrice,
      certification: sharedDraft.certification,
      salePrice: String(salePrice),
      originalPrice: String(originalPrice),
      sourceUrl: sharedDraft.sourceUrl,
    };

    try {
      if (draftId) {
        const res = await fetch(`/api/listing/coupang/drafts/${draftId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productName: name, draftData }),
        });
        if (!res.ok) throw new Error(await res.text());
      } else {
        const res = await fetch('/api/listing/coupang/drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productName: name,
            sourceUrl: sharedDraft.sourceUrl ?? null,
            sourceType: 'workflow',
            draftData,
          }),
        });
        const data = (await res.json()) as { id?: string; error?: string };
        if (!res.ok || !data.id) throw new Error(data.error ?? '임시저장 실패');
        setDraftId(data.id);
        // sharedDraft에도 저장 — 이후 draft 불러오기 시 제출 즉시 활성화
        useListingStore.getState().updateSharedDraft({ coupangDraftId: data.id });
      }
      setDraftFeedback('saved');
      setTimeout(() => setDraftFeedback(null), 2000);
    } catch (err) {
      setDraftSaveError(err instanceof Error ? err.message : '저장 실패');
      setDraftFeedback('error');
      setTimeout(() => setDraftFeedback(null), 3000);
    } finally {
      setIsSavingDraft(false);
    }
  }

  // ── 쿠팡 제출 ────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!draftId) return;
    const confirmed = window.confirm(
      '쿠팡에 상품을 등록하시겠습니까?\n\n등록 후에는 Wing에서 직접 수정해야 합니다.'
    );
    if (!confirmed) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/listing/coupang/drafts/${draftId}/submit`, {
        method: 'POST',
      });
      const data = (await res.json()) as {
        success: boolean;
        sellerProductId?: number;
        wingsUrl?: string;
        error?: string;
      };
      if (data.success && data.sellerProductId) {
        setSubmitResult({
          sellerProductId: data.sellerProductId,
          wingsUrl: data.wingsUrl ?? 'https://wing.coupang.com',
        });
        setSubmitSuccess(true);
        setTimeout(() => onSuccess(), 1500);
      } else {
        setSubmitError(data.error ?? '제출 실패');
      }
    } catch {
      setSubmitError('네트워크 오류');
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── JSX ─────────────────────────────────────────────────────────────────
  const C = {
    border: '#e5e5e5',
    text: '#18181b',
    textSub: '#71717a',
    accent: '#be0014',
    card: '#ffffff',
    header: '#f3f3f3',
  } as const;

  const section: React.CSSProperties = {
    backgroundColor: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: '12px',
    padding: '18px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  };

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

  const label: React.CSSProperties = {
    display: 'block',
    fontSize: '12px',
    fontWeight: 600,
    color: C.textSub,
    marginBottom: '5px',
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: '13px',
    fontWeight: 700,
    color: C.text,
    margin: 0,
  };

  if (submitSuccess && submitResult) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '40px 20px', backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: '12px', textAlign: 'center' }}>
        <div style={{ fontSize: '40px', color: '#15803d' }}>✓</div>
        <div>
          <p style={{ fontWeight: 700, color: C.text, margin: '0 0 6px' }}>쿠팡 제출 완료 (검수 대기)</p>
          <p style={{ fontSize: '13px', color: C.textSub, margin: '0 0 4px' }}>상품 ID: {submitResult.sellerProductId}</p>
          <p style={{ fontSize: '12px', color: C.textSub, margin: 0 }}>고객 노출 전 Wings에서 내용을 확인하세요</p>
        </div>
        <a
          href={submitResult.wingsUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ padding: '10px 20px', backgroundColor: '#1d4ed8', color: '#fff', borderRadius: '8px', fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}
        >
          Wings에서 확인하기 →
        </a>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* AI 매핑 배너 */}
      {isAiMapping && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', fontSize: '12px', color: '#1d4ed8' }}>
          <div style={{ width: '14px', height: '14px', border: '2px solid #93c5fd', borderTopColor: '#1d4ed8', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
          AI 필드 매핑 중... 상품 정보를 분석하고 있습니다
        </div>
      )}
      {!isAiMapping && mappedFields && (
        <div style={{ padding: '8px 14px', backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', fontSize: '12px', color: '#15803d' }}>
          ✓ AI 자동완성 완료 — 값을 검토하고 필요시 수정하세요
        </div>
      )}

      {/* ── 섹션 1: 기본 정보 ──────────────────────────────────────────────── */}
      <div style={section}>
        <p style={sectionTitle}>기본 정보</p>

        {/* 상품명 */}
        <div>
          <label style={label}>
            상품명
            {mappedFields?.sellerProductName.confidence !== undefined && (
              <span style={{ marginLeft: '6px', fontSize: '11px', color: C.textSub }}>
                AI {Math.round((mappedFields.sellerProductName.confidence) * 100)}%
              </span>
            )}
          </label>
          <input
            style={inputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="상품명"
          />
        </div>

        {/* 카테고리 */}
        <div>
          <label style={label}>
            카테고리 코드
            {isValidating && <span style={{ marginLeft: '6px', fontSize: '11px', color: C.textSub }}>확인 중...</span>}
            {!isValidating && categoryValid === true && <span style={{ marginLeft: '6px', fontSize: '11px', color: '#15803d' }}>✓ 유효</span>}
            {!isValidating && categoryValid === false && <span style={{ marginLeft: '6px', fontSize: '11px', color: '#b91c1c' }}>✗ 없는 코드</span>}
          </label>
          {mappedFields?.displayCategoryCode.value ? (
            <p style={{ fontSize: '11px', color: C.textSub, margin: '0 0 5px' }}>
              AI 추천 참고: {mappedFields.displayCategoryCode.value} (유효 여부 불확실)
            </p>
          ) : null}
          <input
            style={{
              ...inputStyle,
              borderColor: categoryValid === false ? '#f87171' : categoryValid === true ? '#86efac' : C.border,
            }}
            value={categoryCode}
            onChange={(e) => {
              // 숫자만 허용 — 비숫자 문자는 자동 제거. 한글로 검색하려면 아래 "이름으로 검색" 사용.
              const v = e.target.value.replace(/\D/g, '');
              setCategoryCode(v);
              if (v !== categoryCode) {
                setCategoryResults([]);
                setCategoryFullPath('');
              }
            }}
            inputMode="numeric"
            placeholder="숫자 코드 입력 (예: 78780) — 모르면 아래 '이름으로 검색' 사용"
          />
          {categoryFullPath && (
            <p style={{ fontSize: '11px', color: C.textSub, margin: '4px 0 0' }}>{categoryFullPath}</p>
          )}
          {/* 이름 검색 */}
          <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              value={categorySearch}
              onChange={(e) => setCategorySearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doCategorySearch(categorySearch)}
              placeholder="이름으로 검색 (예: 유리발수코팅제)"
            />
            <button
              type="button"
              onClick={() => doCategorySearch(categorySearch.trim() || name)}
              disabled={isCategorySearching}
              style={{ padding: '9px 14px', fontSize: '12px', fontWeight: 600, backgroundColor: isCategorySearching ? '#e5e7eb' : '#1d4ed8', color: isCategorySearching ? C.textSub : '#fff', border: 'none', borderRadius: '8px', cursor: isCategorySearching ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
            >
              {isCategorySearching ? '검색 중...' : '검색'}
            </button>
          </div>
          {categoryResults.length > 0 && (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden', overflowY: 'auto', maxHeight: '240px', marginTop: '4px' }}>
              {categoryResults.map((c) => (
                <button
                  key={c.displayCategoryCode}
                  type="button"
                  onClick={() => {
                    setCategoryCode(String(c.displayCategoryCode));
                    setCategoryFullPath(c.fullPath);
                    setCategoryResults([]);
                    setCategorySearch('');
                  }}
                  style={{ width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: '12px', backgroundColor: '#fff', border: 'none', borderBottom: `1px solid ${C.border}`, cursor: 'pointer', color: C.text }}
                >
                  <strong>{c.displayCategoryCode}</strong>
                  <span style={{ marginLeft: '8px', color: C.textSub }}>{c.fullPath}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 섹션 2: 상품 주요 정보 ──────────────────────────────────────────── */}
      <div style={section}>
        <p style={sectionTitle}>상품 주요 정보</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label style={label}>브랜드</label>
            <input style={inputStyle} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="기타" />
          </div>
          <div>
            <label style={label}>제조사</label>
            <input style={inputStyle} value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} placeholder="직접 입력" />
          </div>
          <div>
            <label style={label}>성인 여부</label>
            <select style={inputStyle} value={adultOnly} onChange={(e) => setAdultOnly(e.target.value as 'EVERYONE' | 'ADULTS_ONLY')}>
              <option value="EVERYONE">전체 이용가</option>
              <option value="ADULTS_ONLY">성인 전용</option>
            </select>
          </div>
          <div>
            <label style={label}>부가세</label>
            <select style={inputStyle} value={taxType} onChange={(e) => setTaxType(e.target.value as 'TAX' | 'TAX_FREE')}>
              <option value="TAX">과세</option>
              <option value="TAX_FREE">면세</option>
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={label}>병행수입</label>
            <select style={inputStyle} value={parallelImported} onChange={(e) => setParallelImported(e.target.value as 'NOT_PARALLEL_IMPORTED' | 'PARALLEL_IMPORTED')}>
              <option value="NOT_PARALLEL_IMPORTED">비병행수입</option>
              <option value="PARALLEL_IMPORTED">병행수입</option>
            </select>
          </div>
        </div>
        {/* 개선 1: KC 인증번호 표시 */}
        {sharedDraft.certification && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '6px', fontSize: '11px', color: '#166534' }}>
            <span style={{ fontWeight: 700 }}>KC 인증</span>
            <span>{sharedDraft.certification}</span>
          </div>
        )}
      </div>

      {/* ── 섹션 3: 가격·재고 ────────────────────────────────────────────────── */}
      <div style={section}>
        <p style={sectionTitle}>가격 · 재고</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
          <div>
            <label style={label}>판매가 (원)</label>
            <input style={inputStyle} type="number" value={salePrice} onChange={(e) => setSalePrice(Number(e.target.value))} min={0} />
          </div>
          <div>
            <label style={label}>정가 (원)</label>
            <input style={inputStyle} type="number" value={originalPrice} onChange={(e) => setOriginalPrice(Number(e.target.value))} min={0} />
          </div>
          <div>
            <label style={label}>재고 수량</label>
            <input style={inputStyle} type="number" value={stock} onChange={(e) => setStock(Number(e.target.value))} min={0} />
          </div>
        </div>
        {/* 수수료 · 수익 계산 */}
        {salePrice > 0 && (
          <div style={{ padding: '10px 12px', backgroundColor: '#f8f9fa', border: `1px solid ${C.border}`, borderRadius: '8px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {sourcingCost > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: C.textSub }}>소싱 원가</span>
                <span style={{ color: '#b91c1c' }}>-{sourcingCost.toLocaleString()}원</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: C.textSub }}>
                판매 수수료 ({feeMatch.matched ? feeMatch.categoryName : '기본'} {(effectiveFeeRate * 100).toFixed(1)}%)
              </span>
              <span style={{ color: '#b91c1c' }}>-{commission.toLocaleString()}원</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: C.textSub }}>실 배송비 (추정)</span>
              <span style={{ color: '#b91c1c' }}>-{ACTUAL_SHIPPING_COST.toLocaleString()}원</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${C.border}`, paddingTop: '5px', marginTop: '2px' }}>
              <span style={{ fontWeight: 700, color: C.text }}>예상 수익</span>
              <span style={{ fontWeight: 700, color: netProfit >= 0 ? '#15803d' : '#b91c1c' }}>
                {netProfit.toLocaleString()}원
                <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: 400, color: netProfit >= 0 ? '#15803d' : '#b91c1c' }}>
                  ({marginRate.toFixed(1)}%)
                </span>
              </span>
            </div>
            <div style={{ marginTop: '4px' }}>
              <label style={{ ...label, marginBottom: '3px' }}>수수료율 직접 입력 (%)</label>
              <input
                style={{ ...inputStyle, width: '100px' }}
                type="number"
                step="0.1"
                value={customFeeRate}
                onChange={(e) => setCustomFeeRate(e.target.value)}
                placeholder="예: 10.8"
              />
            </div>
          </div>
        )}
      </div>

      {/* 배송·반품: 모두 계정 고정값(무료배송/출하지/반품센터) → UI 불필요 */}

      {/* ── 섹션 5: 고시정보 ─────────────────────────────────────────────────── */}
      <div style={section}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={sectionTitle}>고시정보 (법정 표기사항)</p>
          {isNoticeFetching && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#1d4ed8' }}>
              <div style={{ width: '12px', height: '12px', border: '2px solid #93c5fd', borderTopColor: '#1d4ed8', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              AI 생성 중...
            </div>
          )}
        </div>
        {/* 개선 2: 고시정보 품질 경고 */}
        {vagueNoticeCount >= 3 && (
          <div style={{ padding: '8px 12px', backgroundColor: '#fffbeb', border: '1px solid #fbbf24', borderRadius: '6px', fontSize: '11px', color: '#92400e', marginBottom: '8px' }}>
            ⚠ {vagueNoticeCount}개 항목이 &quot;상품 상세 참조&quot;입니다. 실제 값으로 수정하면 승인률이 높아집니다.
          </div>
        )}
        {notices.length === 0 && !isNoticeFetching && (
          <p style={{ fontSize: '12px', color: C.textSub }}>카테고리 코드를 입력하면 AI가 자동으로 작성합니다.</p>
        )}
        {notices.map((n, i) => {
          const isFixed = /A\/S|애프터서비스|서비스\s*책임자|전화\s*번호|연락처/i.test(n.detailName);
          return (
            <div key={`${n.categoryName}-${n.detailName}`}>
              <label style={{ ...label, fontSize: '11px' }}>
                {n.categoryName} › {n.detailName}
                {isFixed && <span style={{ marginLeft: '5px', color: '#6b7280', fontSize: '10px', fontWeight: 400 }}>고정값</span>}
              </label>
              <input
                style={{ ...inputStyle, backgroundColor: isFixed ? '#f3f4f6' : '#fff', color: isFixed ? '#6b7280' : C.text }}
                value={n.content}
                readOnly={isFixed}
                onChange={isFixed ? undefined : (e) => {
                  const updated = [...notices];
                  updated[i] = { ...updated[i], content: e.target.value };
                  setNotices(updated);
                }}
                placeholder="직접 입력하거나 AI 생성 값을 수정하세요"
              />
            </div>
          );
        })}
      </div>

      {/* ── 섹션 6: 검색 태그 ───────────────────────────────────────────────── */}
      <div style={section}>
        <p style={sectionTitle}>검색 태그 (최대 10개)</p>
        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const t = tagInput.trim();
                if (t && !tags.includes(t) && tags.length < 10) {
                  setTags([...tags, t]);
                  setTagInput('');
                }
              }
            }}
            placeholder="태그 입력 후 Enter"
          />
          <button
            type="button"
            onClick={() => {
              const t = tagInput.trim();
              if (t && !tags.includes(t) && tags.length < 10) {
                setTags([...tags, t]);
                setTagInput('');
              }
            }}
            style={{ padding: '9px 14px', fontSize: '12px', fontWeight: 600, backgroundColor: C.header, color: C.text, border: `1px solid ${C.border}`, borderRadius: '8px', cursor: 'pointer' }}
          >
            추가
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
          {tags.map((tag) => (
            <span
              key={tag}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 10px', backgroundColor: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: '100px', fontSize: '12px' }}
            >
              {tag}
              <button
                type="button"
                onClick={() => setTags(tags.filter((t) => t !== tag))}
                style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', padding: 0, fontSize: '14px', lineHeight: 1 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* ── 액션 바 ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '4px' }}>
        {submitError && (
          <div style={{ padding: '12px 14px', backgroundColor: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', fontSize: '12px', color: '#b91c1c' }}>
            <div style={{ fontWeight: 700, marginBottom: '4px' }}>쿠팡 등록 실패</div>
            <div style={{ lineHeight: '1.5', wordBreak: 'break-word' }}>{submitError}</div>
            <div style={{ marginTop: '6px', fontSize: '11px', color: '#991b1b', opacity: 0.85 }}>
              고시정보·카테고리 코드를 확인하고 임시저장 후 다시 제출해 주세요.
            </div>
          </div>
        )}
        {/* 개선 4: 임시저장 / 제출 버튼 분리 — 실수 클릭 방지 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={isSavingDraft || !name}
            style={{
              width: '100%', padding: '12px', fontSize: '13px', fontWeight: 600,
              backgroundColor: '#fff', color: C.text,
              border: `2px solid ${C.border}`, borderRadius: '10px',
              cursor: isSavingDraft || !name ? 'not-allowed' : 'pointer',
              opacity: !name ? 0.5 : 1,
            }}
          >
            {isSavingDraft ? '저장 중...' : draftId ? '임시저장 업데이트' : '임시저장'}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0' }}>
            <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e7eb' }} />
            <span style={{ fontSize: '10px', color: '#9ca3af', whiteSpace: 'nowrap' }}>저장 후 제출</span>
            <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e7eb' }} />
          </div>
          {/* 개선 3: 상세설명 없으면 제출 비활성화 */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !name || !draftId || !hasDetailHtml}
            title={!draftId ? '먼저 임시저장하세요' : !hasDetailHtml ? '상세설명을 먼저 생성하세요' : ''}
            style={{
              width: '100%', padding: '12px', fontSize: '13px', fontWeight: 700,
              backgroundColor: isSubmitting || !draftId || !hasDetailHtml
                ? '#e5e7eb'
                : categoryValid === false
                  ? '#b45309'
                  : '#15803d',
              color: isSubmitting || !draftId || !hasDetailHtml ? C.textSub : '#fff',
              border: 'none', borderRadius: '10px',
              cursor: isSubmitting || !draftId || !hasDetailHtml ? 'not-allowed' : 'pointer',
            }}
          >
            {isSubmitting
              ? '제출 중...'
              : categoryValid === false
                ? '⚠ 카테고리 확인 후 제출'
                : '쿠팡에 제출'}
          </button>
        </div>
        {draftFeedback === 'saved' && (
          <p style={{ fontSize: '11px', textAlign: 'center', color: '#15803d', fontWeight: 600 }}>저장됐습니다</p>
        )}
        {draftFeedback === 'error' && (
          <p style={{ fontSize: '11px', textAlign: 'center', color: '#b91c1c' }}>{draftSaveError || '저장에 실패했습니다'}</p>
        )}
        {!draftFeedback && !draftId && (
          <p style={{ fontSize: '11px', textAlign: 'center', color: C.textSub }}>임시저장 후 쿠팡에 제출할 수 있습니다</p>
        )}
      </div>
    </div>
  );
}
