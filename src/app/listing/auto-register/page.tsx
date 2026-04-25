'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { UrlInputStep } from '@/components/listing/auto-register/UrlInputStep';
import { calcCoupangWing } from '@/lib/calculator/calculate';
import { getCoupangFeeFromPath } from '@/lib/calculator/fees';
import { calcRecommendedSalePrice } from '@/lib/sourcing/shared/channel-policy';
import { calcCostcoPrice } from '@/lib/sourcing/costco-pricing';
import type {
  NormalizedProduct,
  NormalizedProductOptionValue,
  MappedCoupangFields,
  FieldCorrection,
  AutoModeStatus,
} from '@/lib/auto-register/types';

// ─── 옵션(variant) 타입 ────────────────────────────────────────
type OptionType = { id: string; name: string; values: { id: string; value: string }[] };
type OptionVariant = {
  key: string;
  combination: string; // 예: "빨간색/S"
  attributes: { attributeTypeName: string; attributeValueName: string }[];
  salePrice: number;
  originalPrice: number;
  stock: number;
};

// ─── 카테시안 곱 헬퍼 ─────────────────────────────────────────
function cartesian<T>(arrays: T[][]): T[][] {
  return arrays.reduce<T[][]>(
    (acc, arr) => acc.flatMap((a) => arr.map((b) => [...a, b])),
    [[]],
  );
}

function buildVariants(
  types: OptionType[],
  defaultSale: number,
  defaultOriginal: number,
  defaultStock: number,
): OptionVariant[] {
  const filled = types.filter((t) => t.values.length > 0);
  if (filled.length === 0) return [];
  const combos = cartesian(filled.map((t) => t.values.map((v) => ({ type: t.name, value: v.value }))));
  return combos.map((combo) => ({
    key: combo.map((c) => c.value).join('/'),
    combination: combo.map((c) => c.value).join('/'),
    attributes: combo.map((c) => ({ attributeTypeName: c.type, attributeValueName: c.value })),
    salePrice: defaultSale,
    originalPrice: defaultOriginal,
    stock: defaultStock,
  }));
}

const INPUT = 'px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-full';
const SECTION = 'flex flex-col gap-4 bg-white border border-gray-200 rounded-xl p-5';

