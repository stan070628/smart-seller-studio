'use client';

/**
 * useRegisterForm.ts
 * BothRegisterForm의 모든 상태/로직을 분리한 커스텀 훅
 *
 * - prefill(도매꾹) 관련 로직 제거 (Phase 1에서 폐기)
 * - recalcChannelPrices → no-op (prefill.costBase/effectiveDeliFee 의존 제거)
 * - handleCancel은 컨테이너 컴포넌트에서 처리 (훅에 미포함)
 */

import { useState, useEffect, useCallback } from 'react';
import { useListingStore } from '@/store/useListingStore';

// ─────────────────────────────────────────────────────────────────────────────
// 쿠팡 세부 설정 localStorage
// ─────────────────────────────────────────────────────────────────────────────
const COUPANG_ITEM_DEFAULTS_KEY = 'sss_coupang_item_defaults';

interface CoupangItemDefaults {
  deliveryCompanyCode: string;
  outboundShippingTimeDay: number;
  adultOnly: 'EVERYONE' | 'ADULTS_ONLY';
  taxType: 'TAX' | 'TAX_FREE' | 'ZERO_TAX';
  overseasPurchased: 'NOT_OVERSEAS_PURCHASED' | 'OVERSEAS_PURCHASED';
  parallelImported: 'NOT_PARALLEL_IMPORTED' | 'PARALLEL_IMPORTED' | 'CONFIRMED_CARRIED_OUT';
  notices: { noticeCategoryName: string; content: string }[];
}

const DEFAULT_COUPANG_ITEM: CoupangItemDefaults = {
  deliveryCompanyCode: 'LOTTE',
  outboundShippingTimeDay: 3,
  adultOnly: 'EVERYONE',
  taxType: 'TAX',
  overseasPurchased: 'NOT_OVERSEAS_PURCHASED',
  parallelImported: 'NOT_PARALLEL_IMPORTED',
  notices: [],
};

function loadCoupangDefaults(): CoupangItemDefaults {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(COUPANG_ITEM_DEFAULTS_KEY) : null;
    if (raw) return { ...DEFAULT_COUPANG_ITEM, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_COUPANG_ITEM };
}

