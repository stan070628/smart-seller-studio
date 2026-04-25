# 상품등록탭 재편 — Phase 2 (Step3 6섹션 + BothRegisterForm 폐기) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **선행 조건:** `2026-04-26-listing-tabs-restructure-phase1.md` 완료 후 진행. Phase 1에서 만든 탭 구조를 전제로 한다.

**Goal:** Step3의 거대한 `BothRegisterForm` (1,905줄)을 6개 섹션 아코디언 폼으로 분리하고, 등록 로직을 `useRegisterForm` 훅으로 추출하여 `BothRegisterForm`을 실제로 폐기한다.

**Architecture:** 등록 로직(buildPayloadData/validate/handleSubmit/handlePreview)을 `useRegisterForm` 훅으로 추출, 각 섹션 컴포넌트는 순수 UI + 훅에서 필요한 슬라이스만 참조. Step3 우측 컬럼이 `<RegisterFormSections>` 컨테이너로 교체되며 좌측 미리보기는 그대로 유지. 플랫폼별 특수 필드(쿠팡 브랜드·상품정보고시 등)는 해당 섹션 안의 "플랫폼별 추가 옵션" 접힘 영역에 배치.

**Tech Stack:** React 19 + Zustand, 기존 `Section` 아코디언 컴포넌트(`ListingDashboard.tsx`에 정의됨)를 공용 모듈로 승격, Vitest + RTL.

**참조:**
- spec: `docs/superpowers/specs/2026-04-26-listing-tabs-restructure-design.md`
- Phase 1 plan: `docs/superpowers/plans/2026-04-26-listing-tabs-restructure-phase1.md`
- 폐기 대상: `src/components/listing/BothRegisterForm.tsx` (1,905줄)

---

## File Structure

### 신규 파일

```
src/hooks/useRegisterForm.ts                              # 등록 로직 훅 (BothRegisterForm에서 추출)

src/components/listing/register-form/
  index.tsx                                               # 컨테이너 (RegisterFormSections)
  Section.tsx                                             # 공용 아코디언 (ListingDashboard에서 분리)
  sections/
    BasicInfoSection.tsx                                  # 상품명 + AI 최적화 + 카테고리
    PricingSection.tsx                                    # 공통/채널별 판매가, 원가, 재고
    ImagesSection.tsx                                     # 썸네일 + 상세 이미지
    DescriptionSection.tsx                                # 상세설명 (HTML)
    DeliverySection.tsx                                   # 배송비, 반품배송비, 교환배송비
    KeywordsSection.tsx                                   # 태그/키워드
  parts/
    CategoryPicker.tsx                                    # 쿠팡+네이버 카테고리 검색 (BothRegisterForm에서 추출)
    PlatformExtraOptions.tsx                              # 쿠팡 상품정보고시·브랜드·세금/네이버 교환배송비 등

src/__tests__/hooks/use-register-form.test.tsx
src/__tests__/components/register-form-sections.test.tsx
src/__tests__/components/register-form-pricing-section.test.tsx
```

### 수정 파일

```
src/components/listing/workflow/Step3ReviewRegister.tsx   # 우측 컬럼을 RegisterFormSections로 교체
src/components/listing/ListingDashboard.tsx               # 기존 Section 컴포넌트 export 후 import 변경
```

### 폐기 파일

```
src/components/listing/BothRegisterForm.tsx               # 삭제 (Task 11에서)
```

---

## ⚠ 위험 요소 및 작업자 가이드

이 plan은 1,905줄 컴포넌트의 분해/재구성이라 위험이 큽니다. 다음 원칙을 지켜주세요.

1. **점진적 교체**: BothRegisterForm을 한 번에 삭제하지 마세요. 새 RegisterFormSections를 Step3에 옮긴 후 빌드+스모크 테스트가 통과한 다음에 삭제합니다(Task 10/11).
2. **로직 무결성**: `buildPayloadData`/`validate`/`handlePreview`/`handleSubmit`의 로직은 한 글자도 변경 없이 훅으로 옮기세요. 리팩터링과 동작 변경을 같은 task에 섞지 마세요.
3. **회귀 비교**: 각 섹션 옮긴 후, 해당 섹션 입력값이 `sharedDraft`와 `payload`에 정확히 동일하게 반영되는지 단위 테스트로 검증하세요.
4. **localStorage 키 유지**: `sss_coupang_item_defaults` 등 BothRegisterForm이 사용하는 localStorage 키는 그대로 유지(쿠팡 섹션 옮길 때).

---

## Task 1: 공용 `Section` 컴포넌트 분리

`ListingDashboard.tsx` 안에 정의된 `<Section>` 아코디언 컴포넌트를 별도 파일로 추출하여 공용 모듈로 만든다.

**Files:**
- Create: `src/components/listing/register-form/Section.tsx`
- Modify: `src/components/listing/ListingDashboard.tsx` (기존 정의 제거 + import)

- [ ] **Step 1: Locate existing Section component**

```bash
grep -n "^function Section\|export.*Section" src/components/listing/ListingDashboard.tsx
```

기존 코드를 그대로 복사한다.

- [ ] **Step 2: Create Section.tsx**

