# Step3 쿠팡 자동등록 패널 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/listing/auto-register` 페이지의 쿠팡 등록 폼을 Step3 우측 패널 컴포넌트로 추출하여, URL 파싱(Step1) → 이미지 분류(Step2) → 쿠팡 등록(Step3)이 하나의 워크플로우로 연결되도록 한다.

**Architecture:** `CoupangAutoRegisterPanel` 컴포넌트를 신규 생성한다. 이 컴포넌트는 `sharedDraft`(useListingStore)에서 초기값(상품명·가격·이미지·태그·카테고리)을 읽어 자체 로컬 state를 초기화하고, 마운트 시 `/api/auto-register/ai-map`을 호출해 AI 필드 매핑을 실행한다. 폼 제출은 기존 auto-register 페이지와 동일한 draft save → submit 플로우(`/api/listing/coupang/drafts` → `…/submit`)를 따른다. `RegisterFormSections`는 Step3 우측 패널에서 `CoupangAutoRegisterPanel`로 교체된다.

**Tech Stack:** React 18 (hooks), Zustand (useListingStore), TypeScript, `/api/auto-register/ai-map`, `/api/listing/coupang/drafts`, `/api/listing/coupang/drafts/[id]/submit`, `resolveCoupangFee`, `calcCoupangWing`, Vitest + React Testing Library

---

## 파일 구조

| 파일 | 변경 |
|------|------|
| `src/components/listing/workflow/CoupangAutoRegisterPanel.tsx` | **신규 생성** — Step3 우측 패널 컴포넌트 |
| `src/__tests__/components/CoupangAutoRegisterPanel.test.tsx` | **신규 생성** — 컴포넌트 통합 테스트 |
| `src/components/listing/workflow/Step3ReviewRegister.tsx` | **수정** — 우측 패널을 새 컴포넌트로 교체 |

---

## Task 1: `buildDraftData` 순수 함수 + 테스트

**파일:**
- Create: `src/components/listing/workflow/CoupangAutoRegisterPanel.tsx` (함수만)
- Create: `src/__tests__/components/CoupangAutoRegisterPanel.test.tsx`

로컬 state → draft API payload 변환 로직을 순수 함수로 분리해 테스트 가능하게 만든다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/components/CoupangAutoRegisterPanel.test.tsx`:

```typescript
import { buildDraftData } from '@/components/listing/workflow/CoupangAutoRegisterPanel';