export default function AutoRegisterPage() {
  const [urlDone, setUrlDone] = useState(false);
  const [product, setProduct] = useState<NormalizedProduct | null>(null);
  const [mappedFields, setMappedFields] = useState<MappedCoupangFields | null>(null);
  const [autoModeStatus, setAutoModeStatus] = useState<AutoModeStatus | null>(null);

  // 기본 정보
  const [name, setName] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [brand, setBrand] = useState('');

  // 상품 주요 정보
  const [manufacturer, setManufacturer] = useState('');
  const [adultOnly, setAdultOnly] = useState<'EVERYONE' | 'ADULTS_ONLY'>('EVERYONE');
  const [taxType, setTaxType] = useState<'TAX' | 'TAX_FREE'>('TAX');
  const [parallelImported, setParallelImported] = useState<'NOT_PARALLEL_IMPORTED' | 'PARALLEL_IMPORTED'>('NOT_PARALLEL_IMPORTED');
  const [usedProduct, setUsedProduct] = useState<'NEW' | 'USED'>('NEW');
  const [certification, setCertification] = useState<string | undefined>(undefined);

  // 카테고리 검색 + 유효성
  const [categorySearch, setCategorySearch] = useState('');
  const [categoryResults, setCategoryResults] = useState<{ displayCategoryCode: number; displayCategoryName: string; fullPath: string }[]>([]);
  const [isCategorySearching, setIsCategorySearching] = useState(false);
  const [categoryCodeValid, setCategoryCodeValid] = useState<boolean | null>(null);
  const [isCategoryValidating, setIsCategoryValidating] = useState(false);
  const [categoryFullPath, setCategoryFullPath] = useState(''); // 선택된 카테고리 전체 경로
  const [customFeeRate, setCustomFeeRate] = useState<string>(''); // 사용자 직접 입력 수수료율 (%)

  // 가격 · 재고
  const [salePrice, setSalePrice] = useState(0);
  const [originalPrice, setOriginalPrice] = useState(0);
  const [stock, setStock] = useState(100);

  // 상품 옵션(variant)
  const [optionTypes, setOptionTypes] = useState<OptionType[]>([]);
  const [variants, setVariants] = useState<OptionVariant[]>([]);
  const [newOptionName, setNewOptionName] = useState('');
  // optionType.id → 현재 입력 중인 새 값
  const [newOptionValues, setNewOptionValues] = useState<Record<string, string>>({});
  // 일괄 설정 입력값
  const [bulkSalePrice, setBulkSalePrice] = useState('');
  const [bulkOriginalPrice, setBulkOriginalPrice] = useState('');
  const [bulkStock, setBulkStock] = useState('');
  // 옵션 종류 추가 input 표시 여부
  const [showOptionInput, setShowOptionInput] = useState(false);

  // 이미지 — 최대 2개, URL 또는 data:// 모두 허용
  const [editImages, setEditImages] = useState<string[]>([]);
  const [editInstruction, setEditInstruction] = useState('');
  const [isEditingImg, setIsEditingImg] = useState(false);
  const [imgEditError, setImgEditError] = useState('');
  // AI 프롬프트 제안
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[]>([]);
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);

  // 파일 업로드 hidden input ref (슬롯 인덱스를 ref로 추적) — 썸네일용
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadSlotRef = useRef<number>(0);

  // 상세페이지 이미지
  const [detailImages, setDetailImages] = useState<string[]>([]);
  const [detailEditInstruction, setDetailEditInstruction] = useState('');
  const [isEditingDetailImg, setIsEditingDetailImg] = useState(false);
  const [detailEditingSlot, setDetailEditingSlot] = useState<number | null>(null);
  const [detailImgEditError, setDetailImgEditError] = useState('');
  const [isEditingDetailHtml, setIsEditingDetailHtml] = useState(false);
  const [detailHtmlEditError, setDetailHtmlEditError] = useState('');
  const [isGeneratingHtmlFromImages, setIsGeneratingHtmlFromImages] = useState(false);
  const [detailSuggestedPrompts, setDetailSuggestedPrompts] = useState<string[]>([]);
  const [isGeneratingDetailPrompts, setIsGeneratingDetailPrompts] = useState(false);
  const detailFileInputRef = useRef<HTMLInputElement>(null);
  const detailUploadSlotRef = useRef<number>(0);

  // thumbnail은 editImages[0]의 computed 값 (기존 참조 호환)
  const thumbnail = editImages[0] ?? '';

  // 상세페이지
  const [detailHtml, setDetailHtml] = useState('');
  const [isPreview, setIsPreview] = useState(true);
  const safeHtml = useMemo(() => {
    if (typeof window === 'undefined') return detailHtml;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const purify = require('dompurify') as { sanitize?: (html: string) => string; default?: { sanitize: (html: string) => string } };
    const sanitize = purify.sanitize ?? purify.default?.sanitize;
    return sanitize ? sanitize(detailHtml) : detailHtml;
  }, [detailHtml]);

  // 배송
  const [deliveryMethod, setDeliveryMethod] = useState<'SEQUENCIAL' | 'VENDOR_DIRECT'>('SEQUENCIAL');
  const [deliveryChargeType, setDeliveryChargeType] = useState<'FREE' | 'NOT_FREE'>('FREE');
  const [deliveryCharge, setDeliveryCharge] = useState(0);
  const [outboundCode, setOutboundCode] = useState('');
  const [returnCode, setReturnCode] = useState('');

  // 고시정보
  const [notices, setNotices] = useState<{ categoryName: string; detailName: string; content: string }[]>([]);
  const [isNoticeFetching, setIsNoticeFetching] = useState(false);

  // 검색 태그
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  // 등록 (기존 — UI에서는 사용하지 않지만 타입 오류 방지를 위해 유지)
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerError, setRegisterError] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState(false);

  // 상품명 AI 추천
  const [isOptimizingName, setIsOptimizingName] = useState(false);

  // 임시저장 / 제출
  const [draftId, setDraftId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<{
    id: string;
    productName: string;
    sourceUrl?: string | null;
    status: string;
    draftData: Record<string, unknown>;
    updatedAt: string;
  }[]>([]);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [draftSaveFeedback, setDraftSaveFeedback] = useState<'saved' | 'error' | null>(null);
  const [draftSaveError, setDraftSaveError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ sellerProductId: number; wingsUrl: string } | null>(null);

  // 최근 등록 이력
  const [recentRegistrations, setRecentRegistrations] = useState<{
    sellerProductId: number;
    sellerProductName: string;
    wingsStatus: string;
    createdAt: string;
  }[]>([]);

  // 최근 등록 이력 로드 + 임시저장 목록 로드
  useEffect(() => {
    fetch('/api/listing/coupang/registered')
      .then((r) => r.json())
      .then((d: { items?: typeof recentRegistrations }) => setRecentRegistrations(d.items ?? []))
      .catch(() => {});

    fetch('/api/listing/coupang/drafts')
      .then((r) => r.json())
      .then((d: { drafts?: typeof drafts }) => setDrafts(d.drafts ?? []))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 배송 기본값 로드
  useEffect(() => {
    fetch('/api/auto-register/delivery-defaults')
      .then((r) => r.json())
      .then((d: { outboundShippingPlaceCode: string; returnCenterCode: string }) => {
        setOutboundCode((prev) => prev || d.outboundShippingPlaceCode);
        setReturnCode((prev) => prev || d.returnCenterCode);
      })
      .catch(() => {});
  }, []);

  // 학습 현황 로드
  useEffect(() => {
    if (!product?.source) return;
    fetch(`/api/auto-register/learning-status?sourceType=${product.source}`)
      .then((r) => r.json())
      .then((d: { status: AutoModeStatus }) => setAutoModeStatus(d.status))
      .catch(() => {});
  }, [product?.source]);

  // 상품명 AI 추천
  async function handleOptimizeName() {
    if (!name) return;
    setIsOptimizingName(true);
    try {
      const res = await fetch('/api/ai/optimize-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalTitle: name, categoryName: product?.categoryHint, detailHtml }),
      });
      const data = (await res.json()) as { success: boolean; data?: { optimizedTitle: string; tags: string[] } };
      if (data.success && data.data) {
        setName(data.data.optimizedTitle);
        setTags(data.data.tags);
      }
    } catch {
      // 실패 시 무시
    } finally {
      setIsOptimizingName(false);
    }
  }

  // 등록 이력 삭제 핸들러
  async function handleDeleteRegistration(sellerProductId: number) {
    if (!confirm('쿠팡에서 이 상품을 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(`/api/listing/coupang/${sellerProductId}`, { method: 'DELETE' });
      if (res.ok) {
        setRecentRegistrations((prev) => prev.filter((r) => r.sellerProductId !== sellerProductId));
      }
    } catch {
      // 네트워크 오류 무시
    }
  }

  // ── 임시저장 ──────────────────────────────────────────────────

  async function handleSaveDraft() {
    setIsSavingDraft(true);
    const draftData = {
      name,
      categoryCode,
      brand,
      salePrice,
      originalPrice,
      stock,
      thumbnail,
      detailHtml,
      deliveryMethod,
      deliveryChargeType,
      deliveryCharge,
      returnCharge: 0,
      outboundCode,
      returnCode,
      notices,
      tags,
      detailImages,
      manufacturer,
      adultOnly,
      taxType,
      parallelImported,
      usedProduct,
      // 옵션이 있으면 저장 (optionTypes + variants 모두 저장해야 불러오기 시 완전 복원 가능)
      ...(optionTypes.length > 0
        ? {
            optionTypes: optionTypes.map((t) => ({
              name: t.name,
              values: t.values.map((v) => v.value),
            })),
          }
        : {}),
      ...(variants.length > 0
        ? {
            variants: variants.map((v) => ({
              itemName: v.combination,
              attributes: v.attributes,
              salePrice: v.salePrice,
              originalPrice: v.originalPrice,
              stock: v.stock,
            })),
          }
        : {}),
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
            sourceUrl: undefined,
            sourceType: product?.source,
            draftData,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { id: string };
        setDraftId(data.id);
      }
      // 목록 새로고침
      const listRes = await fetch('/api/listing/coupang/drafts');
      const listData = (await listRes.json()) as { drafts: typeof drafts };
      setDrafts(listData.drafts ?? []);
      setDraftSaveFeedback('saved');
      setTimeout(() => setDraftSaveFeedback(null), 2000);
    } catch (err) {
      setDraftSaveError(err instanceof Error ? err.message : '저장 실패');
      setDraftSaveFeedback('error');
      setTimeout(() => setDraftSaveFeedback(null), 3000);
    } finally {
      setIsSavingDraft(false);
    }
  }

  // ── 임시저장 불러오기 ────────────────────────────────────────

  function handleLoadDraft(draft: typeof drafts[number]) {
    const d = draft.draftData as {
      name?: string;
      categoryCode?: string;
      brand?: string;
      salePrice?: number;
      originalPrice?: number;
      stock?: number;
      thumbnail?: string;
      detailHtml?: string;
      detailImages?: string[];
      deliveryChargeType?: 'FREE' | 'NOT_FREE';
      deliveryCharge?: number;
      outboundCode?: string;
      returnCode?: string;
      notices?: { categoryName: string; detailName: string; content: string }[];
      tags?: string[];
      manufacturer?: string;
      adultOnly?: 'EVERYONE' | 'ADULTS_ONLY';
      taxType?: 'TAX' | 'TAX_FREE';
      parallelImported?: 'NOT_PARALLEL_IMPORTED' | 'PARALLEL_IMPORTED';
      usedProduct?: 'NEW' | 'USED';
      optionTypes?: { name: string; values: string[] }[];
      variants?: { itemName: string; attributes: { attributeTypeName: string; attributeValueName: string }[]; salePrice: number; originalPrice: number; stock: number }[];
    };
    setDraftId(draft.id);
    setName(d.name ?? '');
    setCategoryCode(d.categoryCode ?? '');
    setBrand(d.brand ?? '');
    setSalePrice(Number(d.salePrice) || 0);
    setOriginalPrice(Number(d.originalPrice) || 0);
    setStock(Number(d.stock) || 100);
    setEditImages(d.thumbnail ? [d.thumbnail] : []);
    setDetailHtml(d.detailHtml ?? '');
    setDetailImages(Array.isArray(d.detailImages) ? d.detailImages : []);
    setDeliveryChargeType(d.deliveryChargeType ?? 'FREE');
    setDeliveryCharge(Number(d.deliveryCharge) || 0);
    setOutboundCode(d.outboundCode ?? '');
    setReturnCode(d.returnCode ?? '');
    setNotices(d.notices ?? []);
    setTags(d.tags ?? []);
    if (d.manufacturer !== undefined) setManufacturer(d.manufacturer);
    if (d.adultOnly) setAdultOnly(d.adultOnly);
    if (d.taxType) setTaxType(d.taxType);
    if (d.parallelImported) setParallelImported(d.parallelImported);
    if (d.usedProduct) setUsedProduct(d.usedProduct);
    // 옵션 복원
    if (d.optionTypes && d.optionTypes.length > 0) {
      setOptionTypes(d.optionTypes.map((t) => ({
        id: crypto.randomUUID(),
        name: t.name,
        values: t.values.map((v) => ({ id: crypto.randomUUID(), value: v })),
      })));
    } else {
      setOptionTypes([]);
    }
    if (d.variants && d.variants.length > 0) {
      setVariants(d.variants.map((v) => ({
        key: v.itemName,
        combination: v.itemName,
        attributes: v.attributes,
        salePrice: Number(v.salePrice) || 0,
        originalPrice: Number(v.originalPrice) || 0,
        stock: Number(v.stock) || 100,
      })));
    } else {
      setVariants([]);
    }
    setUrlDone(true);
  }

  // ── 쿠팡에 제출 ─────────────────────────────────────────────

  async function handleSubmit() {
    if (!draftId) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/listing/coupang/drafts/${draftId}/submit`, { method: 'POST' });
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
        setDrafts((prev) => prev.filter((d) => d.id !== draftId));
      } else {
        setRegisterError(data.error ?? '제출 실패');
      }
    } catch {
      setRegisterError('네트워크 오류');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleUrlComplete(p: NormalizedProduct, f: MappedCoupangFields | null) {
    setProduct(p);
    setMappedFields(f);
    setName(f?.sellerProductName.value ?? p.title ?? '');
    setCategoryCode(f?.displayCategoryCode.value ? String(f.displayCategoryCode.value) : '');
    // AI가 '' 또는 '기타'를 반환하면 NormalizedProduct의 brand(판매자명)로 폴백
    const aiBrand = f?.brand.value;
    setBrand((aiBrand && aiBrand !== '기타') ? aiBrand : (p.brand || '기타'));
    // 제조사: NormalizedProduct에서 추출된 값 우선
    if (p.manufacturer) setManufacturer(p.manufacturer);
    setCertification(p.certification);

    // 추천 판매가 계산 — AI 가격은 사용하지 않고 소싱 마진 로직으로만 산출
    const sourcePrice = Number(p.price) || 0; // 명시적 숫자 변환 (NaN/string 방어)
    let finalSalePrice: number;
    if (p.source === 'costco') {
      const r = calcCostcoPrice({ buyPrice: sourcePrice, packQty: 1, categoryName: p.categoryHint ?? null, channel: 'coupang', weightKg: null });
      finalSalePrice = r.recommendedPrice;
    } else {
      // 도매꾹: 도매가 + 실제 배송비 (API 값 우선, 없으면 2,500원 기본값)
      const deliveryFee = (p.deliFee != null && p.deliFee > 0) ? p.deliFee : 2500;
      const costTotal = sourcePrice + deliveryFee;
      const targetProfit = Math.max(Math.floor(costTotal * 0.10), 2000);
      const raw = calcRecommendedSalePrice(costTotal, targetProfit, 'coupang');
      finalSalePrice = Math.ceil(raw / 500) * 500;
    }
    // 계산 실패 시 최소 안전값 (원가의 1.5배)
    if (!Number.isFinite(finalSalePrice) || finalSalePrice <= 0) {
      finalSalePrice = Math.ceil(sourcePrice * 1.5 / 500) * 500 || 10000;
    }
    setSalePrice(finalSalePrice);
    // 정가: 판매가 × 1.25, 1000원 단위 올림 (고객이 할인받는 느낌)
    setOriginalPrice(Math.ceil(finalSalePrice * 1.25 / 1000) * 1000);

    // 이미지: 최대 2장까지 슬롯에 채움
    setEditImages(p.imageUrls.slice(0, 2));

    // 기본 프롬프트 초안 설정 후 AI 제안 비동기 요청
    setEditInstruction('배경을 깔끔한 흰색으로 교체하고 상품을 화면 중앙에 크게 배치해주세요. 밝고 선명한 쿠팡 썸네일 스타일로 편집해주세요.');
    setSuggestedPrompts([]);
    setIsGeneratingPrompts(true);
    fetch('/api/ai/suggest-thumbnail-prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: p.title,
        categoryHint: p.categoryHint,
        description: p.description?.slice(0, 800),
        options: p.options,
      }),
    })
      .then((r) => r.json())
      .then((d: { success: boolean; data?: { prompts: string[] } }) => {
        if (d.success && d.data?.prompts?.length) {
          setSuggestedPrompts(d.data.prompts);
          setEditInstruction(d.data.prompts[0]);
        }
      })
      .catch(() => {})
      .finally(() => setIsGeneratingPrompts(false));

    setDetailHtml(p.detailHtml ?? p.description ?? '');
    setDeliveryChargeType((f?.deliveryChargeType.value ?? 'FREE') as 'FREE' | 'NOT_FREE');
    setDeliveryCharge(f?.deliveryCharge.value ?? 0);
    // 네이버 연관검색어 태그 우선, 없으면 AI 제안
    setTags(p.suggestedTags?.length ? p.suggestedTags : (f?.searchTags.value ?? []));

    // 도매꾹 selectOpt 기반 옵션 자동 생성
    if (p.options && p.options.length > 0) {
      const newTypes: OptionType[] = p.options.map((opt) => ({
        id: crypto.randomUUID(),
        name: opt.typeName,
        values: opt.values.map((v) => ({ id: crypto.randomUUID(), value: v.label })),
      }));
      setOptionTypes(newTypes);

      const baseDeliveryFee = (p.deliFee != null && p.deliFee > 0) ? p.deliFee : 2500;
      const baseSourcePrice = Number(p.price) || 0;
      const filled = p.options.filter((o) => o.values.length > 0);
      const combos = cartesian<NormalizedProductOptionValue>(filled.map((opt) => opt.values));

      const autoVariants: OptionVariant[] = combos.map((combo) => {
        const totalAdj = combo.reduce((sum, v) => sum + (v.priceAdjustment ?? 0), 0);
        const adjCostTotal = baseSourcePrice + totalAdj + baseDeliveryFee;
        const targetProfit = Math.max(Math.floor(adjCostTotal * 0.10), 2000);
        const raw = calcRecommendedSalePrice(adjCostTotal, targetProfit, 'coupang');
        const variantSalePrice = Math.ceil(raw / 500) * 500 || finalSalePrice;
        const minStock = combo.reduce((min, v) => Math.min(min, v.stock ?? 99999), Infinity);
        const effectiveStock = Number.isFinite(minStock) && minStock < 99990 ? minStock : 100;

        return {
          key: combo.map((v) => v.label).join('/'),
          combination: combo.map((v) => v.label).join('/'),
          attributes: combo.map((v, i) => ({
            attributeTypeName: filled[i].typeName,
            attributeValueName: v.label,
          })),
          salePrice: variantSalePrice,
          originalPrice: Math.ceil(variantSalePrice * 1.25 / 1000) * 1000,
          stock: effectiveStock,
        };
      });
      setVariants(autoVariants);
    }

    setUrlDone(true);
  }

  // 판매가가 정가 이상이면 정가 자동 보정
  useEffect(() => {
    if (salePrice > 0 && originalPrice > 0 && originalPrice <= salePrice) {
      setOriginalPrice(Math.ceil(salePrice * 1.25 / 1000) * 1000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salePrice]);

  // 카테고리 코드 변경 시 유효성 검증 (800ms debounce)
  useEffect(() => {
    const code = categoryCode.trim();
    if (!code) { setCategoryCodeValid(null); return; }
    setCategoryCodeValid(null);
    setIsCategoryValidating(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auto-register/validate-category?categoryCode=${encodeURIComponent(code)}`);
        const data = (await res.json()) as { valid: boolean; fullPath?: string };
        setCategoryCodeValid(data.valid);
        if (data.valid && data.fullPath) {
          setCategoryFullPath(data.fullPath);
        }
      } catch {
        setCategoryCodeValid(null);
      } finally {
        setIsCategoryValidating(false);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [categoryCode]);

  // 카테고리 코드 변경 시 고시정보 자동 생성
  const certificationRef = useRef<string | undefined>(undefined);
  useEffect(() => { certificationRef.current = certification; }, [certification]);

  useEffect(() => {
    const code = categoryCode.trim();
    if (!code || !name) return;
    const timer = setTimeout(async () => {
      setIsNoticeFetching(true);
      try {
        const certParam = certificationRef.current
          ? `&certification=${encodeURIComponent(certificationRef.current)}`
          : '';
        const url = `/api/auto-register/category-notices?categoryCode=${encodeURIComponent(code)}&productName=${encodeURIComponent(name)}${certParam}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = (await res.json()) as { notices: { categoryName: string; detailName: string; content: string }[] };
          if (data.notices?.length > 0) setNotices(data.notices);
        }
      } catch {
        // 실패 시 기존 notices 유지
      } finally {
        setIsNoticeFetching(false);
      }
    }, 800);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryCode]);

  // 카테고리 키워드 검색
  async function doCategorySearch(kw: string) {
    if (!kw) return;
    setIsCategorySearching(true);
    try {
      const res = await fetch(`/api/auto-register/search-category?keyword=${encodeURIComponent(kw)}`);
      const data = (await res.json()) as { categories: typeof categoryResults };
      setCategoryResults(data.categories ?? []);
    } catch {
      setCategoryResults([]);
    } finally {
      setIsCategorySearching(false);
    }
  }

  function handleCategorySearch() {
    doCategorySearch(categorySearch.trim() || name);
  }

  // AI 썸네일 편집 — mode: 'edit'(슬롯1만), 'combine'(두 이미지 합치기)
  async function handleAiEdit(mode: 'edit' | 'combine' = 'edit') {
    if (!editInstruction.trim() || !editImages[0]) return;
    setIsEditingImg(true);
    setImgEditError('');
    try {
      const body: Record<string, string> = {
        imageUrl: editImages[0],
        prompt: editInstruction,
      };
      if (mode === 'combine' && editImages[1]) {
        body.imageUrl2 = editImages[1];
      }
      const res = await fetch('/api/ai/edit-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { success: boolean; data?: { editedUrl: string }; error?: string };
      if (data.success && data.data?.editedUrl) {
        if (mode === 'combine') {
          // 합치기 결과는 슬롯1만 남김
          setEditImages([data.data.editedUrl]);
        } else {
          // 슬롯1만 교체, 슬롯2는 유지
          setEditImages((prev) => [data.data!.editedUrl, ...prev.slice(1)]);
        }
      } else {
        setImgEditError(data.error ?? 'AI 편집 중 오류가 발생했습니다.');
      }
    } catch {
      setImgEditError('AI 편집 중 오류가 발생했습니다.');
    } finally {
      setIsEditingImg(false);
    }
  }

  // 파일 선택 후 FileReader로 data:// URL 변환 → 해당 슬롯에 set
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const slotIdx = uploadSlotRef.current;
      setEditImages((prev) => {
        const next = [...prev];
        next[slotIdx] = dataUrl;
        return next;
      });
    };
    reader.readAsDataURL(file);
    // 같은 파일을 다시 선택해도 onChange가 발생하도록 초기화
    e.target.value = '';
  }

  // 이미지 슬롯 클릭 → hidden file input 트리거
  function triggerFileUpload(slotIdx: number) {
    uploadSlotRef.current = slotIdx;
    fileInputRef.current?.click();
  }

  // 해당 슬롯 제거 후 나머지를 앞으로 당김
  function removeEditImage(slotIdx: number) {
    setEditImages((prev) => prev.filter((_, i) => i !== slotIdx));
  }

  // ── 상세페이지 이미지 관련 함수 ──────────────────────────────

  // 상세 이미지 전체 일괄 AI 편집
  async function handleDetailImgAiEditAll() {
    if (detailImages.length === 0 || !detailEditInstruction.trim()) return;
    setIsEditingDetailImg(true);
    setDetailImgEditError('');
    for (let idx = 0; idx < detailImages.length; idx++) {
      setDetailEditingSlot(idx);
      try {
        const res = await fetch('/api/ai/edit-thumbnail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: detailImages[idx], prompt: detailEditInstruction }),
        });
        const data = (await res.json()) as { success: boolean; data?: { editedUrl: string }; error?: string };
        if (data.success && data.data?.editedUrl) {
          setDetailImages((prev) => {
            const next = [...prev];
            next[idx] = data.data!.editedUrl;
            return next;
          });
        } else {
          setDetailImgEditError(`이미지 ${idx + 1} 편집 실패: ${data.error ?? '오류'}`);
        }
      } catch {
        setDetailImgEditError(`이미지 ${idx + 1} 편집 중 오류가 발생했습니다.`);
      }
    }
    setIsEditingDetailImg(false);
    setDetailEditingSlot(null);
  }

  async function handleGenerateDetailPrompts() {
    if (!product) return;
    setIsGeneratingDetailPrompts(true);
    setDetailSuggestedPrompts([]);
    // HTML이 있으면 HTML 편집 지시문, 없으면 이미지 편집 프롬프트
    const context = detailHtml ? 'detail-html' : 'detail';
    try {
      const res = await fetch('/api/ai/suggest-thumbnail-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: product.title,
          categoryHint: product.categoryHint,
          description: product.description?.slice(0, 800),
          options: product.options,
          context,
        }),
      });
      const data = (await res.json()) as { success: boolean; data?: { prompts: string[] } };
      if (data.success && data.data?.prompts?.length) {
        setDetailSuggestedPrompts(data.data.prompts);
        setDetailEditInstruction(data.data.prompts[0]);
      }
    } catch {
      // 실패 시 무시
    } finally {
      setIsGeneratingDetailPrompts(false);
    }
  }

  async function handleDetailHtmlEdit(instruction: string) {
    if (!detailHtml || !instruction.trim()) return;
    setIsEditingDetailHtml(true);
    setDetailHtmlEditError('');
    try {
      const res = await fetch('/api/ai/edit-detail-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentHtml: detailHtml,
          instruction: instruction.trim(),
          productName: name,
        }),
      });
      const data = (await res.json()) as { success: boolean; html?: string; error?: string };
      if (!res.ok || !data.success) {
        setDetailHtmlEditError(data.error ?? `HTML 편집 중 오류가 발생했습니다. (${res.status})`);
        return;
      }
      if (data.html) setDetailHtml(data.html);
    } catch (err) {
      console.error('[handleDetailHtmlEdit]', err);
      setDetailHtmlEditError('네트워크 오류 또는 서버 응답을 처리할 수 없습니다.');
    } finally {
      setIsEditingDetailHtml(false);
    }
  }

  async function handleDetailHtmlRegenerate() {
    await handleDetailHtmlEdit(
      '상품 정보를 바탕으로 상세페이지 HTML을 처음부터 완전히 재작성해줘. 상품의 핵심 특징을 강조하고, 구매를 유도하는 설득력 있는 문구를 포함해줘.',
    );
  }

  async function handleGenerateHtmlFromImages() {
    if (detailImages.length === 0) return;
    setIsGeneratingHtmlFromImages(true);
    setDetailHtmlEditError('');

    // data URL → images 배열, https URL → imageUrls 배열로 분리
    const images: { imageBase64: string; mimeType: string }[] = [];
    const imageUrls: string[] = [];

    for (const img of detailImages) {
      if (img.startsWith('data:')) {
        const commaIdx = img.indexOf(',');
        const meta = img.slice(5, commaIdx); // "image/jpeg;base64"
        const mimeType = meta.split(';')[0] ?? 'image/jpeg';
        const imageBase64 = img.slice(commaIdx + 1);
        images.push({ imageBase64, mimeType });
      } else {
        imageUrls.push(img);
      }
    }

    try {
      const res = await fetch('/api/ai/generate-detail-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(images.length > 0 ? { images } : {}),
          ...(imageUrls.length > 0 ? { imageUrls } : {}),
          productName: name,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { success: boolean; html?: string; error?: string };
      if (data.success && data.html) {
        setDetailHtml(data.html);
        setDetailSuggestedPrompts([]);
      } else {
        setDetailHtmlEditError(data.error ?? 'HTML 생성 중 오류가 발생했습니다.');
      }
    } catch {
      setDetailHtmlEditError('HTML 생성 중 오류가 발생했습니다.');
    } finally {
      setIsGeneratingHtmlFromImages(false);
    }
  }

  async function handleDetailImgAiEdit(slotIdx: number) {
    const imgUrl = detailImages[slotIdx];
    if (!imgUrl || !detailEditInstruction.trim()) return;
    setIsEditingDetailImg(true);
    setDetailEditingSlot(slotIdx);
    setDetailImgEditError('');
    try {
      const res = await fetch('/api/ai/edit-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: imgUrl, prompt: detailEditInstruction }),
      });
      const data = (await res.json()) as { success: boolean; data?: { editedUrl: string }; error?: string };
      if (data.success && data.data?.editedUrl) {
        setDetailImages((prev) => {
          const next = [...prev];
          next[slotIdx] = data.data!.editedUrl;
          return next;
        });
      } else {
        setDetailImgEditError(data.error ?? 'AI 편집 중 오류가 발생했습니다.');
      }
    } catch {
      setDetailImgEditError('AI 편집 중 오류가 발생했습니다.');
    } finally {
      setIsEditingDetailImg(false);
      setDetailEditingSlot(null);
    }
  }

  function handleDetailFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const slotIdx = detailUploadSlotRef.current;
      setDetailImages((prev) => {
        const next = [...prev];
        if (slotIdx >= next.length) {
          next.push(dataUrl);
        } else {
          next[slotIdx] = dataUrl;
        }
        return next;
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function triggerDetailFileUpload(slotIdx: number) {
    detailUploadSlotRef.current = slotIdx;
    detailFileInputRef.current?.click();
  }

  function removeDetailImage(slotIdx: number) {
    setDetailImages((prev) => prev.filter((_, i) => i !== slotIdx));
  }

  // ── 옵션 관련 함수 ───────────────────────────────────────────

  function addOptionType() {
    const trimmed = newOptionName.trim();
    if (!trimmed) return;
    const id = crypto.randomUUID();
    const newType: OptionType = { id, name: trimmed, values: [] };
    const nextTypes = [...optionTypes, newType];
    setOptionTypes(nextTypes);
    setNewOptionName('');
    setShowOptionInput(false);
    setVariants(buildVariants(nextTypes, salePrice, originalPrice, stock));
  }

  function removeOptionType(id: string) {
    const nextTypes = optionTypes.filter((t) => t.id !== id);
    setOptionTypes(nextTypes);
    setVariants(buildVariants(nextTypes, salePrice, originalPrice, stock));
  }

  function addOptionValue(typeId: string) {
    const val = newOptionValues[typeId]?.trim();
    if (!val) return;
    const nextTypes = optionTypes.map((t) =>
      t.id === typeId
        ? { ...t, values: [...t.values, { id: crypto.randomUUID(), value: val }] }
        : t,
    );
    setOptionTypes(nextTypes);
    setNewOptionValues((prev) => ({ ...prev, [typeId]: '' }));
    setVariants(buildVariants(nextTypes, salePrice, originalPrice, stock));
  }

  function removeOptionValue(typeId: string, valueId: string) {
    const nextTypes = optionTypes.map((t) =>
      t.id === typeId ? { ...t, values: t.values.filter((v) => v.id !== valueId) } : t,
    );
    setOptionTypes(nextTypes);
    setVariants(buildVariants(nextTypes, salePrice, originalPrice, stock));
  }

  function updateVariantField(key: string, field: 'salePrice' | 'originalPrice' | 'stock', value: number) {
    setVariants((prev) => prev.map((v) => (v.key === key ? { ...v, [field]: value } : v)));
  }

  function bulkSetVariants(field: 'salePrice' | 'originalPrice' | 'stock', value: number) {
    if (!Number.isFinite(value)) return;
    setVariants((prev) => prev.map((v) => ({ ...v, [field]: value })));
  }

  function addTag() {
    const t = tagInput.trim();
    if (t && !tags.includes(t) && tags.length < 10) {
      setTags([...tags, t]);
      setTagInput('');
    }
  }

  // 가격 계산 (costPrice: NaN 방어 + product 없을 때 0 처리)
  const safeDomePrice = Number.isFinite(product?.price) ? (product!.price as number) : 0;
  const safeDeliveryFee = product?.deliFee ?? 0;
  // 코스트코: deliFee가 없으므로 calcCostcoPrice의 totalCost(매입가+배송비+포장비) 사용
  const safeCostPrice = product?.source === 'costco'
    ? calcCostcoPrice({ buyPrice: safeDomePrice, packQty: 1, categoryName: product.categoryHint ?? null, channel: 'coupang', weightKg: null }).totalCost
    : safeDomePrice + safeDeliveryFee; // 도매가 + 도매 배송비
  // 수수료율 우선순위: 사용자 직접 입력 → 쿠팡 카테고리 fullPath → 소싱 카테고리 hint
  const { categoryName: coupangCategory, rate: estimatedRate } = getCoupangFeeFromPath(
    categoryFullPath || product?.categoryHint || ''
  );
  const customRate = customFeeRate ? parseFloat(customFeeRate) / 100 : null;
  const effectiveFeeRate = (customRate && customRate > 0 && customRate < 1) ? customRate : estimatedRate;
  const calc = calcCoupangWing({
    costPrice: safeCostPrice,
    sellingPrice: salePrice,
    category: coupangCategory,
    shippingFee: 0,
    adCost: 0,
  });
  // customRate가 있으면 items[0].rate를 덮어써서 정확한 수수료 반영
  const effectiveCommission = customRate && salePrice > 0
    ? Math.round(salePrice * effectiveFeeRate)
    : (calc.items[0]?.amount ?? 0);
  const effectiveNetProfit = salePrice - safeCostPrice - effectiveCommission;
  const effectiveMarginRate = salePrice > 0 ? (effectiveNetProfit / salePrice) * 100 : 0;

  // 최종 등록
  async function handleRegister() {
    if (!product) return;
    setIsRegistering(true);
    setRegisterError('');

    const corrections: FieldCorrection[] = [];
    const mf = mappedFields;
    if (mf) {
      const fieldMap: Record<string, string> = {
        sellerProductName: name,
        brand,
        salePrice: String(salePrice),
        stockQuantity: String(stock),
      };
      (Object.keys(fieldMap) as Array<keyof typeof fieldMap>).forEach((field) => {
        const mappedField = mf[field as keyof MappedCoupangFields];
        if (!mappedField) return;
        const aiVal = String(mappedField.value);
        const acceptedVal = fieldMap[field];
        corrections.push({
          sourceType: product.source,
          fieldName: field as keyof MappedCoupangFields,
          aiValue: aiVal,
          acceptedValue: acceptedVal,
          wasCorrected: aiVal !== acceptedVal,
        });
      });
    }

    const res = await fetch('/api/listing/coupang', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sellerProductName: name,
        salePrice,
        originalPrice,
        stock,
        thumbnailImages: [thumbnail].filter(Boolean),
        detailImages: [],
        description: detailHtml,
        deliveryCharge,
        deliveryChargeType,
        returnCharge: 0,
        displayCategoryCode: Number(categoryCode) || 0,
        brand,
        outboundShippingPlaceCode: outboundCode,
        returnCenterCode: returnCode,
        searchTags: tags,
        adultOnly,
        taxType,
        parallelImported,
        notices: notices.map((n) => ({
          noticeCategoryName: n.categoryName,
          noticeCategoryDetailName: n.detailName,
          content: n.content,
        })),
        // 옵션이 있으면 variants 포함 (없으면 필드 자체를 제거)
        ...(variants.length > 0
          ? {
              variants: variants.map((v) => ({
                itemName: v.combination,
                attributes: v.attributes,
                salePrice: v.salePrice,
                originalPrice: v.originalPrice,
                stock: v.stock,
              })),
            }
          : {}),
      }),
    });

    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      setRegisterError(errData.error ?? '등록 중 오류가 발생했습니다.');
      setIsRegistering(false);
      return;
    }

    if (corrections.length > 0) {
      await fetch('/api/auto-register/save-corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corrections }),
      }).catch(() => {});
    }

    setIsRegistering(false);
    setRegisterSuccess(true);
  }

  // 기존 registerSuccess는 더 이상 조건부 렌더링에 사용하지 않으나
  // 타입 오류 방지를 위해 변수 참조는 유지함 (컴파일러 트리 셰이킹)
  void isRegistering;
  void registerSuccess;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto py-8 px-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">쿠팡 자동등록</h1>
          <p className="text-sm text-gray-500 mt-1">도매꾹 · 코스트코 → 쿠팡윙스 직접 등록</p>
        </div>

        {autoModeStatus && (
          <div className="mb-4 bg-blue-50 rounded-lg px-4 py-2 text-sm text-blue-700">
            학습 현황: {autoModeStatus.fieldsTrusted}/{autoModeStatus.fieldsTotal} 필드 완료
            {autoModeStatus.isAvailable && ' · 자동 모드 사용 가능'}
          </div>
        )}

        {/* Step 0: URL 입력 */}
        {!urlDone && (
          <div className="flex flex-col gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <UrlInputStep onComplete={handleUrlComplete} />
            </div>

            {/* 임시저장 목록 */}
            {drafts.length > 0 && (
              <div className={SECTION}>
                <h3 className="font-semibold text-gray-900 text-sm">임시저장 목록</h3>
                <div className="flex flex-col gap-2">
                  {drafts.map((draft) => (
                    <div key={draft.id} className="flex items-center justify-between text-sm border border-gray-100 rounded-lg px-3 py-2">
                      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                        <span className="text-gray-900 truncate font-medium">{draft.productName || '(이름 없음)'}</span>
                        <span className="text-xs text-gray-400">
                          {new Date(draft.updatedAt).toLocaleDateString('ko-KR')} 저장
                        </span>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => handleLoadDraft(draft)}
                          className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                        >
                          이어서 작성
                        </button>
                        <button
                          onClick={async () => {
                            await fetch(`/api/listing/coupang/drafts/${draft.id}`, { method: 'DELETE' });
                            setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
                          }}
                          className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 최근 등록 상품 */}
            {recentRegistrations.length > 0 && (
              <div className={SECTION}>
                <h3 className="font-semibold text-gray-900 text-sm">최근 등록 상품</h3>
                <div className="flex flex-col gap-2">
                  {recentRegistrations.map((item) => (
                    <div key={item.sellerProductId} className="flex items-center justify-between text-sm">
                      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                        <span className="text-gray-900 truncate">{item.sellerProductName}</span>
                        <span className="text-xs text-gray-500">
                          {item.wingsStatus === 'UNDER_REVIEW' ? '검수 대기' :
                           item.wingsStatus === 'APPROVED' ? '승인' :
                           item.wingsStatus === 'REJECTED' ? '반려' : item.wingsStatus}
                          {' · '}
                          {new Date(item.createdAt).toLocaleDateString('ko-KR')}
                        </span>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <a
                          href="https://wing.coupang.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                        >
                          Wings
                        </a>
                        {item.wingsStatus === 'UNDER_REVIEW' && (
                          <button
                            onClick={() => handleDeleteRegistration(item.sellerProductId)}
                            className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100"
                          >
                            삭제
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 단일 스크롤 폼 */}
        {urlDone && (
          <div className="flex flex-col gap-5">

            {/* 섹션 1: 기본 정보 */}
            <div className={SECTION}>
              <h3 className="font-semibold text-gray-900">기본 정보</h3>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">
                  상품명
                  {mappedFields?.sellerProductName.confidence !== undefined && (
                    <span className="ml-2 text-xs text-gray-400">
                      AI 신뢰도 {Math.round((mappedFields.sellerProductName.confidence ?? 0) * 100)}%
                    </span>
                  )}
                </label>
                <div className="flex gap-2">
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={INPUT} />
                  <button
                    onClick={handleOptimizeName}
                    disabled={isOptimizingName || !name}
                    className="px-3 py-2 bg-purple-600 text-white rounded-lg text-sm whitespace-nowrap hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    {isOptimizingName ? '추천 중...' : 'AI 추천'}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-gray-700">
                  카테고리 코드 <span className="text-orange-500 font-normal">*직접 입력 필요</span>
                  {isCategoryValidating && <span className="ml-2 text-xs text-gray-400">확인 중...</span>}
                  {!isCategoryValidating && categoryCodeValid === true && <span className="ml-2 text-xs text-green-600">✓ 유효</span>}
                  {!isCategoryValidating && categoryCodeValid === false && <span className="ml-2 text-xs text-red-500">✗ 없는 코드</span>}
                </label>
                {/* AI 참고값 */}
                {!!mappedFields?.displayCategoryCode.value && (
                  <p className="text-xs text-gray-400">
                    AI 추천 참고값: {mappedFields.displayCategoryCode.value} (실제 유효 여부 불확실 — Wings 기존 상품에서 코드를 확인하세요)
                  </p>
                )}
                {/* 직접 입력 — 숫자 외 텍스트 입력 시 자동으로 검색 필드로 전환 */}
                <input
                  value={categoryCode}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v && /\D/.test(v)) {
                      // 숫자가 아닌 문자가 포함되면 검색 필드로 이동 후 자동 검색
                      setCategoryCode('');
                      setCategorySearch(v);
                      setCategoryResults([]);
                      setCategoryFullPath('');
                      doCategorySearch(v);
                    } else {
                      setCategoryCode(v);
                      setCategoryResults([]);
                      setCategoryFullPath('');
                    }
                  }}
                  placeholder="카테고리 코드 숫자 입력 (예: 78780)"
                  className={`${INPUT} ${categoryCodeValid === false ? 'border-red-400 focus:ring-red-400' : categoryCodeValid === true ? 'border-green-400' : ''}`}
                />
                {/* 카테고리 이름 검색 */}
                <div className="flex gap-2">
                  <input
                    value={categorySearch}
                    onChange={(e) => setCategorySearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCategorySearch()}
                    placeholder="카테고리 이름으로 검색 (예: 유리발수코팅제)"
                    className={INPUT}
                    autoFocus={categorySearch.length > 0}
                  />
                  <button
                    onClick={handleCategorySearch}
                    disabled={isCategorySearching}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm whitespace-nowrap hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    {isCategorySearching ? '검색 중...' : '검색'}
                  </button>
                </div>
                {/* 검색 결과 */}
                {categoryResults.length > 0 && (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    {categoryResults.map((c) => (
                      <button
                        key={c.displayCategoryCode}
                        onClick={() => { setCategoryCode(String(c.displayCategoryCode)); setCategoryFullPath(c.fullPath); setCategoryResults([]); setCategorySearch(''); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-0"
                      >
                        <span className="font-medium text-gray-900">{c.displayCategoryCode}</span>
                        <span className="mx-2 text-gray-400">·</span>
                        <span className="text-gray-600 text-xs">{c.fullPath}</span>
                      </button>
                    ))}
                  </div>
                )}
                {categoryResults.length === 0 && !isCategorySearching && categorySearch && (
                  <p className="text-xs text-gray-400">검색 결과가 없습니다. 다른 키워드로 시도해보세요.</p>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">브랜드</label>
                <input value={brand} onChange={(e) => setBrand(e.target.value)} className={INPUT} />
              </div>
            </div>

            {/* 섹션 1.5: 상품 주요 정보 */}
            <div className={SECTION}>
              <h3 className="font-semibold text-gray-900">상품 주요 정보</h3>

              {/* 제조사 */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">제조사</label>
                <input
                  value={manufacturer}
                  onChange={(e) => setManufacturer(e.target.value)}
                  placeholder="제조사를 알 수 없는 경우 브랜드명을 입력해주세요."
                  className={INPUT}
                />
              </div>

              {/* 미성년자 구매 */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">미성년자 구매 <span className="text-red-500">*</span></label>
                <div className="flex gap-4">
                  {([['EVERYONE', '가능'], ['ADULTS_ONLY', '불가능']] as const).map(([val, label]) => (
                    <label key={val} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="adultOnly" value={val} checked={adultOnly === val} onChange={() => setAdultOnly(val)} className="accent-blue-600" />
                      <span className="text-sm text-gray-700">{label}</span>
                    </label>
                  ))}
                </div>
                {adultOnly === 'ADULTS_ONLY' && (
                  <p className="text-xs text-orange-600">⚠ 상품 등록 후에는 미성년자 구매 &apos;가능&apos;으로 변경할 수 없습니다.</p>
                )}
              </div>

              {/* 병행수입 */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">병행수입</label>
                <div className="flex gap-4">
                  {([['NOT_PARALLEL_IMPORTED', '병행수입 아님'], ['PARALLEL_IMPORTED', '병행수입']] as const).map(([val, label]) => (
                    <label key={val} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="parallelImported" value={val} checked={parallelImported === val} onChange={() => setParallelImported(val)} className="accent-blue-600" />
                      <span className="text-sm text-gray-700">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* 중고상품 여부 */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">중고상품 여부 <span className="text-red-500">*</span></label>
                <div className="flex gap-4">
                  {([['NEW', '새상품'], ['USED', '중고상품']] as const).map(([val, label]) => (
                    <label key={val} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="usedProduct" value={val} checked={usedProduct === val} onChange={() => setUsedProduct(val)} className="accent-blue-600" />
                      <span className="text-sm text-gray-700">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* 부가세 */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700">부가세 <span className="text-red-500">*</span></label>
                <div className="flex gap-4">
                  {([['TAX', '과세'], ['TAX_FREE', '면세']] as const).map(([val, label]) => (
                    <label key={val} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="taxType" value={val} checked={taxType === val} onChange={() => setTaxType(val)} className="accent-blue-600" />
                      <span className="text-sm text-gray-700">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* 섹션 2: 가격 · 재고 */}
            <div className={SECTION}>
              <h3 className="font-semibold text-gray-900">가격 · 재고</h3>

              <div className="flex gap-4">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-sm font-medium text-gray-700">판매가 (원)</label>
                  <input
                    type="number"
                    value={salePrice}
                    onChange={(e) => setSalePrice(Number(e.target.value))}
                    className={INPUT}
                  />
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-sm font-medium text-gray-700">
                    정가 (원)
                    {salePrice > 0 && originalPrice > salePrice && (
                      <span className="ml-2 text-xs text-blue-500">
                        {Math.round((1 - salePrice / originalPrice) * 100)}% 할인
                      </span>
                    )}
                  </label>
                  <input
                    type="number"
                    value={originalPrice}
                    onChange={(e) => setOriginalPrice(Number(e.target.value))}
                    className={`${INPUT} ${originalPrice > 0 && originalPrice <= salePrice ? 'border-red-400' : ''}`}
                  />
                  {originalPrice > 0 && originalPrice <= salePrice && (
                    <p className="text-xs text-red-500">정가는 판매가보다 높아야 합니다</p>
                  )}
                </div>
              </div>

              {salePrice > 0 && safeDomePrice > 0 && Number.isFinite(calc.netProfit) && (
                <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                  <div className="flex justify-between text-gray-700">
                    <span>판매가</span>
                    <span className="font-medium">{salePrice.toLocaleString()}원</span>
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span>(-) 도매 원가</span>
                    <span>{safeDomePrice.toLocaleString()}원</span>
                  </div>
                  {safeDeliveryFee > 0 && (
                    <div className="flex justify-between text-gray-500">
                      <span>(-) 도매 배송비</span>
                      <span>{safeDeliveryFee.toLocaleString()}원</span>
                    </div>
                  )}
                  <div className="flex justify-between text-gray-500 items-center">
                    <span>
                      (-) 쿠팡 수수료&nbsp;
                      <span className={customRate ? 'text-blue-600 font-medium' : 'text-gray-400'}>
                        ({(effectiveFeeRate * 100).toFixed(1)}%
                        {customRate ? ' 직접입력' : ` 추정·${coupangCategory}`})
                      </span>
                    </span>
                    <span>{effectiveCommission.toLocaleString()}원</span>
                  </div>
                  {/* 수수료율 직접 입력 — 쿠팡 윙스에서 확인한 값 입력 */}
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>수수료율 직접 입력 (쿠팡 윙스 확인값):</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="50"
                      value={customFeeRate}
                      onChange={(e) => setCustomFeeRate(e.target.value)}
                      placeholder={`${(effectiveFeeRate * 100).toFixed(1)}`}
                      className="w-16 px-1.5 py-0.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    <span>%</span>
                    {customFeeRate && (
                      <button onClick={() => setCustomFeeRate('')} className="text-gray-400 hover:text-red-500 text-xs">초기화</button>
                    )}
                  </div>
                  <div className="border-t border-gray-200 pt-1 flex justify-between font-medium">
                    <span className={effectiveNetProfit >= 0 ? 'text-blue-600' : 'text-red-500'}>
                      예상 마진
                    </span>
                    <span className={effectiveNetProfit >= 0 ? 'text-blue-600' : 'text-red-500'}>
                      {effectiveNetProfit.toLocaleString()}원&nbsp;
                      <span className="text-xs font-normal">({effectiveMarginRate.toFixed(1)}%)</span>
                    </span>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1 w-40">
                <label className="text-sm font-medium text-gray-700">재고 수량</label>
                <input
                  type="number"
                  value={stock}
                  min={1}
                  onChange={(e) => setStock(Number(e.target.value))}
                  className={INPUT}
                />
              </div>
            </div>

            {/* 섹션 2.5: 상품 옵션 */}
            <div className={SECTION}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">상품 옵션</h3>
                {!showOptionInput && (
                  <button
                    type="button"
                    onClick={() => setShowOptionInput(true)}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    + 옵션 종류 추가
                  </button>
                )}
              </div>

              {/* 옵션 종류가 없고 input도 숨겨진 상태 */}
              {optionTypes.length === 0 && !showOptionInput && (
                <p className="text-sm text-gray-400">옵션 없음 (단일 상품)</p>
              )}

              {/* 새 옵션 종류 추가 input */}
              {showOptionInput && (
                <div className="flex gap-2">
                  <input
                    value={newOptionName}
                    onChange={(e) => setNewOptionName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOptionType(); } }}
                    placeholder="옵션 종류 이름 (예: 색상)"
                    className={INPUT}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={addOptionType}
                    className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm whitespace-nowrap hover:bg-blue-700"
                  >
                    추가
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowOptionInput(false); setNewOptionName(''); }}
                    className="px-3 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm whitespace-nowrap hover:bg-gray-50"
                  >
                    취소
                  </button>
                </div>
              )}

              {/* 등록된 옵션 종류 목록 */}
              {optionTypes.map((optType) => (
                <div key={optType.id} className="flex flex-col gap-2 bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-800">{optType.name}</span>
                    <button
                      type="button"
                      onClick={() => removeOptionType(optType.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      종류 삭제
                    </button>
                  </div>
                  {/* 값 chip 목록 */}
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {optType.values.map((val) => (
                      <span
                        key={val.id}
                        className="flex items-center gap-1 px-2.5 py-1 bg-white border border-gray-200 text-gray-700 rounded-full text-xs"
                      >
                        {val.value}
                        <button
                          type="button"
                          onClick={() => removeOptionValue(optType.id, val.id)}
                          className="text-gray-400 hover:text-red-500 leading-none"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {/* 새 값 입력 */}
                    <div className="flex gap-1 items-center">
                      <input
                        value={newOptionValues[optType.id] ?? ''}
                        onChange={(e) =>
                          setNewOptionValues((prev) => ({ ...prev, [optType.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); addOptionValue(optType.id); }
                        }}
                        placeholder="값 입력"
                        className="px-2 py-1 border border-gray-300 rounded-lg text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-24"
                      />
                      <button
                        type="button"
                        onClick={() => addOptionValue(optType.id)}
                        className="px-2 py-1 bg-gray-200 text-gray-700 rounded-lg text-xs hover:bg-gray-300"
                      >
                        추가
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {/* 옵션 조합 테이블 */}
              {variants.length > 0 && (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">
                      옵션 조합 ({variants.length}개)
                    </span>
                  </div>

                  {/* 일괄 설정 */}
                  <div className="flex gap-2 items-end flex-wrap">
                    <span className="text-xs text-gray-500 self-center whitespace-nowrap">일괄 설정:</span>
                    <div className="flex flex-col gap-0.5">
                      <label className="text-xs text-gray-500">판매가</label>
                      <input
                        type="number"
                        value={bulkSalePrice}
                        onChange={(e) => setBulkSalePrice(e.target.value)}
                        placeholder={salePrice > 0 ? String(salePrice) : '0'}
                        className="px-2 py-1 border border-gray-300 rounded-lg text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-24"
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <label className="text-xs text-gray-500">정가</label>
                      <input
                        type="number"
                        value={bulkOriginalPrice}
                        onChange={(e) => setBulkOriginalPrice(e.target.value)}
                        placeholder={originalPrice > 0 ? String(originalPrice) : '0'}
                        className="px-2 py-1 border border-gray-300 rounded-lg text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-24"
                      />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <label className="text-xs text-gray-500">재고</label>
                      <input
                        type="number"
                        value={bulkStock}
                        onChange={(e) => setBulkStock(e.target.value)}
                        placeholder={String(stock)}
                        className="px-2 py-1 border border-gray-300 rounded-lg text-xs text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-20"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (bulkSalePrice) bulkSetVariants('salePrice', Number(bulkSalePrice));
                        if (bulkOriginalPrice) bulkSetVariants('originalPrice', Number(bulkOriginalPrice));
                        if (bulkStock) bulkSetVariants('stock', Number(bulkStock));
                        setBulkSalePrice('');
                        setBulkOriginalPrice('');
                        setBulkStock('');
                      }}
                      className="px-3 py-1 bg-gray-700 text-white rounded-lg text-xs hover:bg-gray-900 self-end"
                    >
                      전체 적용
                    </button>
                  </div>

                  {/* 조합 테이블 */}
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="text-left px-3 py-2 text-xs font-medium text-gray-600 w-1/2">옵션</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-gray-600">판매가</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-gray-600">정가</th>
                          <th className="text-right px-3 py-2 text-xs font-medium text-gray-600">재고</th>
                        </tr>
                      </thead>
                      <tbody>
                        {variants.map((v, idx) => (
                          <tr
                            key={v.key}
                            className={`border-b border-gray-100 last:border-0 ${idx % 2 === 1 ? 'bg-gray-50/50' : ''}`}
                          >
                            <td className="px-3 py-2 text-xs text-gray-700 font-medium">{v.combination}</td>
                            <td className="px-2 py-1.5">
                              <input
                                type="number"
                                value={v.salePrice}
                                onChange={(e) => updateVariantField(v.key, 'salePrice', Number(e.target.value))}
                                className="px-2 py-1 border border-gray-200 rounded text-xs text-gray-900 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-20 text-right"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="number"
                                value={v.originalPrice}
                                onChange={(e) => updateVariantField(v.key, 'originalPrice', Number(e.target.value))}
                                className="px-2 py-1 border border-gray-200 rounded text-xs text-gray-900 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-20 text-right"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="number"
                                value={v.stock}
                                onChange={(e) => updateVariantField(v.key, 'stock', Number(e.target.value))}
                                className="px-2 py-1 border border-gray-200 rounded text-xs text-gray-900 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-16 text-right"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* 섹션 3: 이미지 */}
            <div className={SECTION}>
              <h3 className="font-semibold text-gray-900">이미지</h3>

              {/* hidden file input — 슬롯 인덱스는 uploadSlotRef로 추적 */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />

              {/* 이미지 슬롯 2개 */}
              <div className="flex gap-3">
                {[0, 1].map((slotIdx) => {
                  const imgSrc = editImages[slotIdx];
                  return (
                    <div key={slotIdx} className="flex flex-col gap-1.5">
                      <span className="text-xs text-gray-500 font-medium">이미지 {slotIdx + 1}</span>
                      <div className="relative group w-[148px] h-[148px]">
                        {imgSrc ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={imgSrc}
                              alt={`이미지 ${slotIdx + 1}`}
                              className="w-full h-full object-cover rounded-lg border border-gray-200"
                            />
                            {/* hover 시 오버레이 버튼 */}
                            <div className="absolute inset-0 rounded-lg bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                              <button
                                onClick={() => triggerFileUpload(slotIdx)}
                                className="px-2 py-1 bg-white text-gray-800 rounded text-xs font-medium hover:bg-gray-100"
                              >
                                변경
                              </button>
                              <button
                                onClick={() => removeEditImage(slotIdx)}
                                className="px-2 py-1 bg-red-500 text-white rounded text-xs font-medium hover:bg-red-600"
                              >
                                제거
                              </button>
                            </div>
                          </>
                        ) : (
                          /* 비어 있는 슬롯 — 클릭하면 파일 업로드 */
                          <button
                            onClick={() => triggerFileUpload(slotIdx)}
                            className="w-full h-full flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors text-xs gap-1"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                            </svg>
                            {slotIdx === 0 ? '이미지 추가' : '추가'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 상품 이미지에서 선택 — imageUrls가 여러 개일 때만 표시 */}
              {(product?.imageUrls?.length ?? 0) > 1 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-gray-500 font-medium">상품 이미지에서 선택</span>
                  <div className="flex gap-2 flex-wrap">
                    {product!.imageUrls.map((url, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          // 빈 슬롯이 있으면 채우고, 없으면 슬롯1 교체
                          setEditImages((prev) => {
                            if (prev.length < 2) return [...prev, url].slice(0, 2);
                            return [prev[0], url];
                          });
                        }}
                        className="relative w-12 h-12 rounded border border-gray-200 overflow-hidden hover:ring-2 hover:ring-blue-400 transition-all"
                        title={`이미지 ${i + 1} 선택`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={`상품 이미지 ${i + 1}`} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* AI 프롬프트 제안 */}
              {(isGeneratingPrompts || suggestedPrompts.length > 0) && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500 font-medium">AI 제안 프롬프트</span>
                    {isGeneratingPrompts && (
                      <span className="text-xs text-purple-500 animate-pulse">분석 중...</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {isGeneratingPrompts && suggestedPrompts.length === 0
                      ? [1, 2, 3].map((n) => (
                          <div key={n} className="h-9 rounded-lg bg-gray-100 animate-pulse" />
                        ))
                      : suggestedPrompts.map((prompt, idx) => (
                          <button
                            key={idx}
                            onClick={() => setEditInstruction(prompt)}
                            className={`text-left px-3 py-2 rounded-lg text-xs border transition-all ${
                              editInstruction === prompt
                                ? 'border-purple-500 bg-purple-50 text-purple-800'
                                : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-purple-300 hover:bg-purple-50/50'
                            }`}
                          >
                            <span className="font-semibold text-purple-600 mr-1.5">
                              {['기본형', '스타일형', '멀티샷형'][idx] ?? `옵션 ${idx + 1}`}
                            </span>
                            {prompt}
                          </button>
                        ))}
                  </div>
                </div>
              )}

              {/* AI 프롬프트 */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-gray-500 font-medium">AI 프롬프트</label>
                <textarea
                  value={editInstruction}
                  onChange={(e) => setEditInstruction(e.target.value)}
                  placeholder="배경을 흰색으로 바꿔줘, 밝게 편집해줘..."
                  rows={3}
                  disabled={isEditingImg}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none disabled:bg-gray-50 disabled:text-gray-400"
                />
              </div>

              {/* AI 편집 버튼 영역 */}
              <div className="flex gap-2">
                <button
                  onClick={() => handleAiEdit('edit')}
                  disabled={isEditingImg || !editInstruction.trim() || !editImages[0]}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm whitespace-nowrap hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {isEditingImg ? '편집 중...' : 'AI 편집'}
                </button>
                {editImages.length === 2 && (
                  <button
                    onClick={() => handleAiEdit('combine')}
                    disabled={isEditingImg || !editInstruction.trim()}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm whitespace-nowrap hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    {isEditingImg ? '편집 중...' : '2장 합치기'}
                  </button>
                )}
              </div>

              {imgEditError && <p className="text-xs text-red-500">{imgEditError}</p>}
            </div>

            {/* 섹션 4: 상세페이지 */}
            <div className={SECTION}>
              {detailHtml ? (
                /* ── 케이스 1: HTML 있음 → HTML 편집 모드 ── */
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900">상세페이지</h3>
                    <div className="flex rounded-lg overflow-hidden border border-gray-200 text-xs">
                      <button
                        onClick={() => setIsPreview(true)}
                        className={`px-3 py-1.5 ${isPreview ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                      >
                        미리보기
                      </button>
                      <button
                        onClick={() => setIsPreview(false)}
                        className={`px-3 py-1.5 ${!isPreview ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                      >
                        HTML 편집
                      </button>
                    </div>
                  </div>

                  {isPreview ? (
                    <div
                      className="border border-gray-200 rounded-lg p-4 max-h-72 overflow-y-auto text-sm"
                      dangerouslySetInnerHTML={{ __html: safeHtml }}
                    />
                  ) : (
                    <textarea
                      value={detailHtml}
                      onChange={(e) => setDetailHtml(e.target.value)}
                      rows={12}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono text-gray-900 bg-white resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
                      spellCheck={false}
                    />
                  )}

                  {/* AI 지시문 편집 영역 */}
                  <div className="border-t border-gray-100 pt-4 flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 font-medium">AI 편집 지시문</span>
                      {product && (
                        <button
                          onClick={handleGenerateDetailPrompts}
                          disabled={isGeneratingDetailPrompts}
                          className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isGeneratingDetailPrompts ? '분석 중...' : 'AI 제안 3개'}
                        </button>
                      )}
                    </div>

                    {(isGeneratingDetailPrompts || detailSuggestedPrompts.length > 0) && (
                      <div className="flex flex-col gap-1.5">
                        {isGeneratingDetailPrompts && detailSuggestedPrompts.length === 0
                          ? [1, 2, 3].map((n) => (
                              <div key={n} className="h-9 rounded-lg bg-gray-100 animate-pulse" />
                            ))
                          : detailSuggestedPrompts.map((prompt, idx) => (
                              <button
                                key={idx}
                                onClick={() => setDetailEditInstruction(prompt)}
                                className={`text-left px-3 py-2 rounded-lg text-xs border transition-all ${
                                  detailEditInstruction === prompt
                                    ? 'border-purple-500 bg-purple-50 text-purple-800'
                                    : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-purple-300 hover:bg-purple-50/50'
                                }`}
                              >
                                <span className="font-semibold text-purple-600 mr-1.5">
                                  {['설명강화형', '레이아웃정리형', '특징부각형'][idx] ?? `옵션 ${idx + 1}`}
                                </span>
                                {prompt}
                              </button>
                            ))}
                      </div>
                    )}

                    <input
                      value={detailEditInstruction}
                      onChange={(e) => setDetailEditInstruction(e.target.value)}
                      placeholder="상품 설명을 더 설득력 있게 작성해줘, 모바일 레이아웃으로 재구성해줘..."
                      disabled={isEditingDetailHtml}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50 w-full"
                    />

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDetailHtmlEdit(detailEditInstruction)}
                        disabled={isEditingDetailHtml || !detailEditInstruction.trim()}
                        className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm whitespace-nowrap hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                      >
                        {isEditingDetailHtml ? 'AI 편집 중...' : 'AI 편집'}
                      </button>
                      <button
                        onClick={handleDetailHtmlRegenerate}
                        disabled={isEditingDetailHtml}
                        className="px-4 py-2 border border-purple-300 text-purple-700 rounded-lg text-sm whitespace-nowrap hover:bg-purple-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        처음부터 재생성
                      </button>
                    </div>

                    {detailHtmlEditError && (
                      <p className="text-xs text-red-500">{detailHtmlEditError}</p>
                    )}

                    <button
                      onClick={() => { setDetailHtml(''); setDetailImages([]); setDetailSuggestedPrompts([]); setDetailEditInstruction(''); }}
                      className="text-xs text-gray-400 hover:text-gray-600 self-start"
                    >
                      사진으로 다시 시작 →
                    </button>
                  </div>
                </>
              ) : (
                /* ── 케이스 2: HTML 없음 → 사진 첨부 & HTML 생성 모드 ── */
                <>
                  <h3 className="font-semibold text-gray-900">상세페이지 이미지로 생성</h3>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 font-medium">AI 편집 프롬프트</span>
                      {product && (
                        <button
                          onClick={handleGenerateDetailPrompts}
                          disabled={isGeneratingDetailPrompts}
                          className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isGeneratingDetailPrompts ? '분석 중...' : 'AI 제안 3개'}
                        </button>
                      )}
                    </div>

                    {(isGeneratingDetailPrompts || detailSuggestedPrompts.length > 0) && (
                      <div className="flex flex-col gap-1.5">
                        {isGeneratingDetailPrompts && detailSuggestedPrompts.length === 0
                          ? [1, 2, 3].map((n) => (
                              <div key={n} className="h-9 rounded-lg bg-gray-100 animate-pulse" />
                            ))
                          : detailSuggestedPrompts.map((prompt, idx) => (
                              <button
                                key={idx}
                                onClick={() => setDetailEditInstruction(prompt)}
                                className={`text-left px-3 py-2 rounded-lg text-xs border transition-all ${
                                  detailEditInstruction === prompt
                                    ? 'border-purple-500 bg-purple-50 text-purple-800'
                                    : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-purple-300 hover:bg-purple-50/50'
                                }`}
                              >
                                <span className="font-semibold text-purple-600 mr-1.5">
                                  {['배경정리형', '특징강조형', '라이프스타일형'][idx] ?? `옵션 ${idx + 1}`}
                                </span>
                                {prompt}
                              </button>
                            ))}
                      </div>
                    )}

                    <input
                      value={detailEditInstruction}
                      onChange={(e) => setDetailEditInstruction(e.target.value)}
                      placeholder="배경 제거, 밝기 조정, 라이프스타일 배경 추가..."
                      disabled={isEditingDetailImg}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50 w-full"
                    />

                    <div className="flex gap-2">
                      <button
                        onClick={handleDetailImgAiEditAll}
                        disabled={isEditingDetailImg || !detailEditInstruction.trim() || detailImages.length === 0}
                        className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm whitespace-nowrap hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                      >
                        {isEditingDetailImg
                          ? `편집 중 (${(detailEditingSlot ?? 0) + 1}/${detailImages.length})...`
                          : '사진 AI 편집'}
                      </button>
                      {detailImages.length === 0 && (
                        <span className="text-xs text-gray-400 self-center">이미지를 먼저 추가하세요</span>
                      )}
                    </div>
                    {detailImgEditError && <p className="text-xs text-red-500">{detailImgEditError}</p>}
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">상세 이미지</span>
                    <button
                      onClick={() => triggerDetailFileUpload(detailImages.length)}
                      className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200"
                    >
                      + 이미지 추가
                    </button>
                  </div>

                  {detailImages.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {detailImages.map((url, idx) => (
                        <div key={idx} className="flex items-center gap-2 p-2 border border-gray-200 rounded-lg bg-gray-50">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`상세 이미지 ${idx + 1}`}
                            className="w-16 h-16 object-cover rounded border border-gray-200 flex-shrink-0 cursor-pointer"
                            onClick={() => triggerDetailFileUpload(idx)}
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-xs text-gray-500">이미지 {idx + 1}</span>
                          </div>
                          <button
                            onClick={() => handleDetailImgAiEdit(idx)}
                            disabled={isEditingDetailImg || !detailEditInstruction.trim()}
                            className="px-2.5 py-1.5 bg-purple-600 text-white rounded text-xs whitespace-nowrap hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                          >
                            {isEditingDetailImg && detailEditingSlot === idx ? '편집 중...' : 'AI 편집'}
                          </button>
                          <button
                            onClick={() => removeDetailImage(idx)}
                            className="px-2 py-1.5 text-gray-400 hover:text-red-500 text-xs"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      onClick={() => triggerDetailFileUpload(0)}
                      onDragOver={(e) => e.preventDefault()}
                      onDragEnter={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
                        files.forEach(file => {
                          const reader = new FileReader();
                          reader.onload = () => {
                            setDetailImages(prev => prev.length < 5 ? [...prev, reader.result as string] : prev);
                          };
                          reader.readAsDataURL(file);
                        });
                      }}
                      className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
                    >
                      <p className="text-sm text-gray-400">클릭해서 상세 이미지를 추가하세요</p>
                    </div>
                  )}

                  <div className="border-t border-gray-100 pt-3">
                    {detailHtmlEditError && (
                      <p className="text-xs text-red-500 mb-2">{detailHtmlEditError}</p>
                    )}
                    <button
                      onClick={handleGenerateHtmlFromImages}
                      disabled={detailImages.length === 0 || isGeneratingHtmlFromImages}
                      className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      {isGeneratingHtmlFromImages
                        ? 'HTML 생성 중... (30초~1분 소요)'
                        : detailImages.length === 0
                        ? '이미지를 추가하면 HTML 생성 가능'
                        : `HTML 생성 (이미지 ${detailImages.length}장)`}
                    </button>
                  </div>

                  <input
                    ref={detailFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleDetailFileChange}
                  />
                </>
              )}
            </div>

            {/* 섹션 5: 배송 · 반품 */}
            <div className={SECTION}>
              <h3 className="font-semibold text-gray-900">배송 · 반품</h3>

              <div className="flex gap-4">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-sm font-medium text-gray-700">배송 방법</label>
                  <select
                    value={deliveryMethod}
                    onChange={(e) => setDeliveryMethod(e.target.value as 'SEQUENCIAL' | 'VENDOR_DIRECT')}
                    className={INPUT}
                  >
                    <option value="SEQUENCIAL">순차배송</option>
                    <option value="VENDOR_DIRECT">직배송</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-sm font-medium text-gray-700">배송비 유형</label>
                  <select
                    value={deliveryChargeType}
                    onChange={(e) => setDeliveryChargeType(e.target.value as 'FREE' | 'NOT_FREE')}
                    className={INPUT}
                  >
                    <option value="FREE">무료</option>
                    <option value="NOT_FREE">유료</option>
                  </select>
                </div>
              </div>

              {deliveryChargeType === 'NOT_FREE' && (
                <div className="flex flex-col gap-1 w-40">
                  <label className="text-sm font-medium text-gray-700">배송비 (원)</label>
                  <input
                    type="number"
                    value={deliveryCharge}
                    onChange={(e) => setDeliveryCharge(Number(e.target.value))}
                    className={INPUT}
                  />
                </div>
              )}

              <div className="flex gap-4">
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-sm font-medium text-gray-700">출하지 코드</label>
                  <input value={outboundCode} onChange={(e) => setOutboundCode(e.target.value)} className={INPUT} />
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-sm font-medium text-gray-700">반품센터 코드</label>
                  <input value={returnCode} onChange={(e) => setReturnCode(e.target.value)} className={INPUT} />
                </div>
              </div>
            </div>

            {/* 섹션 6: 고시정보 */}
            <div className={SECTION}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">고시정보 (법정 표기사항)</h3>
                {isNoticeFetching && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                    <span className="text-xs text-blue-500">AI 고시정보 생성 중...</span>
                  </div>
                )}
              </div>
              {notices.length === 0 && !isNoticeFetching && (
                <p className="text-sm text-gray-400">카테고리 코드를 입력하면 AI가 자동으로 작성합니다.</p>
              )}
              {notices.map((n, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500">{n.categoryName} &gt; {n.detailName}</label>
                  <input
                    value={n.content}
                    onChange={(e) => {
                      const updated = [...notices];
                      updated[i] = { ...updated[i], content: e.target.value };
                      setNotices(updated);
                    }}
                    className={INPUT}
                    placeholder="직접 입력하거나 AI 생성 값을 수정하세요"
                  />
                </div>
              ))}
            </div>

            {/* 섹션 7: 검색 태그 */}
            <div className={SECTION}>
              <h3 className="font-semibold text-gray-900">검색 태그</h3>
              <div className="flex gap-2">
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
                  placeholder="태그 입력 후 Enter (최대 10개)"
                  className={INPUT}
                />
                <button onClick={addTag} className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 whitespace-nowrap">
                  추가
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span key={tag} className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs">
                    {tag}
                    <button onClick={() => setTags(tags.filter((t) => t !== tag))} className="text-blue-400 hover:text-blue-700">×</button>
                  </span>
                ))}
              </div>
            </div>

            {/* 등록 버튼 영역 */}
            {submitSuccess && submitResult ? (
              <div className="flex flex-col items-center gap-4 py-8">
                <div className="text-green-600 text-4xl">&#10003;</div>
                <div className="text-center">
                  <p className="font-semibold text-gray-900">쿠팡 제출 완료 (검수 대기)</p>
                  <p className="text-sm text-gray-500 mt-1">상품 ID: {submitResult.sellerProductId}</p>
                  <p className="text-sm text-gray-500">고객 노출 전 Wings에서 내용을 확인하세요</p>
                </div>
                <div className="flex gap-3">
                  <a
                    href={submitResult.wingsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                  >
                    Wings에서 확인하기 &rarr;
                  </a>
                  <button
                    onClick={() => {
                      setSubmitSuccess(false);
                      setSubmitResult(null);
                      setUrlDone(false);
                      setProduct(null);
                      setMappedFields(null);
                      setDraftId(null);
                    }}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50"
                  >
                    새 상품 등록
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {registerError && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{registerError}</p>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={handleSaveDraft}
                    disabled={isSavingDraft || !name}
                    className="flex-1 py-3 border-2 border-gray-300 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSavingDraft ? '저장 중...' : draftId ? '임시저장 업데이트' : '임시저장'}
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={isSubmitting || !name || !draftId || categoryCodeValid !== true}
                    className="flex-1 py-3 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    title={!draftId ? '먼저 임시저장하세요' : categoryCodeValid !== true ? '유효한 카테고리 코드를 입력하세요' : ''}
                  >
                    {isSubmitting ? '제출 중...' : '쿠팡에 제출'}
                  </button>
                </div>
                {draftSaveFeedback === 'saved' && (
                  <p className="text-xs text-center text-green-600 font-medium">저장됐습니다</p>
                )}
                {draftSaveFeedback === 'error' && (
                  <p className="text-xs text-center text-red-600">{draftSaveError || '저장에 실패했습니다'}</p>
                )}
                {!draftSaveFeedback && !draftId && (
                  <p className="text-xs text-center text-gray-400">임시저장 후 쿠팡에 제출할 수 있습니다</p>
                )}
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
