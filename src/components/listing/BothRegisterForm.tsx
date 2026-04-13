'use client';

/**
 * BothRegisterForm.tsx
 * 쿠팡 + 네이버 동시 등록 폼 컴포넌트
 *
 * - sharedDraft 연동으로 폼 닫았다 열어도 입력값 유지
 * - 카테고리 검색: 키워드 1개로 쿠팡/네이버 API 병렬 호출
 * - 등록 완료 후 쿠팡/네이버 각각 결과 표시
 */

import React, { useState, useRef, useCallback } from 'react';
import { X, Check, Loader2 } from 'lucide-react';
import { useListingStore } from '@/store/useListingStore';
import ImageInputSection from './ImageInputSection';

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
  thumbnailUrl: string;     // 가공된 대표이미지 URL
  detailHtml: string;       // 가공된 상세 HTML
  title: string;            // 상품명
}

interface BothRegisterFormProps {
  onClose: () => void;
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
export default function BothRegisterForm({ onClose, prefill }: BothRegisterFormProps) {
  const { sharedDraft, updateSharedDraft, bothRegistration, registerBothProducts, resetBothRegistration } =
    useListingStore();

  // 도매꾹 데이터 자동 채우기 (마운트 시 1회)
  const prefillApplied = useRef(false);
  React.useEffect(() => {
    if (prefill && !prefillApplied.current) {
      prefillApplied.current = true;
      updateSharedDraft({
        name: prefill.title,
        thumbnailImages: [prefill.thumbnailUrl],
        description: prefill.detailHtml,
      });
    }
  }, [prefill, updateSharedDraft]);

  // ─── 플랫폼별 전용 상태 ─────────────────────────────────────────────────
  const [coupangCategoryCode, setCoupangCategoryCode] = useState('');
  const [coupangCategoryPath, setCoupangCategoryPath] = useState('');
  const [naverCategoryId, setNaverCategoryId] = useState('');
  const [naverCategoryPath, setNaverCategoryPath] = useState('');
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

  // ─── 폼 검증 에러 ────────────────────────────────────────────────────────
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ─── 등록 완료 여부 ──────────────────────────────────────────────────────
  const isDone =
    bothRegistration.coupang.status === 'success' ||
    bothRegistration.coupang.status === 'error' ||
    bothRegistration.naver.status === 'success' ||
    bothRegistration.naver.status === 'error';

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

  // ─── 검증 ────────────────────────────────────────────────────────────────
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!sharedDraft.name.trim()) newErrors.name = '상품명을 입력해 주세요.';
    // 공통 판매가 또는 채널별 판매가 중 하나 이상 입력 필요
    const hasCoupangPrice = sharedDraft.coupangPrice && Number(sharedDraft.coupangPrice) > 0;
    const hasNaverPrice = sharedDraft.naverPrice && Number(sharedDraft.naverPrice) > 0;
    const hasCommonPrice = sharedDraft.salePrice && Number(sharedDraft.salePrice) > 0;
    if (!hasCommonPrice && !hasCoupangPrice && !hasNaverPrice)
      newErrors.salePrice = '공통 판매가 또는 채널별 판매가를 1개 이상 입력해 주세요.';
    if (thumbnailImageUrls.length === 0) newErrors.images = '썸네일 이미지 URL을 1개 이상 입력해 주세요.';
    if (!sharedDraft.description.trim()) newErrors.description = '상세설명을 입력해 주세요.';
    if (!coupangCategoryCode) newErrors.coupangCategory = '쿠팡 카테고리를 선택해 주세요.';
    if (!naverCategoryId) newErrors.naverCategory = '네이버 카테고리를 선택해 주세요.';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // ─── 등록 실행 ───────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetBothRegistration();

    if (!validate()) return;