describe('buildDraftData', () => {
  it('필수 필드를 올바르게 매핑한다', () => {
    const result = buildDraftData({
      name: '테스트 상품',
      categoryCode: '78780',
      brand: '기타',
      manufacturer: '',
      salePrice: 15000,
      originalPrice: 20000,
      stock: 100,
      thumbnail: 'https://example.com/img.jpg',
      detailHtml: '<p>상세</p>',
      deliveryChargeType: 'FREE',
      deliveryCharge: 0,
      outboundCode: 'ABC123',
      returnCode: 'DEF456',
      notices: [{ categoryName: '의류', detailName: '제조국', content: '대한민국' }],
      tags: ['태그1', '태그2'],
      detailImages: [],
    });

    expect(result.name).toBe('테스트 상품');
    expect(result.categoryCode).toBe('78780');
    expect(result.brand).toBe('기타');
    expect(result.salePrice).toBe(15000);
    expect(result.originalPrice).toBe(20000);
    expect(result.stock).toBe(100);
    expect(result.thumbnail).toBe('https://example.com/img.jpg');
    expect(result.deliveryChargeType).toBe('FREE');
    expect(result.notices).toHaveLength(1);
    expect(result.tags).toEqual(['태그1', '태그2']);
  });

  it('originalPrice가 salePrice보다 작으면 salePrice × 1.25로 보정한다', () => {
    const result = buildDraftData({
      name: '상품',
      categoryCode: '1',
      brand: '',
      manufacturer: '',
      salePrice: 10000,
      originalPrice: 5000, // salePrice보다 작음
      stock: 50,
      thumbnail: '',
      detailHtml: '',
      deliveryChargeType: 'FREE',
      deliveryCharge: 0,
      outboundCode: '',
      returnCode: '',
      notices: [],
      tags: [],
      detailImages: [],
    });

    expect(result.originalPrice).toBe(13000); // ceil(10000 * 1.25 / 1000) * 1000
  });

  it('thumbnail이 없으면 detailImages 첫 번째를 폴백으로 사용한다', () => {
    const result = buildDraftData({
      name: '상품',
      categoryCode: '1',
      brand: '',
      manufacturer: '',
      salePrice: 10000,
      originalPrice: 12000,
      stock: 50,
      thumbnail: '', // 없음
      detailHtml: '',
      deliveryChargeType: 'FREE',
      deliveryCharge: 0,
      outboundCode: '',
      returnCode: '',
      notices: [],
      tags: [],
      detailImages: ['https://example.com/detail.jpg'],
    });

    expect(result.thumbnail).toBe('https://example.com/detail.jpg');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio
npx vitest run src/__tests__/components/CoupangAutoRegisterPanel.test.tsx
```

Expected: FAIL — "Cannot find module"

- [ ] **Step 3: `buildDraftData` 구현**

`src/components/listing/workflow/CoupangAutoRegisterPanel.tsx` (함수만, 컴포넌트는 다음 Task):

```typescript
'use client';

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
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/components/CoupangAutoRegisterPanel.test.tsx
```

Expected: PASS 3 tests

- [ ] **Step 5: 커밋**

```bash
git add src/components/listing/workflow/CoupangAutoRegisterPanel.tsx \
        src/__tests__/components/CoupangAutoRegisterPanel.test.tsx
git commit -m "feat(coupang-panel): buildDraftData 순수 함수 + 단위 테스트"
```

---

## Task 2: 컴포넌트 — state 초기화 + AI 매핑

**파일:**
- Modify: `src/components/listing/workflow/CoupangAutoRegisterPanel.tsx`
- Modify: `src/__tests__/components/CoupangAutoRegisterPanel.test.tsx`

`sharedDraft`에서 초기값을 읽고, 마운트 시 AI 매핑과 배송 기본값을 비동기로 로드하는 훅 로직을 추가한다. 아직 JSX는 작성하지 않는다.

- [ ] **Step 1: 실패하는 테스트 추가**

`src/__tests__/components/CoupangAutoRegisterPanel.test.tsx`에 다음을 추가:

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import CoupangAutoRegisterPanel from '@/components/listing/workflow/CoupangAutoRegisterPanel';

// useListingStore mock
jest.mock('@/store/useListingStore', () => ({
  useListingStore: () => ({
    sharedDraft: {
      name: '도매꾹 상품',
      salePrice: '12000',
      originalPrice: '15000',
      thumbnailImages: ['https://img.domeggook.com/thumb.jpg'],
      detailImages: ['https://img.domeggook.com/detail.jpg'],
      pickedDetailImages: [],
      description: '<p>상세설명</p>',
      tags: ['가전', 'USB'],
      coupangCategoryCode: '',
      coupangCategoryPath: '',
      categoryHint: '생활가전',
      deliveryChargeType: 'FREE',
      deliveryCharge: '0',
      stock: '100',
    },
  }),
}));

// fetch mock
global.fetch = jest.fn();

describe('CoupangAutoRegisterPanel', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('ai-map')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              fields: {
                sellerProductName: { value: '도매꾹 상품 AI', confidence: 0.9 },
                displayCategoryCode: { value: 78780, confidence: 0.7 },
                brand: { value: '기타', confidence: 0.5 },
                salePrice: { value: 12000, confidence: 0.9 },
                originalPrice: { value: 15000, confidence: 0.9 },
                stockQuantity: { value: 100, confidence: 0.9 },
                deliveryChargeType: { value: 'FREE', confidence: 0.9 },
                deliveryCharge: { value: 0, confidence: 0.9 },
                searchTags: { value: ['가전', 'USB'], confidence: 0.8 },
              },
            }),
        });
      }
      if (url.includes('delivery-defaults')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ outboundShippingPlaceCode: 'OUT001', returnCenterCode: 'RET001' }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('마운트 시 AI 매핑과 배송 기본값을 로드한다', async () => {
    render(<CoupangAutoRegisterPanel onSuccess={() => {}} />);

    // AI 매핑 로딩 배너 표시
    expect(screen.getByText(/AI 필드 매핑/)).toBeInTheDocument();

    // 매핑 완료 후 상품명 필드에 값이 채워짐
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('ai-map'),
        expect.any(Object),
      );
    });
  });

  it('sharedDraft.name으로 상품명 input이 초기화된다', async () => {
    render(<CoupangAutoRegisterPanel onSuccess={() => {}} />);
    // AI 매핑 전에도 상품명 input이 sharedDraft.name 값으로 렌더됨
    expect(screen.getByDisplayValue('도매꾹 상품')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/components/CoupangAutoRegisterPanel.test.tsx
```

Expected: FAIL — "CoupangAutoRegisterPanel is not a React component" 또는 유사 오류

- [ ] **Step 3: 컴포넌트 state + 마운트 effect 구현**

`CoupangAutoRegisterPanel.tsx` 파일에 (이전 Task의 buildDraftData 아래에) 추가:

```typescript
import React, { useEffect, useRef, useState } from 'react';
import { useListingStore } from '@/store/useListingStore';
import { resolveCoupangFee } from '@/lib/calculator/coupang-fees';
import { calcCoupangWing } from '@/lib/calculator/calculate';
import type { MappedCoupangFields } from '@/lib/auto-register/types';

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
      source: 'manual' as const,
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

        // AI 추천값 적용 (이미 사용자가 변경하지 않은 필드만)
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
  const certificationRef = useRef<string>('');
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
      detailHtml: sharedDraft.detailPageSnippet || sharedDraft.description || '',
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

  // ── JSX (Task 3에서 구현) ─────────────────────────────────────────────────
  return (
    <div data-testid="coupang-auto-register-panel">
      {isAiMapping && <div>AI 필드 매핑 중...</div>}
      <input
        data-testid="name-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
    </div>
  );
}
```

> **Note:** `sharedDraft.detailPageSnippet`이 useListingStore의 SharedDraft 타입에 있는지 확인한다. 없으면 `sharedDraft.description`만 사용.

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/components/CoupangAutoRegisterPanel.test.tsx
```

Expected: PASS (buildDraftData 3 + 컴포넌트 2 = 5 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/components/listing/workflow/CoupangAutoRegisterPanel.tsx \
        src/__tests__/components/CoupangAutoRegisterPanel.test.tsx
git commit -m "feat(coupang-panel): 컴포넌트 state 초기화 + AI 매핑 마운트 effect"
```

---

## Task 3: 폼 섹션 JSX 구현

**파일:**
- Modify: `src/components/listing/workflow/CoupangAutoRegisterPanel.tsx`

Task 2의 stub JSX를 실제 폼 UI로 교체한다. 섹션: 기본정보, 상품 주요 정보, 가격·재고, 배송·반품, 고시정보, 검색 태그.

- [ ] **Step 1: 폼 JSX로 `return` 블록 교체**

`CoupangAutoRegisterPanel.tsx`의 `return (...)` 전체를 다음으로 교체:

```typescript
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
              const v = e.target.value;
              if (v && /\D/.test(v)) {
                setCategoryCode('');
                setCategorySearch(v);
                setCategoryResults([]);
                doCategorySearch(v);
              } else {
                setCategoryCode(v);
                setCategoryResults([]);
                setCategoryFullPath('');
              }
            }}
            placeholder="숫자 코드 입력 (예: 78780)"
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
            <div style={{ border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden', marginTop: '4px' }}>
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
        {/* 수수료 계산 */}
        {salePrice > 0 && (
          <div style={{ padding: '10px 12px', backgroundColor: '#f8f9fa', border: `1px solid ${C.border}`, borderRadius: '8px', fontSize: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ color: C.textSub }}>
                수수료 ({feeMatch.matched ? feeMatch.categoryName : '기본'}, {(effectiveFeeRate * 100).toFixed(1)}%)
              </span>
              <span style={{ color: '#b91c1c' }}>-{commission.toLocaleString()}원</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${C.border}`, paddingTop: '4px' }}>
              <span style={{ fontWeight: 700, color: C.text }}>예상 수익</span>
              <span style={{ fontWeight: 700, color: calc.netProfit >= 0 ? '#15803d' : '#b91c1c' }}>
                {(salePrice - commission).toLocaleString()}원
              </span>
            </div>
            <div style={{ marginTop: '6px' }}>
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

      {/* ── 섹션 4: 배송·반품 ───────────────────────────────────────────────── */}
      <div style={section}>
        <p style={sectionTitle}>배송 · 반품</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label style={label}>배송비 유형</label>
            <select style={inputStyle} value={deliveryChargeType} onChange={(e) => setDeliveryChargeType(e.target.value as 'FREE' | 'NOT_FREE')}>
              <option value="FREE">무료</option>
              <option value="NOT_FREE">유료</option>
            </select>
          </div>
          {deliveryChargeType === 'NOT_FREE' && (
            <div>
              <label style={label}>배송비 (원)</label>
              <input style={inputStyle} type="number" value={deliveryCharge} onChange={(e) => setDeliveryCharge(Number(e.target.value))} min={0} />
            </div>
          )}
          <div>
            <label style={label}>출하지 코드</label>
            <input style={inputStyle} value={outboundCode} onChange={(e) => setOutboundCode(e.target.value)} placeholder="자동 로드" />
          </div>
          <div>
            <label style={label}>반품센터 코드</label>
            <input style={inputStyle} value={returnCode} onChange={(e) => setReturnCode(e.target.value)} placeholder="자동 로드" />
          </div>
        </div>
      </div>

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
        {notices.length === 0 && !isNoticeFetching && (
          <p style={{ fontSize: '12px', color: C.textSub }}>카테고리 코드를 입력하면 AI가 자동으로 작성합니다.</p>
        )}
        {notices.map((n, i) => (
          <div key={i}>
            <label style={{ ...label, fontSize: '11px' }}>{n.categoryName} › {n.detailName}</label>
            <input
              style={inputStyle}
              value={n.content}
              onChange={(e) => {
                const updated = [...notices];
                updated[i] = { ...updated[i], content: e.target.value };
                setNotices(updated);
              }}
              placeholder="직접 입력하거나 AI 생성 값을 수정하세요"
            />
          </div>
        ))}
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
          <div style={{ padding: '10px 14px', backgroundColor: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '8px', fontSize: '12px', color: '#b91c1c' }}>
            {submitError}
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={isSavingDraft || !name}
            style={{
              flex: 1, padding: '12px', fontSize: '13px', fontWeight: 600,
              backgroundColor: '#fff', color: C.text,
              border: `2px solid ${C.border}`, borderRadius: '10px',
              cursor: isSavingDraft || !name ? 'not-allowed' : 'pointer',
              opacity: !name ? 0.5 : 1,
            }}
          >
            {isSavingDraft ? '저장 중...' : draftId ? '임시저장 업데이트' : '임시저장'}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !name || !draftId || categoryValid !== true}
            title={!draftId ? '먼저 임시저장하세요' : categoryValid !== true ? '유효한 카테고리 코드를 입력하세요' : ''}
            style={{
              flex: 1, padding: '12px', fontSize: '13px', fontWeight: 700,
              backgroundColor: isSubmitting || !draftId || categoryValid !== true ? '#e5e7eb' : '#15803d',
              color: isSubmitting || !draftId || categoryValid !== true ? C.textSub : '#fff',
              border: 'none', borderRadius: '10px',
              cursor: isSubmitting || !draftId || categoryValid !== true ? 'not-allowed' : 'pointer',
            }}
          >
            {isSubmitting ? '제출 중...' : '쿠팡에 제출'}
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
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | grep "CoupangAutoRegisterPanel" | head -20
```

Expected: 오류 없음. 오류가 있으면 타입 불일치를 수정한다.

> **체크:** `sharedDraft.detailPageSnippet`이 존재하지 않으면 `sharedDraft.description`만 사용하도록 수정한다. `sharedDraft`의 정확한 타입은 `src/store/useListingStore.ts`의 `SharedDraft` 인터페이스를 참조한다.

- [ ] **Step 3: 커밋**

```bash
git add src/components/listing/workflow/CoupangAutoRegisterPanel.tsx
git commit -m "feat(coupang-panel): 폼 섹션 JSX 구현 (기본정보·주요정보·가격·배송·고시정보·태그·액션)"
```

---

## Task 4: Step3 우측 패널 교체

**파일:**
- Modify: `src/components/listing/workflow/Step3ReviewRegister.tsx`

`RegisterFormSections`를 `CoupangAutoRegisterPanel`로 교체한다.

- [ ] **Step 1: `Step3ReviewRegister.tsx` 수정**

`src/components/listing/workflow/Step3ReviewRegister.tsx`에서:

1. 기존 import 교체:
```typescript
// 이것을
import RegisterFormSections from '@/components/listing/register-form';

// 이것으로
import CoupangAutoRegisterPanel from '@/components/listing/workflow/CoupangAutoRegisterPanel';
```

2. 우측 패널 JSX 교체 (파일 내 `showRegisterForm && !registered` 블록):

```typescript
// 이것을
{showRegisterForm && !registered && (
  <RegisterFormSections onSuccess={handleRegistered} onCancel={() => {}} />
)}

// 이것으로
{showRegisterForm && !registered && (
  <CoupangAutoRegisterPanel onSuccess={handleRegistered} />
)}
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit 2>&1 | grep "Step3ReviewRegister\|CoupangAutoRegisterPanel" | head -20
```

Expected: 오류 없음

- [ ] **Step 3: 전체 테스트 실행**

```bash
npx vitest run src/__tests__/components/CoupangAutoRegisterPanel.test.tsx \
              src/__tests__/store/useListingStore-both.test.ts
```

Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add src/components/listing/workflow/Step3ReviewRegister.tsx
git commit -m "feat(step3): 우측 패널을 CoupangAutoRegisterPanel로 교체"
```

---

## Task 5: E2E 스모크 테스트

**파일:**
- Modify: `src/__tests__/components/CoupangAutoRegisterPanel.test.tsx`

임시저장 → 제출 플로우를 end-to-end로 검증한다.

- [ ] **Step 1: 스모크 테스트 추가**

`src/__tests__/components/CoupangAutoRegisterPanel.test.tsx`에 다음 추가:

```typescript
import userEvent from '@testing-library/user-event';

describe('임시저장 → 제출 플로우', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('ai-map')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ fields: null }),
        });
      }
      if (url.includes('delivery-defaults')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ outboundShippingPlaceCode: '', returnCenterCode: '' }),
        });
      }
      if (url === '/api/listing/coupang/drafts' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'draft-abc-123' }),
        });
      }
      if (url.includes('drafts/draft-abc-123/submit') && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              sellerProductId: 99887766,
              wingsUrl: 'https://wing.coupang.com',
            }),
        });
      }
      if (url.includes('validate-category')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ valid: true, fullPath: '테스트>카테고리' }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  it('임시저장 버튼 클릭 시 POST /api/listing/coupang/drafts가 호출된다', async () => {
    const user = userEvent.setup();
    render(<CoupangAutoRegisterPanel onSuccess={() => {}} />);

    // 카테고리 코드 입력 (유효성 검증 트리거)
    const catInput = screen.getByPlaceholderText('숫자 코드 입력 (예: 78780)');
    await user.type(catInput, '78780');

    // 임시저장 버튼 클릭
    const saveBtn = screen.getByText('임시저장');
    await user.click(saveBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/listing/coupang/drafts',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('임시저장 후 제출 버튼이 활성화되고, 클릭 시 submit API가 호출된다', async () => {
    const user = userEvent.setup();
    const onSuccess = jest.fn();
    render(<CoupangAutoRegisterPanel onSuccess={onSuccess} />);

    const catInput = screen.getByPlaceholderText('숫자 코드 입력 (예: 78780)');
    await user.type(catInput, '78780');

    // 임시저장
    await user.click(screen.getByText('임시저장'));
    await waitFor(() => screen.getByText('임시저장 업데이트'));

    // 제출 버튼 활성화 확인 (카테고리 유효 + draftId 있음)
    await waitFor(() => {
      const submitBtn = screen.getByText('쿠팡에 제출');
      expect(submitBtn).not.toBeDisabled();
    });

    await user.click(screen.getByText('쿠팡에 제출'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('drafts/draft-abc-123/submit'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // 성공 화면
    await waitFor(() => {
      expect(screen.getByText(/쿠팡 제출 완료/)).toBeInTheDocument();
      expect(screen.getByText(/99887766/)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: 테스트 실행**

```bash
npx vitest run src/__tests__/components/CoupangAutoRegisterPanel.test.tsx
```

Expected: PASS (buildDraftData 3 + 컴포넌트 2 + 플로우 2 = 7 tests)

> 실패 시 `waitFor` 타임아웃을 늘리거나(`{ timeout: 5000 }`), fetch mock에서 `Promise.resolve`가 올바른 구조인지 확인한다.

- [ ] **Step 3: 전체 테스트 스위트 실행 (회귀 확인)**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: 기존 테스트 모두 통과. 새 실패가 있으면 해당 파일을 확인한다.

- [ ] **Step 4: 최종 커밋**

```bash
git add src/__tests__/components/CoupangAutoRegisterPanel.test.tsx
git commit -m "test(coupang-panel): 임시저장→제출 E2E 스모크 테스트"
```

---

## Self-Review

### Spec 커버리지

| 요구사항 | 커버하는 Task |
|---------|-------------|
| `sharedDraft`에서 초기값 읽기 | Task 2 |
| AI 필드 매핑 마운트 시 실행 | Task 2 |
| 카테고리 검색 + 유효성 검증 | Task 3 |
| 브랜드·제조사·주요 정보 | Task 3 |
| 가격·재고 + 수수료 계산 | Task 3 |
| 배송·반품 + 출하지 코드 | Task 3 |
| 고시정보 자동 생성 | Task 2 + Task 3 |
| 검색 태그 | Task 3 |
| 임시저장 (POST/PUT drafts) | Task 2 |
| 쿠팡 제출 (submit) | Task 2 |
| 제출 성공 화면 | Task 3 |
| Step3 우측 패널 교체 | Task 4 |

### Placeholder 스캔

플랜 내 "TBD", "TODO", "나중에" 등 없음. 모든 코드 블록 완성.

### 타입 일관성

- `DraftFormState.thumbnail` → `DraftData.thumbnail` → submit route `d.thumbnail` ✓
- `DraftFormState.categoryCode` → `DraftData.categoryCode` → submit route `d.categoryCode` → `displayCategoryCode` ✓
- `MappedCoupangFields` 타입은 `src/lib/auto-register/types.ts:17` 정의 참조 ✓
- `sharedDraft.pickedDetailImages`, `sharedDraft.categoryHint`, `sharedDraft.sourceUrl` — 모두 현재 `useListingStore.ts` diff에서 확인된 필드 ✓

### 잠재적 이슈

1. **`sharedDraft.detailPageSnippet`**: `SharedDraft` 인터페이스에 없으면 컴파일 오류. Task 3 Step 2에서 확인하고 제거.
2. **`source: 'manual' as const`**: `NormalizedProduct.source`는 `SourceType = 'domeggook' | 'costco'`만 허용. AI 매핑 payload 구성 시 `product` 객체에서 `source` 필드를 제거하거나 `'domeggook'`으로 더미 설정.

   → Task 2 Step 3의 AI 매핑 fetch body에서 `source` 필드를 아예 제외:
   ```typescript
   const product = {
     // source 제거 (api route에서 optional 처리)
     itemId: '',
     title: sharedDraft.name,
     ...
   };
   ```
   또는 `/api/auto-register/ai-map/route.ts`가 `NormalizedProduct` 타입 전체를 요구하지 않고 partial만 받도록 타입을 느슨하게 처리(`body.product`를 `Partial<NormalizedProduct>`로). **ai-map route는 이미 `{ product?: NormalizedProduct }` 타입으로 받으므로 필드가 없어도 런타임에서는 정상 동작함.** TypeScript 컴파일 오류만 수정하면 됨 → `as unknown as NormalizedProduct` 또는 `Record<string, unknown>` 캐스팅 사용.