```tsx
// src/components/listing/register-form/Section.tsx
'use client';

import React, { useState } from 'react';
import { C } from '@/lib/design-tokens';

interface SectionProps {
  title: string;
  required?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export default function Section({ title, required, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      backgroundColor: C.card, border: `1px solid ${C.border}`,
      borderRadius: '10px', overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', background: 'none', border: 'none', cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: '14px', fontWeight: 700, color: C.text }}>
          {title}
          {required && <span style={{ color: C.accent, marginLeft: '4px' }}>*</span>}
        </span>
        <span style={{ color: C.textSub, fontSize: '12px' }}>{open ? '접기' : '펼치기'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {children}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Remove old definition + import**

`ListingDashboard.tsx`의 `function Section(...)` 정의 영역 제거. `Section`을 다른 곳에서 사용 중이라면 다음 import 추가:

```typescript
import Section from '@/components/listing/register-form/Section';
```

- [ ] **Step 4: Build + test smoke**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: 모두 통과. 기존 `Section` 사용처에서 변화 없음.

- [ ] **Step 5: Commit**

```bash
git add src/components/listing/register-form/Section.tsx src/components/listing/ListingDashboard.tsx
git commit -m "refactor(listing): Section 아코디언을 공용 모듈로 분리"
```

---

## Task 2: `useRegisterForm` 훅 — 등록 로직 추출

BothRegisterForm 안의 폼 상태/유효성/페이로드/제출 로직을 훅으로 추출한다.

**Files:**
- Create: `src/hooks/useRegisterForm.ts`
- Test: `src/__tests__/hooks/use-register-form.test.tsx`

- [ ] **Step 1: Write the failing test (계약 검증)**

```tsx
// src/__tests__/hooks/use-register-form.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRegisterForm } from '@/hooks/useRegisterForm';
import { useListingStore } from '@/store/useListingStore';

