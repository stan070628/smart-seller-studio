'use client';

/**
 * BothRegisterForm.tsx
 * 쿠팡 + 네이버 동시 등록 폼 컴포넌트
 *
 * - sharedDraft 연동으로 폼 닫았다 열어도 입력값 유지
 * - 카테고리 검색: 키워드 1개로 쿠팡/네이버 API 병렬 호출
 * - Step 2에서 선택된 카테고리는 확인 모드로 표시 (변경 토글)
 * - 등록 완료 후 useEffect로 onSuccess 자동 호출
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Check, Loader2, Sparkles } from 'lucide-react';
import { useListingStore } from '@/store/useListingStore';
import ImageInputSection from './ImageInputSection';
import OptionEditor from './OptionEditor';

// ─────────────────────────────────────────────────────────────────────────────
// 색상 상수 (ListingDashboard 동일)
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: '#fafafa',
  card: '#ffffff',
  border: '#e5e5e5',
  text: '#18181b',
  textSub: '#71717a',
  accent: '#be0014',
  tableHeader: '#f3f3f3',
  btnPrimaryBg: '#be0014',
  btnPrimaryText: '#ffffff',
  btnSecondaryBg: '#f3f3f3',
  btnSecondaryText: '#18181b',
};

// ─────────────────────────────────────────────────────────────────────────────
// 공통 스타일 객체
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

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: C.text,
};

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────
export interface DomeggookPrepareData {
  thumbnailUrl: string;       // 가공된 대표이미지 URL
  detailHtml: string;         // 가공된 상세 HTML
  title: string;              // 상품명
  naverPrice: number;         // 네이버 추천판매가 (마진 10% 포함)
  coupangPrice: number;       // 쿠팡 추천판매가 (마진 10% 포함)
  itemNo?: number;            // 도매꾹 상품번호 (옵션 자동 불러오기용, 선택)
  costBase?: number;          // 순수 원가 (도매가 × MOQ, 배송비 제외) — 가격 자동 재계산용
  effectiveDeliFee?: number;  // 실효 배송비 (판매자 선불 시 0) — 가격 자동 재계산용
}

interface BothRegisterFormProps {
  onSuccess: () => void;   // 등록 성공 후 호출
  onCancel: () => void;    // 취소 버튼 클릭 시 호출
  prefill?: DomeggookPrepareData;  // 도매꾹 불러오기에서 넘겨받는 데이터
}

// ─────────────────────────────────────────────────────────────────────────────
// 카테고리 검색 결과 타입
// ─────────────────────────────────────────────────────────────────────────────
interface CoupangCategoryResult {
  code: number;
  name: string;
  path: string;
}

interface NaverCategoryResult {
  id: string;
  name: string;
  path: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 구분선 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
function Divider({ label }: { label?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        margin: '4px 0',
      }}
    >
      <div style={{ flex: 1, height: '1px', backgroundColor: C.border }} />
      {label && (
        <span style={{ ...sectionHeaderStyle, whiteSpace: 'nowrap', color: C.textSub }}>
          {label}
        </span>
      )}
      <div style={{ flex: 1, height: '1px', backgroundColor: C.border }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 에러 인라인 표시 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      style={{
        fontSize: '11px',
        color: '#b91c1c',
        marginTop: '4px',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
      }}
    >
      <span>⚠</span>
      <span>{message}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────────────────────────
export default function BothRegisterForm({ onSuccess, onCancel, prefill }: BothRegisterFormProps) {
  const { sharedDraft, updateSharedDraft, bothRegistration, registerBothProducts, resetBothRegistration, fetchOptions } =
    useListingStore();

  // 도매꾹 데이터 자동 채우기 (마운트 시 1회)
  const prefillApplied = useRef(false);
  useEffect(() => {
    if (prefill && !prefillApplied.current) {
      prefillApplied.current = true;
      updateSharedDraft({
        name: prefill.title,
        thumbnailImages: [prefill.thumbnailUrl],
        description: prefill.detailHtml,
        naverPrice: String(prefill.naverPrice),
        coupangPrice: String(prefill.coupangPrice),
      });
    }
  }, [prefill, updateSharedDraft]);

  // 도매꾹 itemNo가 있을 때 옵션 자동 불러오기 (마운트 시 1회)
  const optionsFetchApplied = useRef(false);
  useEffect(() => {
    if (prefill?.itemNo && !optionsFetchApplied.current) {
      optionsFetchApplied.current = true;
      fetchOptions(prefill.itemNo);
    }
  }, [prefill?.itemNo, fetchOptions]);

  // ─── 등록 성공 후 onSuccess 자동 호출 (useEffect) ──────────────────────
  useEffect(() => {
    const { coupang, naver } = bothRegistration;
    const isSuccess =
      coupang.status === 'success' ||
      naver.status === 'success' ||
      naver.status === 'draft';
    if (isSuccess) {
      // 사용자가 결과를 잠시 확인할 시간을 준 후 onSuccess 호출
      const timer = setTimeout(() => onSuccess(), 1500);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bothRegistration.coupang.status, bothRegistration.naver.status]);

  // ─── 플랫폼별 전용 상태 ─────────────────────────────────────────────────
  const [coupangCategoryCode, setCoupangCategoryCode] = useState(sharedDraft.coupangCategoryCode);
  const [coupangCategoryPath, setCoupangCategoryPath] = useState(sharedDraft.coupangCategoryPath);
  const [naverCategoryId, setNaverCategoryId] = useState(sharedDraft.naverCategoryId);
  const [naverCategoryPath, setNaverCategoryPath] = useState(sharedDraft.naverCategoryPath);

  // 카테고리 검색창 토글 상태 (Step 2에서 선택됐으면 기본 확인 모드)
  const [showCoupangCatSearch, setShowCoupangCatSearch] = useState(!sharedDraft.coupangCategoryCode);
  const [showNaverCatSearch, setShowNaverCatSearch] = useState(!sharedDraft.naverCategoryId);

  // Step 2에서 선택한 카테고리가 있으면 마운트 시 동기화
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

  const [brand, setBrand] = useState('');
  const [naverExchangeFee, setNaverExchangeFee] = useState('5000');

  // ─── 카테고리 검색 상태 ──────────────────────────────────────────────────
  const [categoryKeyword, setCategoryKeyword] = useState('');
  const [coupangResults, setCoupangResults] = useState<CoupangCategoryResult[]>([]);
  const [naverResults, setNaverResults] = useState<NaverCategoryResult[]>([]);
  const [isCategorySearching, setIsCategorySearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── 태그 입력 상태 ──────────────────────────────────────────────────────
  const [tagInput, setTagInput] = useState('');

  // ─── 배송비 기반 판매가 자동 재계산 ─────────────────────────────────────
  /**
   * costBase + effectiveDeliFee 가 있을 때 배송비 설정에 따라 채널별 판매가 재계산
   * 공식: adjustedCost = costBase + max(effectiveDeliFee - buyerDeliveryCharge, 0)
   *       salePrice = round((adjustedCost * 1.10) / (1 - fee - VAT) / 10) * 10
   */
  const recalcChannelPrices = useCallback(
    (chargeType: 'FREE' | 'NOT_FREE' | 'CHARGE_RECEIVED', chargeAmount: number) => {
      if (prefill?.costBase === undefined || prefill?.effectiveDeliFee === undefined) return;

      const { costBase, effectiveDeliFee } = prefill;
      const buyerDelivery = chargeType === 'NOT_FREE' ? chargeAmount : 0;
      const netDeliFee = Math.max(effectiveDeliFee - buyerDelivery, 0);
      const adjustedCost = costBase + netDeliFee;
      const targetProfit = Math.ceil(adjustedCost * 0.10);

      const VAT = 10 / 110;
      const naverRate = 1 - 0.06 - VAT;
      const coupangRate = 1 - 0.11 - VAT;

      const newNaverPrice = Math.round((adjustedCost + targetProfit) / naverRate / 10) * 10;
      const newCoupangPrice = Math.round((adjustedCost + targetProfit) / coupangRate / 10) * 10;

      updateSharedDraft({
        naverPrice: String(newNaverPrice),
        coupangPrice: String(newCoupangPrice),
      });
    },
    [prefill, updateSharedDraft],
  );

  // ─── AI 최적화 상태 ──────────────────────────────────────────────────────
  const [isOptimizing, setIsOptimizing] = useState(false);

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
  }, [sharedDraft.name, isOptimizing, updateSharedDraft]);

  // ─── 폼 검증 에러 ────────────────────────────────────────────────────────
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ─── 등록 완료 여부 ──────────────────────────────────────────────────────
  const isDone =
    bothRegistration.coupang.status === 'success' ||
    bothRegistration.coupang.status === 'error' ||
    bothRegistration.naver.status === 'success' ||
    bothRegistration.naver.status === 'error' ||
    bothRegistration.naver.status === 'draft';

  const isRegistering =
    bothRegistration.coupang.status === 'loading' ||
    bothRegistration.naver.status === 'loading';

  // ─── sharedDraft 헬퍼 ────────────────────────────────────────────────────
  const updateDraft = useCallback(
    (key: Parameters<typeof updateSharedDraft>[0]) => updateSharedDraft(key),
    [updateSharedDraft],
  );

  // ─── 이미지 URL 배열 (store 슬라이스 별칭) ───────────────────────────────
  const thumbnailImageUrls = sharedDraft.thumbnailImages;
  const detailImageUrls = sharedDraft.detailImages;

  // ─── 카테고리 병렬 검색 ──────────────────────────────────────────────────
  const searchCategories = (keyword: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!keyword.trim()) {
      setCoupangResults([]);
      setNaverResults([]);
      return;
    }

    searchTimerRef.current = setTimeout(async () => {
      setIsCategorySearching(true);
      try {
        const encoded = encodeURIComponent(keyword.trim());
        const [coupangRes, naverRes] = await Promise.all([
          fetch(`/api/listing/coupang/categories?keyword=${encoded}`),
          fetch(`/api/listing/naver/categories?keyword=${encoded}`),
        ]);

        const [coupangJson, naverJson] = await Promise.all([
          coupangRes.json() as Promise<{ success: boolean; data: CoupangCategoryResult[] }>,
          naverRes.json() as Promise<{ success: boolean; data: NaverCategoryResult[] }>,
        ]);

        // 최대 8개만 표시
        setCoupangResults(coupangJson.success ? (coupangJson.data ?? []).slice(0, 8) : []);
        setNaverResults(naverJson.success ? (naverJson.data ?? []).slice(0, 8) : []);
      } catch {
        setCoupangResults([]);
        setNaverResults([]);
      } finally {
        setIsCategorySearching(false);
      }
    }, 300);
  };

  // ─── 태그 추가 ───────────────────────────────────────────────────────────
  const addTag = (input: string) => {
    const newTags = input
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && !sharedDraft.tags.includes(t));
    if (newTags.length > 0) {
      updateDraft({ tags: [...sharedDraft.tags, ...newTags] });
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    updateDraft({ tags: sharedDraft.tags.filter((t) => t !== tag) });
  };

  // 플랫폼 선택 편의 변수
  const platform = sharedDraft.selectedPlatform ?? 'both';
  const needCoupang = platform !== 'naver';
  const needNaver   = platform !== 'coupang';

  // ─── 검증 ────────────────────────────────────────────────────────────────
  const validate = (): boolean => {
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
  };

  // ─── 공통 payload 생성 ─────────────────────────────────────────────────
  const buildPayloadData = () => ({
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
  });

  // ─── 미리보기 ───────────────────────────────────────────────────────────
  const [previewData, setPreviewData] = useState<{ coupang: unknown; naver: unknown } | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const handlePreview = async () => {
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
  };

  // ─── 등록 실행 ───────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetBothRegistration();
    setPreviewData(null);

    if (!validate()) return;

    await registerBothProducts(buildPayloadData());
    // 성공 후 onSuccess 호출은 useEffect에서 처리
  };

  // ─── 취소 핸들러 ─────────────────────────────────────────────────────────
  const handleCancel = () => {
    resetBothRegistration();
    onCancel();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // 렌더
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        backgroundColor: C.bg,
        borderRadius: '12px',
        border: `1px solid ${C.border}`,
        overflow: 'hidden',
        marginBottom: '24px',
      }}
    >
      {/* ── 헤더 ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 24px',
          backgroundColor: C.card,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '12px',
              fontWeight: 700,
              color: C.btnPrimaryText,
              backgroundColor: C.btnPrimaryBg,
              borderRadius: '6px',
              padding: '3px 10px',
            }}
          >
            쿠팡 + 네이버
          </span>
          <span style={{ fontSize: '16px', fontWeight: 700, color: C.text }}>
            동시 등록
          </span>
        </div>
        <button
          type="button"
          onClick={handleCancel}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: C.textSub,
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <X size={18} />
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <div
          style={{
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}
        >
          {/* ── 공통 정보 섹션 헤더 ──────────────────────────────── */}
          <div>
            <div
              style={{
                ...sectionHeaderStyle,
                padding: '10px 16px',
                backgroundColor: C.tableHeader,
                borderRadius: '8px',
                marginBottom: '16px',
              }}
            >
              공통 정보
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* 상품명 */}
              <div>
                <label style={labelStyle}>
                  상품명 <span style={{ color: C.accent }}>*</span>
                </label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    style={{
                      ...inputStyle,
                      flex: 1,
                      borderColor: errors.name ? '#b91c1c' : C.border,
                    }}
                    value={sharedDraft.name}
                    onChange={(e) => {
                      updateDraft({ name: e.target.value });
                      if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
                    }}
                    placeholder="상품명을 입력하세요"
                  />
                  <button
                    type="button"
                    disabled={!sharedDraft.name.trim() || isOptimizing}
                    onClick={handleOptimize}
                    title="AI로 상품명·태그 최적화"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '0 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      border: '1px solid #8b5cf6',
                      borderRadius: '8px',
                      backgroundColor: isOptimizing ? '#f3f3f3' : '#f5f3ff',
                      color: isOptimizing ? C.textSub : '#7c3aed',
                      cursor: !sharedDraft.name.trim() || isOptimizing ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                      opacity: !sharedDraft.name.trim() ? 0.5 : 1,
                    }}
                  >
                    {isOptimizing ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={14} />}
                    {isOptimizing ? 'AI 최적화 중...' : 'AI 최적화'}
                  </button>
                </div>
                <FieldError message={errors.name} />
              </div>

              {/* 가격 / 재고 행 */}
              {/* 공통 판매가 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={labelStyle}>
                    공통 판매가
                    {!sharedDraft.coupangPrice && !sharedDraft.naverPrice && (
                      <span style={{ color: C.accent }}> *</span>
                    )}
                  </label>
                  <input
                    type="number"
                    min="100"
                    style={{
                      ...inputStyle,
                      borderColor: errors.salePrice ? '#b91c1c' : C.border,
                    }}
                    value={sharedDraft.salePrice}
                    onChange={(e) => {
                      updateDraft({ salePrice: e.target.value });
                      if (errors.salePrice) setErrors((prev) => ({ ...prev, salePrice: '' }));
                    }}
                    placeholder="채널 공통 가격"
                  />
                  <FieldError message={errors.salePrice} />
                </div>
                <div>
                  <label style={labelStyle}>정상가</label>
                  <input
                    type="number"
                    style={inputStyle}
                    value={sharedDraft.originalPrice}
                    onChange={(e) => updateDraft({ originalPrice: e.target.value })}
                    placeholder="할인 전 가격"
                  />
                </div>
                <div>
                  <label style={labelStyle}>재고</label>
                  <input
                    type="number"
                    min="0"
                    style={inputStyle}
                    value={sharedDraft.stock}
                    onChange={(e) => updateDraft({ stock: e.target.value })}
                  />
                </div>
              </div>

              {/* 채널별 판매가 (선택) */}
              <div>
                <div
                  style={{
                    fontSize: '11px',
                    color: '#71717a',
                    marginBottom: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span>채널별 판매가 설정</span>
                  <span
                    style={{
                      fontSize: '10px',
                      backgroundColor: '#f3f3f3',
                      color: '#71717a',
                      padding: '1px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    선택
                  </span>
                  <span style={{ color: '#a1a1aa' }}>— 입력 시 공통 판매가보다 우선 적용됩니다</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  {/* 쿠팡 전용 판매가 */}
                  <div>
                    <label
                      style={{
                        ...labelStyle,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          color: '#fff',
                          backgroundColor: '#be0014',
                          padding: '1px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        쿠팡
                      </span>
                      판매가
                    </label>
                    <input
                      type="number"
                      min="100"
                      style={inputStyle}
                      value={sharedDraft.coupangPrice}
                      onChange={(e) => {
                        updateDraft({ coupangPrice: e.target.value });
                        if (errors.salePrice) setErrors((prev) => ({ ...prev, salePrice: '' }));
                      }}
                      placeholder="미입력 시 공통 판매가 사용"
                    />
                  </div>
                  {/* 네이버 전용 판매가 */}
                  <div>
                    <label
                      style={{
                        ...labelStyle,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          color: '#fff',
                          backgroundColor: '#03c75a',
                          padding: '1px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        네이버
                      </span>
                      판매가
                    </label>
                    <input
                      type="number"
                      min="100"
                      style={inputStyle}
                      value={sharedDraft.naverPrice}
                      onChange={(e) => {
                        updateDraft({ naverPrice: e.target.value });
                        if (errors.salePrice) setErrors((prev) => ({ ...prev, salePrice: '' }));
                      }}
                      placeholder="미입력 시 공통 판매가 사용"
                    />
                  </div>
                </div>
              </div>

              {/* 옵션 편집 섹션 */}
              <OptionEditor itemNo={prefill?.itemNo} />

              {/* 썸네일 이미지 섹션 */}
              <ImageInputSection
                label="상품 이미지 (썸네일)"
                required
                maxCount={10}
                urls={thumbnailImageUrls}
                onUrlsChange={(urls) => {
                  updateDraft({ thumbnailImages: urls });
                  if (errors.images) setErrors((prev) => ({ ...prev, images: '' }));
                }}
                usageContext="listing_thumbnail"
                error={errors.images}
              />

              {/* 상세페이지 이미지 섹션 */}
              <div style={{ marginTop: '4px' }}>
                <div style={{ fontSize: '11px', color: C.textSub, marginBottom: '6px' }}>
                  상세페이지 이미지는 상품 상세설명 하단에 자동 삽입됩니다.
                </div>
                <ImageInputSection
                  label="상세페이지 이미지"
                  maxCount={20}
                  urls={detailImageUrls}
                  onUrlsChange={(urls) => updateDraft({ detailImages: urls })}
                  usageContext="listing_detail"
                />
              </div>

              {/* 배송 정보 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={labelStyle}>배송비 유형</label>
                  <select
                    style={inputStyle}
                    value={sharedDraft.deliveryChargeType}
                    onChange={(e) => {
                      const newType = e.target.value as 'FREE' | 'NOT_FREE' | 'CHARGE_RECEIVED';
                      updateDraft({ deliveryChargeType: newType });
                      recalcChannelPrices(newType, Number(sharedDraft.deliveryCharge));
                    }}
                  >
                    <option value="FREE">무료배송</option>
                    <option value="NOT_FREE">유료배송</option>
                    <option value="CHARGE_RECEIVED">착불</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>
                    배송비 (원)
                    {prefill?.effectiveDeliFee !== undefined && prefill.effectiveDeliFee > 0 && (
                      <span style={{ fontWeight: 400, color: C.textSub, marginLeft: '4px' }}>
                        — 도매꾹 {prefill.effectiveDeliFee.toLocaleString()}원
                      </span>
                    )}
                  </label>
                  <input
                    type="number"
                    min="0"
                    style={inputStyle}
                    value={sharedDraft.deliveryCharge}
                    onChange={(e) => {
                      updateDraft({ deliveryCharge: e.target.value });
                      recalcChannelPrices(sharedDraft.deliveryChargeType, Number(e.target.value));
                    }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>반품배송비 (원)</label>
                  <input
                    type="number"
                    min="0"
                    style={inputStyle}
                    value={sharedDraft.returnCharge}
                    onChange={(e) => updateDraft({ returnCharge: e.target.value })}
                  />
                </div>
              </div>

              {/* 태그 */}
              <div>
                <label style={labelStyle}>태그 (쉼표 구분, 클릭으로 추가/제거)</label>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag(tagInput);
                      }
                    }}
                    placeholder="예: 등산가방, 백팩, 경량 (Enter 또는 추가 버튼)"
                  />
                  <button
                    type="button"
                    onClick={() => addTag(tagInput)}
                    style={{
                      padding: '9px 16px',
                      fontSize: '12px',
                      fontWeight: 600,
                      backgroundColor: C.btnSecondaryBg,
                      color: C.btnSecondaryText,
                      border: `1px solid ${C.border}`,
                      borderRadius: '8px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    추가
                  </button>
                </div>
                {sharedDraft.tags.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {sharedDraft.tags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => removeTag(tag)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '4px 10px',
                          fontSize: '12px',
                          fontWeight: 500,
                          backgroundColor: 'rgba(190,0,20,0.07)',
                          color: C.accent,
                          border: '1px solid rgba(190,0,20,0.15)',
                          borderRadius: '100px',
                          cursor: 'pointer',
                        }}
                      >
                        {tag}
                        <X size={10} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── 플랫폼별 설정 섹션 ───────────────────────────────── */}
          <Divider label={platform === 'coupang' ? '쿠팡 설정' : platform === 'naver' ? '네이버 설정' : '플랫폼별 설정'} />

          {/* 카테고리 패널 — 선택한 플랫폼만 표시 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: needCoupang && needNaver ? '1fr 1fr' : '1fr',
              gap: '16px',
              alignItems: 'start',
            }}
          >
            {/* ── 쿠팡 카테고리 패널 ─────────────────────────────── */}
            {needCoupang && <div>
              <div
                style={{
                  ...sectionHeaderStyle,
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    color: '#fff',
                    backgroundColor: '#be0014',
                    padding: '2px 7px',
                    borderRadius: '4px',
                  }}
                >
                  쿠팡
                </span>
                카테고리
                {errors.coupangCategory && (
                  <span style={{ fontSize: '11px', color: '#b91c1c', fontWeight: 400 }}>
                    — {errors.coupangCategory}
                  </span>
                )}
              </div>

              {/* 확인 모드 vs 검색 모드 */}
              {coupangCategoryCode && !showCoupangCatSearch ? (
                /* 확인 모드: 선택된 카테고리 표시 + 변경 버튼 */
                <div
                  style={{
                    fontSize: '12px',
                    color: C.accent,
                    marginBottom: '8px',
                    padding: '8px 12px',
                    backgroundColor: 'rgba(190,0,20,0.05)',
                    borderRadius: '6px',
                    border: '1px solid rgba(190,0,20,0.1)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '8px',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '2px' }}>Step 2에서 선택됨</div>
                    <div style={{ lineHeight: 1.4 }}>{coupangCategoryPath}</div>
                    <div style={{ fontSize: '10px', fontFamily: 'monospace', color: C.textSub, marginTop: '2px' }}>
                      ({coupangCategoryCode})
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCoupangCatSearch(true)}
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: C.textSub,
                      background: 'none',
                      border: `1px solid ${C.border}`,
                      borderRadius: '6px',
                      padding: '3px 10px',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    변경
                  </button>
                </div>
              ) : (
                /* 검색 모드 */
                <>
                  {/* 선택된 카테고리 표시 (검색 중에도 현재 선택 유지 표시) */}
                  {coupangCategoryCode && (
                    <div
                      style={{
                        fontSize: '12px',
                        color: C.accent,
                        marginBottom: '8px',
                        padding: '8px 12px',
                        backgroundColor: 'rgba(190,0,20,0.05)',
                        borderRadius: '6px',
                        border: '1px solid rgba(190,0,20,0.1)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '8px',
                      }}
                    >
                      <span style={{ lineHeight: 1.4 }}>{coupangCategoryPath}</span>
                      <span style={{ fontSize: '10px', fontFamily: 'monospace', color: C.textSub, flexShrink: 0 }}>
                        ({coupangCategoryCode})
                      </span>
                    </div>
                  )}

                  {/* 카테고리 키워드 검색 입력 */}
                  <div style={{ position: 'relative', marginBottom: '8px' }}>
                    <input
                      style={inputStyle}
                      value={categoryKeyword}
                      onChange={(e) => {
                        setCategoryKeyword(e.target.value);
                        searchCategories(e.target.value);
                      }}
                      placeholder="카테고리 키워드 검색 (예: 고데기)"
                    />
                    {isCategorySearching && (
                      <span
                        style={{
                          position: 'absolute',
                          right: '12px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '11px',
                          color: C.textSub,
                        }}
                      >
                        <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                        검색 중...
                      </span>
                    )}
                  </div>

                  {/* 쿠팡 검색 결과 */}
                  {coupangResults.length > 0 && (
                    <div
                      style={{
                        border: `1px solid ${C.border}`,
                        borderRadius: '8px',
                        backgroundColor: '#fff',
                        overflow: 'hidden',
                        marginBottom: '8px',
                      }}
                    >
                      {coupangResults.map((item) => {
                        const isSelected = String(item.code) === coupangCategoryCode;
                        return (
                          <div
                            key={item.code}
                            onClick={() => {
                              setCoupangCategoryCode(String(item.code));
                              setCoupangCategoryPath(item.path);
                              updateSharedDraft({ coupangCategoryCode: String(item.code), coupangCategoryPath: item.path });
                              if (errors.coupangCategory)
                                setErrors((prev) => ({ ...prev, coupangCategory: '' }));
                              setShowCoupangCatSearch(false);
                            }}
                            style={{
                              padding: '10px 14px',
                              cursor: 'pointer',
                              borderBottom: `1px solid ${C.border}`,
                              fontSize: '12px',
                              backgroundColor: isSelected ? 'rgba(190,0,20,0.04)' : '#fff',
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '8px',
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected)
                                (e.currentTarget as HTMLDivElement).style.backgroundColor = C.tableHeader;
                            }}
                            onMouseLeave={(e) => {
                              if (!isSelected)
                                (e.currentTarget as HTMLDivElement).style.backgroundColor = '#fff';
                            }}
                          >
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, color: isSelected ? C.accent : C.text, marginBottom: '2px' }}>
                                {item.name}
                              </div>
                              <div style={{ color: C.textSub, fontSize: '11px', lineHeight: 1.4 }}>
                                {item.path}
                              </div>
                            </div>
                            {isSelected && (
                              <Check size={14} style={{ color: C.accent, flexShrink: 0, marginTop: '2px' }} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {categoryKeyword && !isCategorySearching && coupangResults.length === 0 && (
                    <div style={{ fontSize: '12px', color: C.textSub, padding: '8px', textAlign: 'center' }}>
                      검색 결과가 없습니다.
                    </div>
                  )}

                  {/* 이미 카테고리가 선택된 경우 취소 버튼 */}
                  {coupangCategoryCode && (
                    <button
                      type="button"
                      onClick={() => setShowCoupangCatSearch(false)}
                      style={{
                        fontSize: '11px',
                        color: C.textSub,
                        background: 'none',
                        border: `1px solid ${C.border}`,
                        borderRadius: '6px',
                        padding: '4px 10px',
                        cursor: 'pointer',
                        marginTop: '4px',
                      }}
                    >
                      취소
                    </button>
                  )}
                </>
              )}

              {/* 브랜드명 (쿠팡 전용) */}
              <div style={{ marginTop: '12px' }}>
                <label style={labelStyle}>브랜드명 (쿠팡 전용)</label>
                <input
                  style={inputStyle}
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  placeholder="브랜드명 (없으면 비워두세요)"
                />
              </div>
            </div>}

            {/* ── 네이버 카테고리 패널 ───────────────────────────── */}
            {needNaver && <div>
              <div
                style={{
                  ...sectionHeaderStyle,
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    color: '#fff',
                    backgroundColor: '#03c75a',
                    padding: '2px 7px',
                    borderRadius: '4px',
                  }}
                >
                  네이버
                </span>
                카테고리
                {errors.naverCategory && (
                  <span style={{ fontSize: '11px', color: '#b91c1c', fontWeight: 400 }}>
                    — {errors.naverCategory}
                  </span>
                )}
              </div>

              {/* 확인 모드 vs 검색 모드 */}
              {naverCategoryId && !showNaverCatSearch ? (
                /* 확인 모드: 선택된 카테고리 표시 + 변경 버튼 */
                <div
                  style={{
                    fontSize: '12px',
                    color: '#03c75a',
                    marginBottom: '8px',
                    padding: '8px 12px',
                    backgroundColor: 'rgba(3,199,90,0.05)',
                    borderRadius: '6px',
                    border: '1px solid rgba(3,199,90,0.15)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '8px',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '2px' }}>Step 2에서 선택됨</div>
                    <div style={{ lineHeight: 1.4 }}>{naverCategoryPath}</div>
                    <div style={{ fontSize: '10px', fontFamily: 'monospace', color: C.textSub, marginTop: '2px' }}>
                      ({naverCategoryId})
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowNaverCatSearch(true)}
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: C.textSub,
                      background: 'none',
                      border: `1px solid ${C.border}`,
                      borderRadius: '6px',
                      padding: '3px 10px',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    변경
                  </button>
                </div>
              ) : (
                /* 검색 모드 */
                <>
                  {/* 선택된 카테고리 표시 (검색 중에도 현재 선택 유지 표시) */}
                  {naverCategoryId && (
                    <div
                      style={{
                        fontSize: '12px',
                        color: '#03c75a',
                        marginBottom: '8px',
                        padding: '8px 12px',
                        backgroundColor: 'rgba(3,199,90,0.05)',
                        borderRadius: '6px',
                        border: '1px solid rgba(3,199,90,0.15)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '8px',
                      }}
                    >
                      <span style={{ lineHeight: 1.4 }}>{naverCategoryPath}</span>
                      <span style={{ fontSize: '10px', fontFamily: 'monospace', color: C.textSub, flexShrink: 0 }}>
                        ({naverCategoryId})
                      </span>
                    </div>
                  )}

                  {/* 카테고리 키워드 검색 입력 */}
                  <div style={{ position: 'relative', marginBottom: '8px' }}>
                    <input
                      style={inputStyle}
                      value={categoryKeyword}
                      onChange={(e) => {
                        setCategoryKeyword(e.target.value);
                        searchCategories(e.target.value);
                      }}
                      placeholder="카테고리 키워드 검색 (예: 고데기)"
                    />
                    {isCategorySearching && (
                      <span
                        style={{
                          position: 'absolute',
                          right: '12px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          fontSize: '11px',
                          color: C.textSub,
                        }}
                      >
                        <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                        검색 중...
                      </span>
                    )}
                  </div>

                  {/* 네이버 검색 결과 */}
                  {naverResults.length > 0 && (
                    <div
                      style={{
                        border: `1px solid ${C.border}`,
                        borderRadius: '8px',
                        backgroundColor: '#fff',
                        overflow: 'hidden',
                        marginBottom: '8px',
                      }}
                    >
                      {naverResults.map((item) => {
                        const isSelected = item.id === naverCategoryId;
                        return (
                          <div
                            key={item.id}
                            onClick={() => {
                              setNaverCategoryId(item.id);
                              setNaverCategoryPath(item.path);
                              updateSharedDraft({ naverCategoryId: item.id, naverCategoryPath: item.path });
                              if (errors.naverCategory)
                                setErrors((prev) => ({ ...prev, naverCategory: '' }));
                              setShowNaverCatSearch(false);
                            }}
                            style={{
                              padding: '10px 14px',
                              cursor: 'pointer',
                              borderBottom: `1px solid ${C.border}`,
                              fontSize: '12px',
                              backgroundColor: isSelected ? 'rgba(3,199,90,0.04)' : '#fff',
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '8px',
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected)
                                (e.currentTarget as HTMLDivElement).style.backgroundColor = C.tableHeader;
                            }}
                            onMouseLeave={(e) => {
                              if (!isSelected)
                                (e.currentTarget as HTMLDivElement).style.backgroundColor = '#fff';
                            }}
                          >
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, color: isSelected ? '#03c75a' : C.text, marginBottom: '2px' }}>
                                {item.name}
                              </div>
                              <div style={{ color: C.textSub, fontSize: '11px', lineHeight: 1.4 }}>
                                {item.path}
                              </div>
                            </div>
                            {isSelected && (
                              <Check size={14} style={{ color: '#03c75a', flexShrink: 0, marginTop: '2px' }} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {categoryKeyword && !isCategorySearching && naverResults.length === 0 && (
                    <div style={{ fontSize: '12px', color: C.textSub, padding: '8px', textAlign: 'center' }}>
                      검색 결과가 없습니다.
                    </div>
                  )}

                  {/* 이미 카테고리가 선택된 경우 취소 버튼 */}
                  {naverCategoryId && (
                    <button
                      type="button"
                      onClick={() => setShowNaverCatSearch(false)}
                      style={{
                        fontSize: '11px',
                        color: C.textSub,
                        background: 'none',
                        border: `1px solid ${C.border}`,
                        borderRadius: '6px',
                        padding: '4px 10px',
                        cursor: 'pointer',
                        marginTop: '4px',
                      }}
                    >
                      취소
                    </button>
                  )}
                </>
              )}

              {/* 교환배송비 (네이버 전용) */}
              <div style={{ marginTop: '12px' }}>
                <label style={labelStyle}>교환배송비 (네이버 전용, 원)</label>
                <input
                  type="number"
                  min="0"
                  style={inputStyle}
                  value={naverExchangeFee}
                  onChange={(e) => setNaverExchangeFee(e.target.value)}
                />
              </div>
            </div>}
          </div>

          {/* ── 등록 결과 표시 ───────────────────────────────────── */}
          {isDone && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '16px',
                backgroundColor: C.card,
                borderRadius: '10px',
                border: `1px solid ${C.border}`,
              }}
            >
              <div style={{ ...sectionHeaderStyle, marginBottom: '4px' }}>등록 결과</div>

              {/* 쿠팡 결과 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  backgroundColor:
                    bothRegistration.coupang.status === 'success'
                      ? 'rgba(21,128,61,0.06)'
                      : bothRegistration.coupang.status === 'error'
                        ? '#fee2e2'
                        : C.tableHeader,
                }}
              >
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    color: '#fff',
                    backgroundColor: '#be0014',
                    padding: '2px 7px',
                    borderRadius: '4px',
                    flexShrink: 0,
                  }}
                >
                  쿠팡
                </span>
                {bothRegistration.coupang.status === 'success' && (
                  <span style={{ fontSize: '13px', color: '#15803d' }}>
                    ✅ 등록 완료 — 상품번호{' '}
                    <strong>{bothRegistration.coupang.sellerProductId}</strong>
                  </span>
                )}
                {bothRegistration.coupang.status === 'error' && (
                  <span style={{ fontSize: '13px', color: '#b91c1c' }}>
                    ❌ 실패 — {bothRegistration.coupang.error}
                  </span>
                )}
                {bothRegistration.coupang.status === 'loading' && (
                  <span style={{ fontSize: '13px', color: C.textSub, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Loader2 size={13} />
                    등록 중...
                  </span>
                )}
              </div>

              {/* 네이버 결과 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  backgroundColor:
                    bothRegistration.naver.status === 'success'
                      ? 'rgba(21,128,61,0.06)'
                      : bothRegistration.naver.status === 'error'
                        ? '#fee2e2'
                        : bothRegistration.naver.status === 'draft'
                          ? 'rgba(234,179,8,0.08)'
                          : C.tableHeader,
                }}
              >
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    color: '#fff',
                    backgroundColor: '#03c75a',
                    padding: '2px 7px',
                    borderRadius: '4px',
                    flexShrink: 0,
                  }}
                >
                  네이버
                </span>
                {bothRegistration.naver.status === 'success' && (
                  <span style={{ fontSize: '13px', color: '#15803d' }}>
                    ✅ 등록 완료 — 원상품번호{' '}
                    <strong>{bothRegistration.naver.originProductNo}</strong>
                    {bothRegistration.naver.channelProductNo && (
                      <span style={{ color: C.textSub, fontWeight: 400 }}>
                        {' '}/ 채널{' '}
                        <strong style={{ color: '#15803d' }}>{bothRegistration.naver.channelProductNo}</strong>
                      </span>
                    )}
                  </span>
                )}
                {bothRegistration.naver.status === 'draft' && (
                  <span style={{ fontSize: '13px', color: '#92400e' }}>
                    ⚠️ 임시저장 완료 — 카테고리 판매 권한 필요. 스마트스토어센터에서 권한 신청 후 수기 등록해주세요.
                    {bothRegistration.naver.draftId && (
                      <span style={{ color: C.textSub, fontSize: '11px', display: 'block', marginTop: '2px' }}>
                        임시저장 ID: {bothRegistration.naver.draftId}
                      </span>
                    )}
                  </span>
                )}
                {bothRegistration.naver.status === 'error' && (
                  <span style={{ fontSize: '13px', color: '#b91c1c' }}>
                    ❌ 실패 — {bothRegistration.naver.error}
                  </span>
                )}
                {bothRegistration.naver.status === 'loading' && (
                  <span style={{ fontSize: '13px', color: C.textSub, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Loader2 size={13} />
                    등록 중...
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ── 하단 버튼 ─────────────────────────────────────────── */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
              paddingTop: '16px',
              borderTop: `1px solid ${C.border}`,
            }}
          >
            <button
              type="button"
              onClick={handleCancel}
              style={{
                padding: '10px 24px',
                fontSize: '13px',
                fontWeight: 600,
                backgroundColor: C.btnSecondaryBg,
                color: C.btnSecondaryText,
                border: `1px solid ${C.border}`,
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              취소
            </button>
            <button
              type="button"
              onClick={handlePreview}
              disabled={isPreviewing || isRegistering}
              style={{
                padding: '10px 24px',
                fontSize: '13px',
                fontWeight: 600,
                backgroundColor: isPreviewing ? '#d4d4d8' : '#f0f0f0',
                color: '#333',
                border: `1px solid ${C.border}`,
                borderRadius: '8px',
                cursor: (isPreviewing || isRegistering) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {isPreviewing ? (
                <>
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  확인 중...
                </>
              ) : (
                '등록 정보 확인'
              )}
            </button>
            <button
              type="submit"
              disabled={isRegistering}
              style={{
                padding: '10px 32px',
                fontSize: '13px',
                fontWeight: 600,
                backgroundColor: isRegistering ? '#d4d4d8' : C.btnPrimaryBg,
                color: C.btnPrimaryText,
                border: 'none',
                borderRadius: '8px',
                cursor: isRegistering ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {isRegistering ? (
                <>
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                  등록 중...
                </>
              ) : (
                platform === 'coupang' ? '쿠팡 등록' : platform === 'naver' ? '네이버 등록' : '쿠팡+네이버 동시 등록'
              )}
            </button>
          </div>
        </div>
      </form>

      {/* ── 등록 정보 확인 — 사람이 읽을 수 있는 요약 ─────────────── */}
      {previewData && (
        <div style={{ padding: '16px 24px', borderTop: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontSize: '14px', fontWeight: 700, color: C.text }}>등록 전 확인</span>
            <button
              type="button"
              onClick={() => setPreviewData(null)}
              style={{ fontSize: '12px', color: C.textSub, background: 'none', border: 'none', cursor: 'pointer' }}
            >
              닫기
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {(['coupang', 'naver'] as const).map((platform) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const p = previewData[platform] as any;
              if (!p) return null;
              const isNaverDraft = platform === 'naver';
              const price = platform === 'coupang' ? p?.items?.[0]?.salePrice ?? p?.salePrice : p?.salePrice ?? p?.price;
              const category = platform === 'coupang'
                ? coupangCategoryPath || p?.displayCategoryCode
                : naverCategoryPath || p?.leafCategoryId;
              const imageCount = sharedDraft.thumbnailImages.length + sharedDraft.detailImages.length;
              return (
                <div key={platform} style={{
                  borderRadius: '10px', border: `1px solid ${C.border}`,
                  padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px',
                  backgroundColor: '#fff',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{
                      fontSize: '10px', fontWeight: 700, color: '#fff',
                      backgroundColor: platform === 'coupang' ? '#be0014' : '#03c75a',
                      padding: '2px 7px', borderRadius: '4px',
                    }}>
                      {platform === 'coupang' ? '쿠팡' : '네이버'}
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>등록 예정 정보</span>
                  </div>

                  {/* 썸네일 + 상품명 */}
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    {sharedDraft.thumbnailImages[0] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sharedDraft.thumbnailImages[0]} alt="" style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0, border: `1px solid ${C.border}` }} />
                    )}
                    <p style={{ fontSize: '12px', color: C.text, fontWeight: 600, margin: 0, lineHeight: 1.5 }}>
                      {sharedDraft.name || '—'}
                    </p>
                  </div>

                  {/* 카테고리 */}
                  <div style={{ fontSize: '11px', color: C.textSub }}>
                    <span style={{ fontWeight: 600, color: C.text }}>카테고리 </span>
                    {category || '미선택'}
                  </div>

                  {/* 가격 */}
                  <div style={{ fontSize: '11px', color: C.textSub }}>
                    <span style={{ fontWeight: 600, color: C.text }}>판매가 </span>
                    {price ? `${Number(price).toLocaleString()}원` : '—'}
                    {isNaverDraft && (
                      <span style={{ marginLeft: '6px', color: '#92400e', fontWeight: 600 }}>(임시저장)</span>
                    )}
                  </div>

                  {/* 이미지 수 */}
                  <div style={{ fontSize: '11px', color: C.textSub }}>
                    <span style={{ fontWeight: 600, color: C.text }}>이미지 수 </span>
                    썸네일 {sharedDraft.thumbnailImages.length}장
                    {sharedDraft.detailImages.length > 0 && ` + 상세 ${sharedDraft.detailImages.length}장`}
                    {' '}(합계 {imageCount}장)
                  </div>

                  {/* 배송비 */}
                  <div style={{ fontSize: '11px', color: C.textSub }}>
                    <span style={{ fontWeight: 600, color: C.text }}>배송비 </span>
                    {sharedDraft.deliveryChargeType === 'FREE' ? '무료배송' :
                     sharedDraft.deliveryChargeType === 'CHARGE_RECEIVED' ? '착불' :
                     `${Number(sharedDraft.deliveryCharge).toLocaleString()}원`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 스피너 키프레임 */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