    await registerBothProducts({
      name: sharedDraft.name.trim(),
      salePrice: Number(sharedDraft.salePrice) || 100, // 채널별 가격만 입력 시 최소값 placeholder
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
      coupang: {
        displayCategoryCode: Number(coupangCategoryCode),
        brand: brand.trim() || undefined,
      },
      naver: {
        leafCategoryId: naverCategoryId,
        tags: sharedDraft.tags.length > 0 ? sharedDraft.tags : undefined,
        exchangeFee: naverExchangeFee ? Number(naverExchangeFee) : undefined,
      },
    });
  };

  // ─── 닫기 핸들러 ─────────────────────────────────────────────────────────
  const handleClose = () => {
    resetBothRegistration();
    onClose();
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
          onClick={handleClose}
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
                <input
                  style={{
                    ...inputStyle,
                    borderColor: errors.name ? '#b91c1c' : C.border,
                  }}
                  value={sharedDraft.name}
                  onChange={(e) => {
                    updateDraft({ name: e.target.value });
                    if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
                  }}
                  placeholder="상품명을 입력하세요"
                />
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

              {/* 상세설명 */}
              <div>
                <label style={labelStyle}>
                  상세설명 (HTML) <span style={{ color: C.accent }}>*</span>
                </label>
                <textarea
                  style={{
                    ...inputStyle,
                    minHeight: '120px',
                    resize: 'vertical',
                    borderColor: errors.description ? '#b91c1c' : C.border,
                  }}
                  value={sharedDraft.description}
                  onChange={(e) => {
                    updateDraft({ description: e.target.value });
                    if (errors.description) setErrors((prev) => ({ ...prev, description: '' }));
                  }}
                  placeholder="상품 상세 설명을 입력하세요 (HTML 지원)"
                />
                <FieldError message={errors.description} />
              </div>

              {/* 배송 정보 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={labelStyle}>배송비 유형</label>
                  <select
                    style={inputStyle}
                    value={sharedDraft.deliveryChargeType}
                    onChange={(e) =>
                      updateDraft({
                        deliveryChargeType: e.target.value as
                          | 'FREE'
                          | 'NOT_FREE'
                          | 'CHARGE_RECEIVED',
                      })
                    }
                  >
                    <option value="FREE">무료배송</option>
                    <option value="NOT_FREE">유료배송</option>
                    <option value="CHARGE_RECEIVED">착불</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>배송비 (원)</label>
                  <input
                    type="number"
                    min="0"
                    style={inputStyle}
                    value={sharedDraft.deliveryCharge}
                    onChange={(e) => updateDraft({ deliveryCharge: e.target.value })}
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
          <Divider label="플랫폼별 설정" />

          {/* 카테고리 검색창 (공통 키워드) */}
          <div>
            <label style={labelStyle}>카테고리 키워드 검색</label>
            <div style={{ position: 'relative' }}>
              <input
                style={inputStyle}
                value={categoryKeyword}
                onChange={(e) => {
                  setCategoryKeyword(e.target.value);
                  searchCategories(e.target.value);
                }}
                placeholder="키워드 입력 시 쿠팡·네이버 카테고리를 동시에 검색합니다 (예: 고데기)"
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
                  <Loader2
                    size={12}
                    style={{
                      animation: 'spin 1s linear infinite',
                    }}
                  />
                  검색 중...
                </span>
              )}
            </div>
          </div>

          {/* 카테고리 패널 2컬럼 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '16px',
              alignItems: 'start',
            }}
          >
            {/* 쿠팡 카테고리 패널 */}
            <div>
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

              {/* 선택된 카테고리 표시 */}
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
                  <span
                    style={{
                      fontSize: '10px',
                      fontFamily: 'monospace',
                      color: C.textSub,
                      flexShrink: 0,
                    }}
                  >
                    ({coupangCategoryCode})
                  </span>
                </div>
              )}

              {/* 쿠팡 검색 결과 */}
              {coupangResults.length > 0 && (
                <div
                  style={{
                    border: `1px solid ${C.border}`,
                    borderRadius: '8px',
                    backgroundColor: '#fff',
                    overflow: 'hidden',
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
                          if (errors.coupangCategory)
                            setErrors((prev) => ({ ...prev, coupangCategory: '' }));
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
                            (e.currentTarget as HTMLDivElement).style.backgroundColor =
                              C.tableHeader;
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected)
                            (e.currentTarget as HTMLDivElement).style.backgroundColor = '#fff';
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              fontWeight: 600,
                              color: isSelected ? C.accent : C.text,
                              marginBottom: '2px',
                            }}
                          >
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
                <div
                  style={{
                    fontSize: '12px',
                    color: C.textSub,
                    padding: '8px',
                    textAlign: 'center',
                  }}
                >
                  검색 결과가 없습니다.
                </div>
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
            </div>

            {/* 네이버 카테고리 패널 */}
            <div>
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

              {/* 선택된 카테고리 표시 */}
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
                  <span
                    style={{
                      fontSize: '10px',
                      fontFamily: 'monospace',
                      color: C.textSub,
                      flexShrink: 0,
                    }}
                  >
                    ({naverCategoryId})
                  </span>
                </div>
              )}

              {/* 네이버 검색 결과 */}
              {naverResults.length > 0 && (
                <div
                  style={{
                    border: `1px solid ${C.border}`,
                    borderRadius: '8px',
                    backgroundColor: '#fff',
                    overflow: 'hidden',
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
                          if (errors.naverCategory)
                            setErrors((prev) => ({ ...prev, naverCategory: '' }));
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
                            (e.currentTarget as HTMLDivElement).style.backgroundColor =
                              C.tableHeader;
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected)
                            (e.currentTarget as HTMLDivElement).style.backgroundColor = '#fff';
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              fontWeight: 600,
                              color: isSelected ? '#03c75a' : C.text,
                              marginBottom: '2px',
                            }}
                          >
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
                <div
                  style={{
                    fontSize: '12px',
                    color: C.textSub,
                    padding: '8px',
                    textAlign: 'center',
                  }}
                >
                  검색 결과가 없습니다.
                </div>
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
            </div>
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
                  <span
                    style={{
                      fontSize: '13px',
                      color: C.textSub,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
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
                        {' '}
                        / 채널{' '}
                        <strong style={{ color: '#15803d' }}>
                          {bothRegistration.naver.channelProductNo}
                        </strong>
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
                  <span
                    style={{
                      fontSize: '13px',
                      color: C.textSub,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
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
              onClick={handleClose}
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
                '쿠팡+네이버 동시 등록'
              )}
            </button>
          </div>
        </div>
      </form>

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