describe('useRegisterForm', () => {
  beforeEach(() => {
    useListingStore.getState().resetSharedDraft();
  });

  it('초기 errors는 빈 객체', () => {
    const { result } = renderHook(() => useRegisterForm());
    expect(result.current.errors).toEqual({});
  });

  it('상품명 빈 상태로 validate하면 name 에러를 반환', () => {
    const { result } = renderHook(() => useRegisterForm());
    act(() => { result.current.validate(); });
    expect(result.current.errors.name).toBeTruthy();
  });

  it('썸네일 0장이면 images 에러를 반환', () => {
    useListingStore.getState().updateSharedDraft({ name: '테스트' });
    const { result } = renderHook(() => useRegisterForm());
    act(() => { result.current.validate(); });
    expect(result.current.errors.images).toBeTruthy();
  });

  it('buildPayloadData는 sharedDraft 내용을 그대로 매핑한다', () => {
    useListingStore.getState().updateSharedDraft({
      name: '테스트',
      salePrice: '10000',
      stock: '100',
      thumbnailImages: ['t1.jpg'],
    });
    const { result } = renderHook(() => useRegisterForm());
    const payload = result.current.buildPayloadData();
    expect(payload.name).toBe('테스트');
    expect(payload.salePrice).toBe(10000);
    expect(payload.stock).toBe(100);
    expect(payload.thumbnailImages).toEqual(['t1.jpg']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/hooks/use-register-form.test.tsx`
Expected: FAIL — 훅 미존재

- [ ] **Step 3: Implement the hook**

`src/components/listing/BothRegisterForm.tsx`의 다음 영역을 그대로 복사·이전:

- 상태: `errors`, `isOptimizing`, `tagInput`, `coupangCategoryCode/Path`, `naverCategoryId/Path`, `brand`, `naverExchangeFee`, `coupangDefaults`, `previewData`, `isPreviewing`
- 함수: `validate`, `addTag`, `removeTag`, `buildPayloadData`, `handlePreview`, `handleSubmit`, `handleOptimize`, `recalcChannelPrices`

```typescript
// src/hooks/useRegisterForm.ts
'use client';

import { useState, useEffect } from 'react';
import { useListingStore } from '@/store/useListingStore';
// ... BothRegisterForm.tsx의 관련 import 모두 이전

// 타입/상수도 함께 이동:
// - CoupangItemDefaults, DEFAULT_COUPANG_ITEM
// - loadCoupangDefaults, saveCoupangDefaults
// - CoupangCategoryResult, NaverCategoryResult

export function useRegisterForm(opts?: {
  onSuccessCallback?: () => void;
}) {
  const { sharedDraft, updateSharedDraft, bothRegistration, registerBothProducts, resetBothRegistration, fetchOptions } = useListingStore();

  const [coupangCategoryCode, setCoupangCategoryCode] = useState(sharedDraft.coupangCategoryCode);
  const [coupangCategoryPath, setCoupangCategoryPath] = useState(sharedDraft.coupangCategoryPath);
  const [naverCategoryId, setNaverCategoryId] = useState(sharedDraft.naverCategoryId);
  const [naverCategoryPath, setNaverCategoryPath] = useState(sharedDraft.naverCategoryPath);
  const [brand, setBrand] = useState('');
  const [naverExchangeFee, setNaverExchangeFee] = useState('5000');
  const [coupangDefaults, setCoupangDefaults] = useState(/* DEFAULT_COUPANG_ITEM */);
  const [tagInput, setTagInput] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [previewData, setPreviewData] = useState<{ coupang: unknown; naver: unknown } | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // ... 모든 useEffect, 함수, 핸들러를 BothRegisterForm.tsx에서 그대로 복사

  return {
    // 폼 상태
    sharedDraft,
    updateDraft: updateSharedDraft,
    errors,
    setErrors,

    // 카테고리
    coupangCategoryCode, setCoupangCategoryCode,
    coupangCategoryPath, setCoupangCategoryPath,
    naverCategoryId, setNaverCategoryId,
    naverCategoryPath, setNaverCategoryPath,

    // 플랫폼별
    brand, setBrand,
    naverExchangeFee, setNaverExchangeFee,
    coupangDefaults, setCoupangDefaults,

    // 태그
    tagInput, setTagInput,
    addTag, removeTag,

    // AI/액션
    isOptimizing,
    handleOptimize,
    recalcChannelPrices,

    // 페이로드/제출
    buildPayloadData,
    validate,
    handlePreview,
    handleSubmit,

    // 미리보기/등록 결과
    previewData,
    isPreviewing,
    bothRegistration,
    resetBothRegistration,
  };
}
```

> **작업 지침**: 코드를 옮길 때 동작 변경 금지. 단순 추출만. 옮긴 후 기존 BothRegisterForm은 일시적으로 이 훅을 사용하도록 수정해도 좋고(점진), Task 9까지 손대지 않고 두어도 좋다.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/hooks/use-register-form.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useRegisterForm.ts src/__tests__/hooks/use-register-form.test.tsx
git commit -m "feat(register-form): useRegisterForm 훅 추출

BothRegisterForm의 폼 상태/검증/페이로드/제출 로직을 훅으로 분리."
```

---

## Task 3: `BasicInfoSection` — 상품명 + 카테고리

**Files:**
- Create: `src/components/listing/register-form/parts/CategoryPicker.tsx`
- Create: `src/components/listing/register-form/sections/BasicInfoSection.tsx`
- Test: `src/__tests__/components/register-form-basic-info.test.tsx`

- [ ] **Step 1: Extract CategoryPicker from BothRegisterForm**

`BothRegisterForm.tsx`의 라인 ~1075-1170(쿠팡 카테고리 검색) + ~1460-1560(네이버 카테고리 검색) 영역을 `CategoryPicker.tsx`로 추출.

```tsx
// src/components/listing/register-form/parts/CategoryPicker.tsx
'use client';

import React, { useState } from 'react';
// ... BothRegisterForm의 카테고리 검색 로직 import

interface Props {
  platform: 'coupang' | 'naver';
  selectedCode: string;
  selectedPath: string;
  onChange: (code: string, path: string) => void;
  error?: string;
}

export default function CategoryPicker({ platform, selectedCode, selectedPath, onChange, error }: Props) {
  // BothRegisterForm의 categoryKeyword/coupangResults 또는 naverResults 검색 로직을 옮기되,
  // 이 컴포넌트는 1개 플랫폼만 다룸.
  // 기존 fetch 호출:
  //   - coupang: GET /api/listing/coupang/categories?keyword=...
  //   - naver: GET /api/listing/naver/categories?keyword=...
  // 위 라우트는 변경 없음.
  // ...
}
```

- [ ] **Step 2: Write failing test**

```tsx
// src/__tests__/components/register-form-basic-info.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BasicInfoSection from '@/components/listing/register-form/sections/BasicInfoSection';

describe('BasicInfoSection', () => {
  it('상품명 입력과 카테고리 선택 영역이 렌더된다', () => {
    render(<BasicInfoSection />);
    expect(screen.getByPlaceholderText(/상품명/)).toBeInTheDocument();
    expect(screen.getByText(/쿠팡 카테고리/)).toBeInTheDocument();
    expect(screen.getByText(/네이버 카테고리/)).toBeInTheDocument();
  });
});
```

Run: `npx vitest run src/__tests__/components/register-form-basic-info.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement BasicInfoSection**

```tsx
// src/components/listing/register-form/sections/BasicInfoSection.tsx
'use client';

import React from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { useRegisterForm } from '@/hooks/useRegisterForm';
import { C } from '@/lib/design-tokens';
import CategoryPicker from '../parts/CategoryPicker';

const inputStyle: React.CSSProperties = { /* BothRegisterForm과 동일 */ };
const labelStyle: React.CSSProperties = { /* BothRegisterForm과 동일 */ };

export default function BasicInfoSection() {
  const {
    sharedDraft, updateDraft, errors, setErrors,
    coupangCategoryCode, setCoupangCategoryCode, coupangCategoryPath, setCoupangCategoryPath,
    naverCategoryId, setNaverCategoryId, naverCategoryPath, setNaverCategoryPath,
    isOptimizing, handleOptimize,
  } = useRegisterForm();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* 상품명 + AI 최적화 — BothRegisterForm 라인 615-660 그대로 이전 */}
      <div>
        <label style={labelStyle}>
          상품명 <span style={{ color: C.accent }}>*</span>
        </label>
        {/* ... 기존 코드 그대로 ... */}
      </div>

      {/* 쿠팡 카테고리 */}
      <CategoryPicker
        platform="coupang"
        selectedCode={coupangCategoryCode}
        selectedPath={coupangCategoryPath}
        onChange={(code, path) => {
          setCoupangCategoryCode(code);
          setCoupangCategoryPath(path);
          if (errors.coupangCategory) setErrors((prev) => ({ ...prev, coupangCategory: '' }));
        }}
        error={errors.coupangCategory}
      />

      {/* 네이버 카테고리 */}
      <CategoryPicker
        platform="naver"
        selectedCode={naverCategoryId}
        selectedPath={naverCategoryPath}
        onChange={(code, path) => {
          setNaverCategoryId(code);
          setNaverCategoryPath(path);
          if (errors.naverCategory) setErrors((prev) => ({ ...prev, naverCategory: '' }));
        }}
        error={errors.naverCategory}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test + smoke**

```bash
npx vitest run src/__tests__/components/register-form-basic-info.test.tsx
npx tsc --noEmit
```

Expected: PASS, 타입 에러 없음.

- [ ] **Step 5: Commit**

```bash
git add src/components/listing/register-form/parts/CategoryPicker.tsx \
        src/components/listing/register-form/sections/BasicInfoSection.tsx \
        src/__tests__/components/register-form-basic-info.test.tsx
git commit -m "feat(register-form): BasicInfoSection + CategoryPicker 추출"
```

---

## Task 4: `PricingSection` — 가격/재고

**Files:**
- Create: `src/components/listing/register-form/sections/PricingSection.tsx`
- Test: `src/__tests__/components/register-form-pricing-section.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/__tests__/components/register-form-pricing-section.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PricingSection from '@/components/listing/register-form/sections/PricingSection';
import { useListingStore } from '@/store/useListingStore';

describe('PricingSection', () => {
  it('공통 판매가/정상가/재고/채널별 판매가 입력이 렌더된다', () => {
    render(<PricingSection />);
    expect(screen.getByText(/공통 판매가/)).toBeInTheDocument();
    expect(screen.getByText(/정상가/)).toBeInTheDocument();
    expect(screen.getByText(/재고/)).toBeInTheDocument();
    expect(screen.getByText(/쿠팡.*판매가/)).toBeInTheDocument();
    expect(screen.getByText(/네이버.*판매가/)).toBeInTheDocument();
  });

  it('판매가 입력 시 sharedDraft에 반영된다', () => {
    render(<PricingSection />);
    const input = screen.getByPlaceholderText(/채널 공통 가격/);
    fireEvent.change(input, { target: { value: '12345' } });
    expect(useListingStore.getState().sharedDraft.salePrice).toBe('12345');
  });
});
```

Run: `npx vitest run src/__tests__/components/register-form-pricing-section.test.tsx`
Expected: FAIL

- [ ] **Step 2: Implement PricingSection**

`BothRegisterForm.tsx`의 라인 ~662-810(공통 판매가/정상가/재고/채널별 판매가)를 그대로 옮긴다.

```tsx
// src/components/listing/register-form/sections/PricingSection.tsx
'use client';

import React from 'react';
import { useRegisterForm } from '@/hooks/useRegisterForm';
import { C } from '@/lib/design-tokens';

// inputStyle, labelStyle, FieldError 가져오기

export default function PricingSection() {
  const { sharedDraft, updateDraft, errors, setErrors } = useRegisterForm();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* 공통 판매가 / 정상가 / 재고 — 라인 663-708 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
        {/* 공통 판매가 */}
        {/* 정상가 */}
        {/* 재고 */}
      </div>
      {/* 채널별 판매가 (쿠팡/네이버) — 라인 710-810 */}
      {/* 옵션 편집기는 별도 섹션이 아닌 여기에 둠 (현재 BothRegisterForm 동일) */}
    </div>
  );
}
```

> **메모**: `OptionEditor` 컴포넌트(`src/components/listing/OptionEditor.tsx`)는 가격/옵션 결합 영역이라 이 섹션 안에 둔다. BothRegisterForm 라인 813에서 사용 중인 `<OptionEditor itemNo={prefill?.itemNo} />`를 그대로 복사하되, `prefill`은 Phase 2에서 사라지므로 `undefined` 전달.

- [ ] **Step 3: Run test + smoke**

```bash
npx vitest run src/__tests__/components/register-form-pricing-section.test.tsx
npx tsc --noEmit
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/listing/register-form/sections/PricingSection.tsx \
        src/__tests__/components/register-form-pricing-section.test.tsx
git commit -m "feat(register-form): PricingSection 추출 — 가격/재고/옵션"
```

---

## Task 5: `ImagesSection` — 썸네일 + 상세 이미지

**Files:**
- Create: `src/components/listing/register-form/sections/ImagesSection.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/__tests__/components/register-form-images-section.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ImagesSection from '@/components/listing/register-form/sections/ImagesSection';

describe('ImagesSection', () => {
  it('썸네일/상세이미지 입력 영역이 모두 노출된다', () => {
    render(<ImagesSection />);
    expect(screen.getByText(/상품 이미지/)).toBeInTheDocument();
    expect(screen.getByText(/상세페이지 이미지/)).toBeInTheDocument();
  });
});
```

Run: `npx vitest run src/__tests__/components/register-form-images-section.test.tsx`
Expected: FAIL

- [ ] **Step 2: Implement**

`BothRegisterForm.tsx`의 라인 ~815-841 영역을 그대로 옮긴다.

```tsx
// src/components/listing/register-form/sections/ImagesSection.tsx
'use client';

import React from 'react';
import ImageInputSection from '@/components/listing/ImageInputSection';
import { useRegisterForm } from '@/hooks/useRegisterForm';
import { C } from '@/lib/design-tokens';

export default function ImagesSection() {
  const { sharedDraft, updateDraft, errors, setErrors } = useRegisterForm();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <ImageInputSection
        label="상품 이미지 (썸네일)"
        required
        maxCount={10}
        urls={sharedDraft.thumbnailImages}
        onUrlsChange={(urls) => {
          updateDraft({ thumbnailImages: urls });
          if (errors.images) setErrors((prev) => ({ ...prev, images: '' }));
        }}
        usageContext="listing_thumbnail"
        error={errors.images}
      />

      <div style={{ marginTop: '4px' }}>
        <div style={{ fontSize: '11px', color: C.textSub, marginBottom: '6px' }}>
          상세페이지 이미지는 상품 상세설명 하단에 자동 삽입됩니다.
        </div>
        <ImageInputSection
          label="상세페이지 이미지"
          maxCount={20}
          urls={sharedDraft.detailImages}
          onUrlsChange={(urls) => updateDraft({ detailImages: urls })}
          usageContext="listing_detail"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run test + commit**

```bash
npx vitest run src/__tests__/components/register-form-images-section.test.tsx
git add src/components/listing/register-form/sections/ImagesSection.tsx \
        src/__tests__/components/register-form-images-section.test.tsx
git commit -m "feat(register-form): ImagesSection — 썸네일/상세 이미지"
```

---

## Task 6: `DescriptionSection` — 상세설명 (HTML)

**Files:**
- Create: `src/components/listing/register-form/sections/DescriptionSection.tsx`
- Test: `src/__tests__/components/register-form-description-section.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/__tests__/components/register-form-description-section.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DescriptionSection from '@/components/listing/register-form/sections/DescriptionSection';
import { useListingStore } from '@/store/useListingStore';

describe('DescriptionSection', () => {
  it('description textarea가 노출된다', () => {
    render(<DescriptionSection />);
    expect(screen.getByPlaceholderText(/상세 설명/)).toBeInTheDocument();
  });

  it('입력 시 sharedDraft.description에 반영된다', () => {
    render(<DescriptionSection />);
    const ta = screen.getByPlaceholderText(/상세 설명/);
    fireEvent.change(ta, { target: { value: '<p>설명</p>' } });
    expect(useListingStore.getState().sharedDraft.description).toBe('<p>설명</p>');
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// src/components/listing/register-form/sections/DescriptionSection.tsx
'use client';

import React from 'react';
import { useRegisterForm } from '@/hooks/useRegisterForm';
import { C } from '@/lib/design-tokens';

export default function DescriptionSection() {
  const { sharedDraft, updateDraft } = useRegisterForm();

  return (
    <div>
      <textarea
        style={{
          width: '100%', minHeight: '180px',
          padding: '10px 14px',
          fontSize: '13px',
          fontFamily: 'monospace',
          border: `1px solid ${C.border}`,
          borderRadius: '8px',
          outline: 'none',
          resize: 'vertical',
          color: C.text,
          backgroundColor: '#fff',
          boxSizing: 'border-box',
        }}
        value={sharedDraft.description}
        onChange={(e) => updateDraft({ description: e.target.value })}
        placeholder="상세 설명 (HTML 가능)"
      />
      <div style={{ fontSize: '11px', color: C.textSub, marginTop: '6px' }}>
        AI가 생성한 상세페이지 HTML이 이 영역에 자동 채워집니다. 직접 수정 가능.
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run test + commit**

```bash
npx vitest run src/__tests__/components/register-form-description-section.test.tsx
git add src/components/listing/register-form/sections/DescriptionSection.tsx \
        src/__tests__/components/register-form-description-section.test.tsx
git commit -m "feat(register-form): DescriptionSection — 상세설명 직접 편집"
```

---

## Task 7: `DeliverySection` — 배송

**Files:**
- Create: `src/components/listing/register-form/sections/DeliverySection.tsx`
- Test: `src/__tests__/components/register-form-delivery-section.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/__tests__/components/register-form-delivery-section.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DeliverySection from '@/components/listing/register-form/sections/DeliverySection';
import { useListingStore } from '@/store/useListingStore';

describe('DeliverySection', () => {
  it('배송비 유형/배송비/반품배송비/교환배송비 영역이 노출된다', () => {
    render(<DeliverySection />);
    expect(screen.getByText(/배송비 유형/)).toBeInTheDocument();
    expect(screen.getByText(/^배송비/)).toBeInTheDocument();
    expect(screen.getByText(/반품배송비/)).toBeInTheDocument();
    expect(screen.getByText(/교환배송비/)).toBeInTheDocument(); // 네이버 전용 (PlatformExtraOptions 안)
  });
});
```

- [ ] **Step 2: Implement**

`BothRegisterForm.tsx`의 라인 ~843-891(배송 정보)을 옮기고, 네이버 교환배송비(`naverExchangeFee`)는 같은 섹션 안의 "네이버 전용" 칩으로 노출.

```tsx
// src/components/listing/register-form/sections/DeliverySection.tsx
'use client';

import React from 'react';
import { useRegisterForm } from '@/hooks/useRegisterForm';
import { C } from '@/lib/design-tokens';

const inputStyle: React.CSSProperties = { /* 동일 */ };
const labelStyle: React.CSSProperties = { /* 동일 */ };

export default function DeliverySection() {
  const { sharedDraft, updateDraft, recalcChannelPrices, naverExchangeFee, setNaverExchangeFee } = useRegisterForm();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* 배송비 유형 / 배송비 / 반품배송비 — 라인 844-891 그대로 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
        {/* ... */}
      </div>

      {/* 네이버 전용 — 교환배송비 */}
      <div>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            fontSize: '10px', fontWeight: 700, color: '#fff',
            backgroundColor: '#03c75a', padding: '1px 6px', borderRadius: '4px',
          }}>
            네이버
          </span>
          교환배송비 (원)
        </label>
        <input
          type="number"
          min="0"
          style={inputStyle}
          value={naverExchangeFee}
          onChange={(e) => setNaverExchangeFee(e.target.value)}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run test + commit**

```bash
npx vitest run src/__tests__/components/register-form-delivery-section.test.tsx
git add src/components/listing/register-form/sections/DeliverySection.tsx \
        src/__tests__/components/register-form-delivery-section.test.tsx
git commit -m "feat(register-form): DeliverySection — 배송비/반품/교환"
```

---

## Task 8: `KeywordsSection` + `PlatformExtraOptions` (쿠팡 추가 옵션)

**Files:**
- Create: `src/components/listing/register-form/sections/KeywordsSection.tsx`
- Create: `src/components/listing/register-form/parts/PlatformExtraOptions.tsx`
- Test: `src/__tests__/components/register-form-keywords-section.test.tsx`

KeywordsSection은 태그(`sharedDraft.tags`) 입력만 담당. 쿠팡 전용 추가 필드(브랜드, 배송사, 출고일, adultOnly, taxType, overseasPurchased, parallelImported, 상품정보고시)는 `PlatformExtraOptions`로 추출하여 KeywordsSection 또는 BasicInfoSection 하단의 접힘 영역에 배치.

> **결정**: 가독성을 위해 `PlatformExtraOptions`는 BasicInfoSection 하단에 배치. (사용자가 다른 위치를 원하면 작업자 재량으로 변경 가능)

- [ ] **Step 1: Implement KeywordsSection**

`BothRegisterForm.tsx`의 라인 ~893-954(태그)를 그대로 옮긴다.

```tsx
// src/components/listing/register-form/sections/KeywordsSection.tsx
'use client';

import React from 'react';
import { X } from 'lucide-react';
import { useRegisterForm } from '@/hooks/useRegisterForm';
import { C } from '@/lib/design-tokens';

const inputStyle: React.CSSProperties = { /* 동일 */ };
const labelStyle: React.CSSProperties = { /* 동일 */ };

export default function KeywordsSection() {
  const { sharedDraft, tagInput, setTagInput, addTag, removeTag } = useRegisterForm();

  return (
    <div>
      {/* 태그 입력 + 추가 버튼 */}
      {/* ... 라인 893-954 그대로 ... */}
    </div>
  );
}
```

- [ ] **Step 2: Implement PlatformExtraOptions**

`BothRegisterForm.tsx`의 라인 ~1190-1340(쿠팡 설정: 브랜드, 배송사, 출고일, adultOnly, taxType, 상품정보고시 등)을 옮긴다.

```tsx
// src/components/listing/register-form/parts/PlatformExtraOptions.tsx
'use client';

import React from 'react';
import { useRegisterForm } from '@/hooks/useRegisterForm';
import Section from '../Section';

export default function PlatformExtraOptions() {
  const { brand, setBrand, coupangDefaults, setCoupangDefaults } = useRegisterForm();

  return (
    <Section title="플랫폼별 추가 옵션 (쿠팡)" defaultOpen={false}>
      {/* 브랜드 */}
      {/* 배송사 / 출고일 */}
      {/* adultOnly / taxType / overseasPurchased / parallelImported */}
      {/* 상품정보고시 (notices) */}
    </Section>
  );
}
```

- [ ] **Step 3: Update BasicInfoSection to render PlatformExtraOptions at bottom**

```tsx
// src/components/listing/register-form/sections/BasicInfoSection.tsx
import PlatformExtraOptions from '../parts/PlatformExtraOptions';

// 컴포넌트 끝에 추가
<PlatformExtraOptions />
```

- [ ] **Step 4: Test + commit**

```bash
npx vitest run src/__tests__/components/register-form-keywords-section.test.tsx
git add src/components/listing/register-form/sections/KeywordsSection.tsx \
        src/components/listing/register-form/parts/PlatformExtraOptions.tsx \
        src/components/listing/register-form/sections/BasicInfoSection.tsx \
        src/__tests__/components/register-form-keywords-section.test.tsx
git commit -m "feat(register-form): KeywordsSection + PlatformExtraOptions

쿠팡 전용 브랜드/배송사/세금/상품정보고시는 BasicInfoSection 하단의
접힘 영역(PlatformExtraOptions)으로 분리."
```

---

## Task 9: `RegisterFormSections` 컨테이너 + 액션 바

6 섹션 + 미리보기 카드 + 등록 액션 버튼을 통합하는 최상위 컴포넌트.

**Files:**
- Create: `src/components/listing/register-form/index.tsx`
- Test: `src/__tests__/components/register-form-sections.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/__tests__/components/register-form-sections.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RegisterFormSections from '@/components/listing/register-form';

describe('RegisterFormSections', () => {
  it('6개 섹션 헤더가 모두 노출된다', () => {
    render(<RegisterFormSections onSuccess={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('기본정보')).toBeInTheDocument();
    expect(screen.getByText('가격/재고')).toBeInTheDocument();
    expect(screen.getByText('이미지')).toBeInTheDocument();
    expect(screen.getByText('상세설명')).toBeInTheDocument();
    expect(screen.getByText('배송')).toBeInTheDocument();
    expect(screen.getByText(/검색어/)).toBeInTheDocument();
  });

  it('등록/등록 정보 확인/취소 버튼이 노출된다', () => {
    render(<RegisterFormSections onSuccess={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: /등록 정보 확인/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^등록$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /취소/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement RegisterFormSections**

```tsx
// src/components/listing/register-form/index.tsx
'use client';

import React from 'react';
import Section from './Section';
import BasicInfoSection from './sections/BasicInfoSection';
import PricingSection from './sections/PricingSection';
import ImagesSection from './sections/ImagesSection';
import DescriptionSection from './sections/DescriptionSection';
import DeliverySection from './sections/DeliverySection';
import KeywordsSection from './sections/KeywordsSection';
import { useRegisterForm } from '@/hooks/useRegisterForm';
import { C } from '@/lib/design-tokens';

interface Props {
  onSuccess: () => void;
  onCancel: () => void;
}

export default function RegisterFormSections({ onSuccess, onCancel }: Props) {
  const { handleSubmit, handlePreview, isPreviewing, bothRegistration, resetBothRegistration } = useRegisterForm();

  // BothRegisterForm의 useEffect (등록 성공 시 onSuccess 호출) 동일하게 이전
  React.useEffect(() => {
    if (
      bothRegistration.coupang.status === 'success' &&
      bothRegistration.naver.status === 'success'
    ) {
      onSuccess();
    }
  }, [bothRegistration, onSuccess]);

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <Section title="기본정보" required defaultOpen={true}><BasicInfoSection /></Section>
      <Section title="가격/재고" required defaultOpen={true}><PricingSection /></Section>
      <Section title="이미지" required defaultOpen={true}><ImagesSection /></Section>
      <Section title="상세설명" defaultOpen={false}><DescriptionSection /></Section>
      <Section title="배송" defaultOpen={false}><DeliverySection /></Section>
      <Section title="검색어/키워드" defaultOpen={false}><KeywordsSection /></Section>

      {/* 액션 바 */}
      <div style={{
        display: 'flex', gap: '8px', justifyContent: 'flex-end',
        padding: '16px 0', borderTop: `1px solid ${C.border}`,
      }}>
        <button
          type="button"
          onClick={() => { resetBothRegistration(); onCancel(); }}
          style={{ padding: '10px 20px', fontSize: '13px', fontWeight: 600,
                   backgroundColor: '#f3f3f3', color: C.text, border: `1px solid ${C.border}`,
                   borderRadius: '8px', cursor: 'pointer' }}
        >
          취소
        </button>
        <button
          type="button"
          onClick={handlePreview}
          disabled={isPreviewing}
          style={{ padding: '10px 20px', fontSize: '13px', fontWeight: 600,
                   backgroundColor: '#fff', color: C.accent, border: `1px solid ${C.accent}`,
                   borderRadius: '8px', cursor: 'pointer' }}
        >
          {isPreviewing ? '확인 중...' : '등록 정보 확인'}
        </button>
        <button
          type="submit"
          style={{ padding: '10px 28px', fontSize: '13px', fontWeight: 700,
                   backgroundColor: C.accent, color: '#fff', border: 'none',
                   borderRadius: '8px', cursor: 'pointer' }}
        >
          등록
        </button>
      </div>

      {/* 등록 진행 상태 카드 — BothRegisterForm 라인 ~1620-1750 그대로 이전 */}
      {/* coupang/naver 진행 상태 표시 */}
    </form>
  );
}
```

- [ ] **Step 3: Run test + smoke**

```bash
npx vitest run src/__tests__/components/register-form-sections.test.tsx
npx tsc --noEmit
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/listing/register-form/index.tsx \
        src/__tests__/components/register-form-sections.test.tsx
git commit -m "feat(register-form): RegisterFormSections 컨테이너 + 액션 바

6 섹션 아코디언 + 등록 정보 확인/등록/취소 버튼 통합."
```

---

## Task 10: Step3에서 BothRegisterForm을 RegisterFormSections로 교체

**Files:**
- Modify: `src/components/listing/workflow/Step3ReviewRegister.tsx`

- [ ] **Step 1: Replace import + JSX**

`src/components/listing/workflow/Step3ReviewRegister.tsx`에서:

```typescript
// 변경 전
import BothRegisterForm from '@/components/listing/BothRegisterForm';

// 변경 후
import RegisterFormSections from '@/components/listing/register-form';
```

JSX 안의 `<BothRegisterForm onSuccess={handleRegistered} onCancel={...} />` 호출을 다음으로 교체:

```tsx
<RegisterFormSections
  onSuccess={handleRegistered}
  onCancel={() => setShowRegisterForm(false)}
/>
```

> **prefill prop**: 기존에 BothRegisterForm은 `prefill` prop을 받았다. Phase 1에서 도매꾹 흐름이 폐기됐으므로 `prefill`은 더 이상 전달되지 않는다. 코드에서 `prefill` 관련 분기를 모두 제거해도 안전.

- [ ] **Step 2: Smoke test in browser**

```bash
npm run dev
# 1. /listing → AI 상품 등록 → URL 입력 → AI 처리 → Step3 진입
# 2. 6 섹션이 모두 노출되는지 확인
# 3. 입력 후 등록 정보 확인 → 미리보기 응답 확인
# 4. 등록 버튼 → 진행 상태 카드 노출 + 성공 시 다음 화면
```

수동 검증 통과 후에만 다음 task로.

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
npx tsc --noEmit
npm run lint
```

Expected: 모두 통과.

- [ ] **Step 4: Commit**

```bash
git add src/components/listing/workflow/Step3ReviewRegister.tsx
git commit -m "feat(step3): BothRegisterForm을 RegisterFormSections로 교체

6 섹션 아코디언 폼 적용. BothRegisterForm은 다음 task에서 삭제."
```

---

## Task 11: BothRegisterForm 삭제 + 회귀 가드

**Files:**
- Delete: `src/components/listing/BothRegisterForm.tsx`
- Verify: 다른 파일에서의 모든 import 제거 확인

- [ ] **Step 1: Search for remaining usages**

```bash
grep -rn "BothRegisterForm\|DomeggookPrepareData" src/ --include="*.ts" --include="*.tsx"
```

Expected: 결과 없음 (Phase 1에서 ListingDashboard import 제거, Phase 2 Task 10에서 Step3 import 제거됨)

만약 다른 파일에 아직 의존이 있으면 그 파일들도 함께 정리.

- [ ] **Step 2: Delete file**

```bash
git rm src/components/listing/BothRegisterForm.tsx
```

- [ ] **Step 3: Full regression**

```bash
npx vitest run
npx tsc --noEmit
npm run lint
npm run build
```

Expected: 모두 통과.

- [ ] **Step 4: Browser smoke test (전체 흐름)**

```bash
npm run dev
# 1. /listing → AI 상품 등록 → URL 입력 → 처리 → Step3 6섹션 등록까지 happy path
# 2. /listing?tab=browse → 내 상품 조회 (Phase 1)
# 3. /listing?tab=assets → 자산 생성 + 저장 (Phase 1)
# 4. /listing/auto-register 직접 진입 → 페이지 여전히 동작
```

문제 없으면 다음 단계.

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "chore(listing): BothRegisterForm 삭제

6 섹션 아코디언 폼으로 완전 교체. 1,905줄 컴포넌트 제거.
관련 의존(DomeggookPrepareData 타입 등) 모두 정리."
```

---

## Task 12 (선택): `/listing/auto-register` 라우트 정리 결정

이 task는 사용자/PM 결정 후 진행. Phase 1에서 라우트 유지로 결정했으나, Phase 2 완료 후 6 섹션 폼이 안정화되면 6-step 위저드는 사실상 중복.

- [ ] **Step 1: PM 결정 받기**

다음 중 하나를 사용자에게 확인:
- A. 라우트와 코드 모두 삭제 (`src/app/listing/auto-register/`, `src/components/listing/auto-register/`)
- B. 라우트만 유지하고 페이지 안에 "지원 종료 — 메인 페이지 사용" 안내 표시
- C. 그대로 둠 (실험/참조용)

- [ ] **Step 2: 결정에 따라 작업**

A 선택 시:
```bash
git rm -r src/app/listing/auto-register/
git rm -r src/components/listing/auto-register/
```

B 선택 시: `page.tsx`를 안내 페이지로 교체.

C 선택 시: 작업 없음, task 종료.

- [ ] **Step 3: Commit (작업이 있는 경우)**

```bash
git add -u
git commit -m "chore(listing): /listing/auto-register 정리"
```

---

## Self-Review Notes (자체 점검)

**Spec 커버리지:**
- ✅ Step3 6 섹션 아코디언 → Task 3-9
- ✅ BothRegisterForm 폐기 → Task 10, 11
- ✅ 등록 로직 분리 (useRegisterForm) → Task 2
- ✅ Section 공용화 → Task 1
- ✅ 좌측 미리보기 유지(Step3) → Task 10에서 우측만 교체
- ✅ 플랫폼별 추가 옵션 처리 → Task 8 (PlatformExtraOptions, BasicInfoSection 하단)
- ⏸ 자산 탭에서 만든 자산을 "AI 상품 등록"에서 불러오기 — **Phase 3로 분리** (필요 시)
- ⏸ `/listing/auto-register` 정리 — Task 12 (사용자 결정 필요)

**타입/계약 일관성:**
- `useRegisterForm` 반환 타입이 모든 섹션에서 일관되게 사용되어야 함 — Task 2 작성 시 명확히 정의.
- `Section` 컴포넌트의 props (`title`, `required`, `defaultOpen`, `children`)는 Task 1, 9에서 동일.
- API 라우트 변경 없음 (BothRegisterForm이 호출하던 `/api/listing/both`, `/api/listing/coupang/categories`, `/api/listing/naver/categories`는 그대로 사용).

**플레이스홀더 스캔:**
- "TBD"/"TODO" 없음.
- 일부 "..."(BothRegisterForm 라인 X-Y 그대로) 표기는 작업자가 원본을 참조해 옮기는 것을 명시. 분량 축소 위함.
- Task 12는 의도적으로 사용자 결정 의존이라고 명시.

**위험 관리:**
- Task 10에서 Step3 교체 후 반드시 브라우저 스모크 테스트.
- Task 11에서 BothRegisterForm 삭제는 grep으로 의존 확인 후에만.
- 각 섹션 옮길 때 동작 변경 금지 — 단순 추출이 원칙.

---

## Phase 3 (가능성)

Phase 2 완료 후 추가 가능한 항목:
1. 자산 탭(Phase 1)에서 생성한 자산을 AI 상품 등록 Step3에서 "기존 자산 불러오기"로 사용
2. AI 상품 등록의 다중 URL 큐 처리 (spec의 "B 옵션")
3. `/listing/auto-register` 6-step 위저드 완전 정리 (Task 12 결정에 따라)