function saveCoupangDefaults(vals: CoupangItemDefaults) {
  try {
    localStorage.setItem(COUPANG_ITEM_DEFAULTS_KEY, JSON.stringify(vals));
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// 훅 옵션
// ─────────────────────────────────────────────────────────────────────────────
export interface UseRegisterFormOptions {
  onSuccess?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// 훅
// ─────────────────────────────────────────────────────────────────────────────
export function useRegisterForm(opts: UseRegisterFormOptions = {}) {
  const { onSuccess } = opts;

  const {
    sharedDraft,
    updateSharedDraft,
    bothRegistration,
    registerBothProducts,
    resetBothRegistration,
    fetchOptions,
  } = useListingStore();

  // ─── 플랫폼별 전용 상태 ─────────────────────────────────────────────────
  const [coupangCategoryCode, setCoupangCategoryCode] = useState(sharedDraft.coupangCategoryCode);
  const [coupangCategoryPath, setCoupangCategoryPath] = useState(sharedDraft.coupangCategoryPath);
  const [naverCategoryId, setNaverCategoryId] = useState(sharedDraft.naverCategoryId);
  const [naverCategoryPath, setNaverCategoryPath] = useState(sharedDraft.naverCategoryPath);

  const [brand, setBrand] = useState('');
  const [naverExchangeFee, setNaverExchangeFee] = useState('5000');

  const [coupangDefaults, setCoupangDefaults] = useState<CoupangItemDefaults>(DEFAULT_COUPANG_ITEM);
  const [coupangMounted, setCoupangMounted] = useState(false);

  // ─── 태그 입력 상태 ──────────────────────────────────────────────────────
  const [tagInput, setTagInput] = useState('');

  // ─── AI 최적화 상태 ──────────────────────────────────────────────────────
  const [isOptimizing, setIsOptimizing] = useState(false);

  // ─── 폼 검증 에러 ────────────────────────────────────────────────────────
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ─── 미리보기 상태 ───────────────────────────────────────────────────────
  const [previewData, setPreviewData] = useState<{ coupang: unknown; naver: unknown } | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // ─── useEffect: coupangDefaults 로컬스토리지 로드/저장 ─────────────────
  useEffect(() => {
    setCoupangDefaults(loadCoupangDefaults());
    setCoupangMounted(true);
  }, []);

  useEffect(() => {
    if (!coupangMounted) return;
    saveCoupangDefaults(coupangDefaults);
  }, [coupangDefaults, coupangMounted]);

  // ─── useEffect: Step 2 카테고리 동기화 ──────────────────────────────────
  useEffect(() => {
    if (sharedDraft.coupangCategoryCode && !coupangCategoryCode) {
      setCoupangCategoryCode(sharedDraft.coupangCategoryCode);
      setCoupangCategoryPath(sharedDraft.coupangCategoryPath);
    }
    if (sharedDraft.naverCategoryId && !naverCategoryId) {
      setNaverCategoryId(sharedDraft.naverCategoryId);
      setNaverCategoryPath(sharedDraft.naverCategoryPath);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── useEffect: 등록 성공 시 onSuccess 호출 ─────────────────────────────
  useEffect(() => {
    if (!onSuccess) return;
    const { coupang, naver } = bothRegistration;
    const isSuccess =
      coupang.status === 'success' ||
      naver.status === 'success' ||
      naver.status === 'draft';
    if (isSuccess) {
      const timer = setTimeout(() => onSuccess(), 1500);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bothRegistration.coupang.status, bothRegistration.naver.status]);

  // ─── 헬퍼: sharedDraft 업데이트 단축형 ──────────────────────────────────
  const updateDraft = useCallback(
    (key: Parameters<typeof updateSharedDraft>[0]) => updateSharedDraft(key),
    [updateSharedDraft],
  );

  // ─── 이미지 URL 배열 (store 슬라이스 별칭) ───────────────────────────────
  const thumbnailImageUrls = sharedDraft.thumbnailImages;
  const detailImageUrls = sharedDraft.detailImages;

  // ─── computed: 플랫폼 ────────────────────────────────────────────────────
  const platform = sharedDraft.selectedPlatform ?? 'both';
  const needCoupang = platform !== 'naver';
  const needNaver = platform !== 'coupang';

  // ─── computed: 등록 완료/진행 여부 ──────────────────────────────────────
  const isDone =
    bothRegistration.coupang.status === 'success' ||
    bothRegistration.coupang.status === 'error' ||
    bothRegistration.naver.status === 'success' ||
    bothRegistration.naver.status === 'error' ||
    bothRegistration.naver.status === 'draft';

  const isRegistering =
    bothRegistration.coupang.status === 'loading' ||
    bothRegistration.naver.status === 'loading';

  // ─── 태그 추가/제거 ──────────────────────────────────────────────────────
  const addTag = useCallback((input: string) => {
    const newTags = input
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && !sharedDraft.tags.includes(t));
    if (newTags.length > 0) {
      updateDraft({ tags: [...sharedDraft.tags, ...newTags] });
    }
    setTagInput('');
  }, [sharedDraft.tags, updateDraft]);

  const removeTag = useCallback((tag: string) => {
    updateDraft({ tags: sharedDraft.tags.filter((t) => t !== tag) });
  }, [sharedDraft.tags, updateDraft]);

  // ─── 검증 ────────────────────────────────────────────────────────────────
  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!sharedDraft.name.trim()) newErrors.name = '상품명을 입력해 주세요.';
    const hasCoupangPrice = sharedDraft.coupangPrice && Number(sharedDraft.coupangPrice) > 0;
    const hasNaverPrice = sharedDraft.naverPrice && Number(sharedDraft.naverPrice) > 0;
    const hasCommonPrice = sharedDraft.salePrice && Number(sharedDraft.salePrice) > 0;
    if (!hasCommonPrice && !hasCoupangPrice && !hasNaverPrice)
      newErrors.salePrice = '공통 판매가 또는 채널별 판매가를 1개 이상 입력해 주세요.';
    if (thumbnailImageUrls.length === 0) newErrors.images = '썸네일 이미지 URL을 1개 이상 입력해 주세요.';
    if (needCoupang && !coupangCategoryCode) newErrors.coupangCategory = '쿠팡 카테고리를 선택해 주세요.';
    if (needNaver && !naverCategoryId) newErrors.naverCategory = '네이버 카테고리를 선택해 주세요.';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [
    sharedDraft.name,
    sharedDraft.coupangPrice,
    sharedDraft.naverPrice,
    sharedDraft.salePrice,
    thumbnailImageUrls.length,
    needCoupang,
    needNaver,
    coupangCategoryCode,
    naverCategoryId,
  ]);

  // ─── 공통 payload 생성 ────────────────────────────────────────────────────
  const buildPayloadData = useCallback(() => ({
    platform,
    name: sharedDraft.name.trim(),
    salePrice: Number(sharedDraft.salePrice) || 100,
    naverPrice: sharedDraft.naverPrice ? Number(sharedDraft.naverPrice) : undefined,
    coupangPrice: sharedDraft.coupangPrice ? Number(sharedDraft.coupangPrice) : undefined,
    originalPrice: sharedDraft.originalPrice ? Number(sharedDraft.originalPrice) : undefined,
    stock: sharedDraft.stock ? Number(sharedDraft.stock) : undefined,
    thumbnailImages: thumbnailImageUrls,
    detailImages: detailImageUrls.length > 0 ? detailImageUrls : undefined,
    description: sharedDraft.description,
    deliveryCharge: Number(sharedDraft.deliveryCharge),
    deliveryChargeType: sharedDraft.deliveryChargeType,
    returnCharge: Number(sharedDraft.returnCharge),
    ...(needCoupang && coupangCategoryCode ? {
      coupang: {
        displayCategoryCode: Number(coupangCategoryCode),
        brand: brand.trim() || undefined,
        deliveryCompanyCode: coupangDefaults.deliveryCompanyCode,
        outboundShippingTimeDay: coupangDefaults.outboundShippingTimeDay,
        adultOnly: coupangDefaults.adultOnly,
        taxType: coupangDefaults.taxType,
        overseasPurchased: coupangDefaults.overseasPurchased,
        parallelImported: coupangDefaults.parallelImported,
        notices: (() => {
          const filled = coupangDefaults.notices.filter(
            (n) => n.noticeCategoryName.trim() !== '' && n.content.trim() !== ''
          );
          return filled.length > 0 ? filled : undefined;
        })(),
      },
    } : {}),
    ...(needNaver && naverCategoryId ? {
      naver: {
        leafCategoryId: naverCategoryId,
        tags: sharedDraft.tags.length > 0 ? sharedDraft.tags : undefined,
        exchangeFee: naverExchangeFee ? Number(naverExchangeFee) : undefined,
      },
    } : {}),
    options: sharedDraft.options?.hasOptions ? sharedDraft.options : undefined,
  }), [
    platform,
    sharedDraft,
    thumbnailImageUrls,
    detailImageUrls,
    needCoupang,
    needNaver,
    coupangCategoryCode,
    naverCategoryId,
    brand,
    coupangDefaults,
    naverExchangeFee,
  ]);

  // ─── AI 최적화 ───────────────────────────────────────────────────────────
  const handleOptimize = useCallback(async () => {
    const name = sharedDraft.name.trim();
    if (!name || isOptimizing) return;

    setIsOptimizing(true);
    try {
      const body: Record<string, string> = { originalTitle: name };
      if (sharedDraft.description.trim()) body.detailHtml = sharedDraft.description;

      const res = await fetch('/api/ai/optimize-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success && json.data) {
        updateSharedDraft({
          name: json.data.optimizedTitle,
          tags: json.data.tags,
        });
      }
    } catch {
      // 실패해도 기존 값 유지
    } finally {
      setIsOptimizing(false);
    }
  }, [sharedDraft.name, sharedDraft.description, isOptimizing, updateSharedDraft]);

  // ─── 미리보기 ────────────────────────────────────────────────────────────
  const handlePreview = useCallback(async () => {
    if (!validate()) return;
    setIsPreviewing(true);
    setPreviewData(null);
    try {
      const res = await fetch('/api/listing/both', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...buildPayloadData(), preview: true }),
      });
      const json = await res.json();
      if (json.success && json.preview) {
        setPreviewData(json.data);
      } else {
        window.alert('등록 정보 확인 실패: ' + (json.error ?? '알 수 없는 오류'));
      }
    } catch {
      window.alert('등록 정보 확인 요청 실패');
    } finally {
      setIsPreviewing(false);
    }
  }, [validate, buildPayloadData]);

  // ─── 등록 실행 ───────────────────────────────────────────────────────────
  // e: React.FormEvent 파라미터는 훅에서 제거 → 컴포넌트의 form.onSubmit에서 e.preventDefault() 처리
  const handleSubmit = useCallback(async () => {
    resetBothRegistration();
    setPreviewData(null);

    if (!validate()) return;

    await registerBothProducts(buildPayloadData());
    // 성공 후 onSuccess 호출은 useEffect에서 처리
  }, [resetBothRegistration, validate, registerBothProducts, buildPayloadData]);

  // ─── recalcChannelPrices: no-op (prefill 폐기) ───────────────────────────
  const recalcChannelPrices = useCallback(() => {}, []);

  return {
    // store 슬라이스
    sharedDraft,
    updateDraft,
    updateSharedDraft,
    bothRegistration,
    resetBothRegistration,
    fetchOptions,

    // 카테고리
    coupangCategoryCode, setCoupangCategoryCode,
    coupangCategoryPath, setCoupangCategoryPath,
    naverCategoryId, setNaverCategoryId,
    naverCategoryPath, setNaverCategoryPath,

    // 플랫폼별 추가
    brand, setBrand,
    naverExchangeFee, setNaverExchangeFee,
    coupangDefaults, setCoupangDefaults,
    coupangMounted,

    // 태그
    tagInput, setTagInput,
    addTag, removeTag,

    // AI
    isOptimizing,
    handleOptimize,

    // computed
    platform, needCoupang, needNaver,
    isDone, isRegistering,
    thumbnailImageUrls, detailImageUrls,

    // no-op
    recalcChannelPrices,

    // 폼 동작
    errors, setErrors,
    validate,
    buildPayloadData,
    handlePreview,
    handleSubmit,

    // 미리보기/결과
    previewData,
    setPreviewData,
    isPreviewing,
  };
}
