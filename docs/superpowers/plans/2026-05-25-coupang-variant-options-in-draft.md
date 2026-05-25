# Coupang Draft Variant Options Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `CoupangAutoRegisterPanel`의 드래프트 저장 시 `sharedDraft.options`(M/L 사이즈 등)를 `variants` 필드로 변환하여 포함시킴으로써, 제출 시 쿠팡에 사이즈별 item이 정상 등록되도록 수정

**Architecture:** `buildCurrentDraftData()` 내에 `buildVariantsFromOptions()` 헬퍼를 추가하여 `ProductOptions`의 `enabled=true` variants를 `DraftVariant[]` 포맷으로 변환. submit route(`drafts/[id]/submit/route.ts`)는 이미 `d.variants`를 처리하므로 변경 불필요. 패널 UI에는 "등록될 옵션 N개" 요약 섹션 추가.

**Tech Stack:** React, TypeScript, Zustand, Vitest

---

## 버그 컨텍스트

- **루트 원인:** `CoupangAutoRegisterPanel.buildCurrentDraftData()`가 `sharedDraft.options`를 draft에 포함하지 않음
- **영향:** `/api/listing/coupang/drafts/[id]/submit/route.ts` 281번 줄에서 `d.variants`가 null → 단일 item으로 등록 (사이즈 구분 없음)
- **수정 필요 파일:** `src/components/listing/workflow/CoupangAutoRegisterPanel.tsx` 1개
- **수정 불필요:** submit route, option-parser, payload-mappers, useListingStore

---

## 파일 구조

| 파일 | 변경 | 설명 |
|------|------|------|
| `src/components/listing/workflow/CoupangAutoRegisterPanel.tsx` | **Modify** | `buildVariantsFromOptions()` 추출 + `buildCurrentDraftData()` 수정 + 옵션 요약 UI 추가 |
| `src/__tests__/components/coupang-auto-register-variants.test.ts` | **Create** | `buildVariantsFromOptions()` 단위 테스트 |

---

## Task 1: `buildVariantsFromOptions` 헬퍼 추출 및 테스트

**Files:**
- Modify: `src/components/listing/workflow/CoupangAutoRegisterPanel.tsx` (파일 상단 export 함수 추가)
- Create: `src/__tests__/components/coupang-auto-register-variants.test.ts`

- [ ] **Step 1: 테스트 파일 작성 (실패 상태)**

파일 `src/__tests__/components/coupang-auto-register-variants.test.ts` 생성:

```typescript
import { describe, it, expect } from 'vitest';
import { buildVariantsFromOptions } from '@/components/listing/workflow/CoupangAutoRegisterPanel';
import type { ProductOptions } from '@/types/product-option';

// 헬퍼: 기본 옵션 픽스처 생성
function makeOptions(overrides?: Partial<ProductOptions>): ProductOptions {
  return {
    hasOptions: true,
    groups: [{ order: 0, groupName: '사이즈', values: ['M', 'L'] }],
    variants: [
      {
        variantId: 'v_00',
        optionValues: ['M'],
        sourceHash: 'hash1',
        costPrice: 30000,
        salePrices: { coupang: 20000, naver: 19000 },
        stock: 50,
        soldOut: false,
        hidden: false,
        enabled: true,
      },
      {
        variantId: 'v_01',
        optionValues: ['L'],
        sourceHash: 'hash2',
        costPrice: 30000,
        salePrices: { coupang: 21000, naver: 20000 },
        stock: 30,
        soldOut: false,
        hidden: false,
        enabled: true,
      },
    ],
    ...overrides,
  };
}

describe('buildVariantsFromOptions', () => {
  it('options가 null이면 undefined 반환', () => {
    expect(buildVariantsFromOptions(null)).toBeUndefined();
  });

  it('options가 undefined이면 undefined 반환', () => {
    expect(buildVariantsFromOptions(undefined)).toBeUndefined();
  });

  it('enabled variant가 없으면 undefined 반환', () => {
    const options = makeOptions({
      variants: [
        {
          variantId: 'v_00',
          optionValues: ['M'],
          sourceHash: null,
          costPrice: 30000,
          salePrices: { coupang: 20000, naver: 19000 },
          stock: 0,
          soldOut: true,
          hidden: false,
          enabled: false,
        },
      ],
    });
    expect(buildVariantsFromOptions(options)).toBeUndefined();
  });

  it('enabled variants를 DraftVariant[]로 변환한다', () => {
    const options = makeOptions();
    const result = buildVariantsFromOptions(options);

    expect(result).toHaveLength(2);

    expect(result![0]).toEqual({
      itemName: 'M',
      attributes: [{ attributeTypeName: '사이즈', attributeValueName: 'M' }],
      salePrice: 20000,
      originalPrice: 25000, // ceil(20000 * 1.25 / 1000) * 1000 = 25000
      stock: 50,
    });

    expect(result![1]).toEqual({
      itemName: 'L',
      attributes: [{ attributeTypeName: '사이즈', attributeValueName: 'L' }],
      salePrice: 21000,
      originalPrice: 27000, // ceil(21000 * 1.25 / 1000) * 1000 = 27000 (26250 → 1000단위 올림)
      stock: 30,
    });
  });

  it('enabled=false인 variant는 제외한다', () => {
    const options = makeOptions({
      variants: [
        {
          variantId: 'v_00',
          optionValues: ['M'],
          sourceHash: null,
          costPrice: 30000,
          salePrices: { coupang: 20000, naver: 19000 },
          stock: 50,
          soldOut: false,
          hidden: false,
          enabled: true,
        },
        {
          variantId: 'v_01',
          optionValues: ['L'],
          sourceHash: null,
          costPrice: 30000,
          salePrices: { coupang: 21000, naver: 20000 },
          stock: 0,
          soldOut: true,
          hidden: false,
          enabled: false,
        },
      ],
    });
    const result = buildVariantsFromOptions(options);
    expect(result).toHaveLength(1);
    expect(result![0].itemName).toBe('M');
  });

  it('2축 옵션(색상+사이즈)의 itemName은 슬래시로 조합된다', () => {
    const options: ProductOptions = {
      hasOptions: true,
      groups: [
        { order: 0, groupName: '색상', values: ['블랙', '화이트'] },
        { order: 1, groupName: '사이즈', values: ['M', 'L'] },
      ],
      variants: [
        {
          variantId: 'v_00_00',
          optionValues: ['블랙', 'M'],
          sourceHash: null,
          costPrice: 30000,
          salePrices: { coupang: 20000, naver: 19000 },
          stock: 50,
          soldOut: false,
          hidden: false,
          enabled: true,
        },
      ],
    };
    const result = buildVariantsFromOptions(options);
    expect(result![0].itemName).toBe('블랙/M');
    expect(result![0].attributes).toEqual([
      { attributeTypeName: '색상', attributeValueName: '블랙' },
      { attributeTypeName: '사이즈', attributeValueName: 'M' },
    ]);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/components/coupang-auto-register-variants.test.ts
```

