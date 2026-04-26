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
  const [manufacturer, setManufacturer] = useState('');
  const [adultOnly, setAdultOnly] = useState<'EVERYONE' | 'ADULTS_ONLY'>('EVERYONE');
  const [taxType, setTaxType] = useState<'TAX' | 'TAX_FREE'>('TAX');
  const [parallelImported, setParallelImported] = useState<
    'NOT_PARALLEL_IMPORTED' | 'PARALLEL_IMPORTED'
  >('NOT_PARALLEL_IMPORTED');

  // ── 가격·재고 ─────────────────────────────────────────────────────────────
  const [salePrice, setSalePrice] = useState(Number(sharedDraft.salePrice) || 0);
  const [originalPrice, setOriginalPrice] = useState(Number(sharedDraft.originalPrice) || 0);
  const [stock, setStock] = useState(Number(sharedDraft.stock) || 100);
  const [customFeeRate, setCustomFeeRate] = useState('');

  // ── 배송·반품 ─────────────────────────────────────────────────────────────
  const [deliveryChargeType, setDeliveryChargeType] = useState<'FREE' | 'NOT_FREE'>(
    (sharedDraft.deliveryChargeType as 'FREE' | 'NOT_FREE') || 'FREE',
  );
  const [deliveryCharge, setDeliveryCharge] = useState(Number(sharedDraft.deliveryCharge) || 0);
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
  const [draftId, setDraftId] = useState<string | null>(null);
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
        if (!brand) setBrand((aiBrand && aiBrand !== '기타') ? aiBrand : '기타');
        if (f.deliveryChargeType.confidence >= 0.7)
          setDeliveryChargeType(f.deliveryChargeType.value as 'FREE' | 'NOT_FREE');
        if (f.deliveryCharge.confidence >= 0.7) setDeliveryCharge(f.deliveryCharge.value);
        if (f.searchTags.value.length > 0 && tags.length === 0)
          setTags(f.searchTags.value.slice(0, 10));
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
        const url = `/api/auto-register/category-notices?categoryCode=${encodeURIComponent(code)}&productName=${encodeURIComponent(name)}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = (await res.json()) as {
            notices?: { categoryName: string; detailName: string; content: string }[];
          };
          if (data.notices && data.notices.length > 0) setNotices(data.notices);
        }
      } catch { /* 실패 시 기존 notices 유지 */ } finally {
        setIsNoticeFetching(false);
      }
    }, 800);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryCode]);

  // ── 가격 계산 ─────────────────────────────────────────────────────────────
  const feeMatch = resolveCoupangFee(categoryFullPath || sharedDraft.categoryHint || '');
  const customRate = customFeeRate ? parseFloat(customFeeRate) / 100 : null;
  const effectiveFeeRate =
    customRate && customRate > 0 && customRate < 1 ? customRate : feeMatch.rate;
  const calc = calcCoupangWing({
    costPrice: 0,
    sellingPrice: salePrice,
    feeRate: effectiveFeeRate,
    shippingFee: deliveryChargeType === 'NOT_FREE' ? deliveryCharge : 0,
    adCost: 0,
  });
  const commission = customRate && salePrice > 0
    ? Math.round(salePrice * effectiveFeeRate)
    : (calc.items[0]?.amount ?? 0);

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
    setIsSavingDraft(true);
    setDraftFeedback(null);

    const detailImages = sharedDraft.pickedDetailImages.length > 0
      ? sharedDraft.pickedDetailImages
      : sharedDraft.detailImages;

    const draftData = buildDraftData({
      name,
      categoryCode,
      brand,
      manufacturer,
      salePrice,
      originalPrice,
      stock,
      thumbnail: sharedDraft.thumbnailImages[0] || '',
      detailHtml: sharedDraft.description || '',
      deliveryChargeType,
      deliveryCharge,
      outboundCode,
      returnCode,
      notices,
      tags,
      detailImages,
    });

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

  // ── JSX (Task 3에서 완전한 폼으로 교체) ──────────────────────────────────
  return (
    <div data-testid="coupang-auto-register-panel">
      {isAiMapping && <div>AI 필드 매핑 중...</div>}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
    </div>
  );
}