예상 결과: `Error: buildVariantsFromOptions is not exported from ...`

- [ ] **Step 3: `buildVariantsFromOptions` 함수를 `CoupangAutoRegisterPanel.tsx`에 추가**

`src/components/listing/workflow/CoupangAutoRegisterPanel.tsx` 상단(import 블록 직후, `DraftFormState` 인터페이스 앞)에 추가:

```typescript
import type { ProductOptions } from '@/types/product-option';

// ─── buildVariantsFromOptions: ProductOptions → DraftVariant[] 변환 ──────────

export interface DraftVariant {
  itemName: string;
  attributes: { attributeTypeName: string; attributeValueName: string }[];
  salePrice: number;
  originalPrice: number;
  stock: number;
}

/**
 * ProductOptions의 enabled variants를 쿠팡 draft에 저장 가능한 DraftVariant[] 포맷으로 변환.
 * enabled variant가 없거나 options가 없으면 undefined 반환 → 단일 item으로 등록됨.
 */
export function buildVariantsFromOptions(
  options: ProductOptions | null | undefined,
): DraftVariant[] | undefined {
  if (!options) return undefined;
  const enabled = options.variants.filter((v) => v.enabled);
  if (enabled.length === 0) return undefined;
  return enabled.map((v) => ({
    itemName: v.optionValues.join('/'),
    attributes: options.groups.map((g, i) => ({
      attributeTypeName: g.groupName,
      attributeValueName: v.optionValues[i] ?? '',
    })),
    salePrice: v.salePrices.coupang,
    originalPrice: Math.ceil((v.salePrices.coupang * 1.25) / 1000) * 1000,
    stock: v.stock,
  }));
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/components/coupang-auto-register-variants.test.ts
```

예상 결과: `5 tests passed`

- [ ] **Step 5: 커밋**

```bash
git add src/components/listing/workflow/CoupangAutoRegisterPanel.tsx \
        src/__tests__/components/coupang-auto-register-variants.test.ts
git commit -m "feat: buildVariantsFromOptions 헬퍼 추출 — ProductOptions → DraftVariant[] 변환"
```

---

## Task 2: `buildCurrentDraftData()`에 variants 포함

**Files:**
- Modify: `src/components/listing/workflow/CoupangAutoRegisterPanel.tsx` — `buildCurrentDraftData()` 수정

- [ ] **Step 1: `buildCurrentDraftData()` 함수 수정**

`CoupangAutoRegisterPanel.tsx`의 `buildCurrentDraftData()` 함수(현재 약 318번 줄)를 다음과 같이 수정:

**수정 전:**
```typescript
function buildCurrentDraftData() {
  const detailImages = sharedDraft.pickedDetailImages.length > 0
    ? sharedDraft.pickedDetailImages
    : sharedDraft.detailImages;
  return {
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
}
```

**수정 후:**
```typescript
function buildCurrentDraftData() {
  const detailImages = sharedDraft.pickedDetailImages.length > 0
    ? sharedDraft.pickedDetailImages
    : sharedDraft.detailImages;
  const variants = buildVariantsFromOptions(sharedDraft.options);
  return {
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
    ...(variants ? { variants } : {}),
  };
}
```

- [ ] **Step 2: 전체 테스트 통과 확인**

```bash
npx vitest run src/__tests__/components/coupang-auto-register-variants.test.ts
```

예상 결과: `5 tests passed`

- [ ] **Step 3: 타입 에러 없음 확인**

```bash
npx tsc --noEmit 2>&1 | grep -i "CoupangAutoRegisterPanel\|buildVariants\|DraftVariant" | head -20
```

예상 결과: 출력 없음 (에러 없음)

- [ ] **Step 4: 커밋**

```bash
git add src/components/listing/workflow/CoupangAutoRegisterPanel.tsx
git commit -m "fix: 쿠팡 드래프트 저장 시 사이즈 옵션(variants) 누락 버그 수정"
```

---

## Task 3: 패널 UI에 "등록될 옵션" 요약 섹션 추가

**Files:**
- Modify: `src/components/listing/workflow/CoupangAutoRegisterPanel.tsx` — JSX 섹션 추가

- [ ] **Step 1: 옵션 요약 섹션 추가**

`CoupangAutoRegisterPanel.tsx`의 JSX 내 `{/* ── 섹션 3: 가격·재고 */}` 블록 바로 아래(섹션 5 고시정보 블록 위)에 아래 코드를 추가:

```tsx
{/* ── 섹션 4: 등록될 옵션 (sharedDraft.options가 있을 때만 표시) ────────────── */}
{(() => {
  const variants = buildVariantsFromOptions(sharedDraft.options);
  if (!variants) return null;
  return (
    <div style={section}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={sectionTitle}>등록될 옵션 ({variants.length}가지)</p>
        <span style={{ fontSize: '11px', color: '#15803d', fontWeight: 600 }}>
          ✓ 사이즈별 item 생성됨
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {variants.map((v) => (
          <span
            key={v.itemName}
            style={{
              padding: '4px 10px',
              backgroundColor: '#f0fdf4',
              border: '1px solid #86efac',
              borderRadius: '100px',
              fontSize: '12px',
              color: '#15803d',
              fontWeight: 600,
            }}
          >
            {v.itemName}
            <span style={{ marginLeft: '5px', fontWeight: 400, color: '#6b7280' }}>
              {v.salePrice.toLocaleString()}원
            </span>
          </span>
        ))}
      </div>
      <p style={{ fontSize: '11px', color: C.textSub, margin: 0 }}>
        OptionEditor에서 비활성화한 옵션은 등록되지 않습니다.
      </p>
    </div>
  );
})()}
```

- [ ] **Step 2: 전체 테스트 통과 확인**

```bash
npx vitest run
```

예상 결과: 기존 테스트 포함 전체 통과

- [ ] **Step 3: 타입 에러 없음 확인**

```bash
npx tsc --noEmit 2>&1 | head -30
```

예상 결과: 출력 없음 또는 기존 에러만 (새로운 에러 없음)

- [ ] **Step 4: 커밋**

```bash
git add src/components/listing/workflow/CoupangAutoRegisterPanel.tsx
git commit -m "feat: 쿠팡 등록 패널에 '등록될 옵션' 요약 섹션 추가 — M/L 사이즈 확인 가능"
```

---

## 검증

### 기능 확인

1. **도매꾹 상품 등록 플로우** (옵션 있는 상품):
   - Step 1에서 상품 URL 입력 및 옵션 로드
   - Step 3 CoupangAutoRegisterPanel에서 "등록될 옵션" 섹션에 M, L 배지 표시 확인
   - 임시저장 후 Supabase `coupang_drafts` 테이블의 `draft_data.variants` 필드 존재 확인
   - 제출 시 쿠팡 Wing에서 사이즈별 item 등록 확인

2. **옵션 없는 상품**:
   - "등록될 옵션" 섹션 미표시 확인
   - 단일 item으로 정상 등록 확인

3. **모든 variant가 disabled인 경우**:
   - "등록될 옵션" 섹션 미표시 확인
   - 단일 item으로 정상 등록 확인

### 단위 테스트

```bash
npx vitest run src/__tests__/components/coupang-auto-register-variants.test.ts
```

예상: 5 tests passed
