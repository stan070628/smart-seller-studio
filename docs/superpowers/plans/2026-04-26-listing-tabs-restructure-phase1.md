# 상품등록탭 재편 — Phase 1 (탭 구조 + Step1 단순화 + 자산 탭) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/listing` 페이지의 진입점을 탭 3개(`AI 상품 등록` / `내 상품 조회` / `썸네일·상세만 만들기`)로 재편하고, Step1을 URL 입력 전용으로 단순화하며, 자산만 생성하는 신규 탭을 추가한다.

**Architecture:** Zustand `listingMode` 타입을 `'register' | 'browse' | 'assets'`로 변경, URL `?tab=` 파라미터로 동기화. Step1SourceSelect는 URL 입력 전용으로 축소. 신규 탭은 별도 컴포넌트 디렉터리(`components/listing/assets/`)와 신규 API 2개(`/api/listing/assets/generate`, `/api/listing/assets/save`) + Supabase 신규 테이블 `generated_assets`. BothRegisterForm/Step3 6섹션 리팩터링은 **이번 plan에서 범위 외** — Phase 2로 분리.

**Tech Stack:** Next.js 16 App Router, React 19, Zustand, Supabase (Postgres + Storage), Vitest, React Testing Library, Sharp(자산 처리), Claude/Gemini API(기존 `/api/auto-register/parse-url` + `/api/ai/generate-detail-html` 재사용).

**참조 spec:** `docs/superpowers/specs/2026-04-26-listing-tabs-restructure-design.md`

---

## File Structure

### 신규 파일

```
src/components/listing/assets/
  AssetsTab.tsx                              # 탭 컨테이너
  AssetsInputPanel.tsx                       # URL/업로드 토글 + 입력
  AssetsResultPanel.tsx                      # 미리보기 + 다운로드/저장 액션

src/app/api/listing/assets/generate/route.ts # 자산 생성 API
src/app/api/listing/assets/save/route.ts     # Supabase 저장 API

supabase/migrations/038_generated_assets.sql # 신규 테이블

src/__tests__/store/listing-mode.test.ts
src/__tests__/components/step1-url-only.test.tsx
src/__tests__/components/assets-tab.test.tsx
src/__tests__/api/listing-assets-save.test.ts
```

### 수정 파일

```
src/store/useListingStore.ts                 # listingMode 타입, assetsDraft 슬라이스
src/components/listing/ListingDashboard.tsx  # 탭 토글 변경, URL 동기화, 헤더 버튼/bulk 분기 제거
src/components/listing/workflow/Step1SourceSelect.tsx  # URL 입력 전용으로 축소
```

### 진입점만 끊고 코드 유지

```
src/components/listing/BulkImportPanel.tsx        # ListingDashboard에서 import만 제거
src/components/listing/DomeggookPreparePanel.tsx  # 동일
src/components/listing/BothRegisterForm.tsx       # Step3에서는 계속 사용 (Phase 2에서 폐기)
src/app/listing/auto-register/page.tsx            # 라우트 유지, 진입 버튼만 제거
```

---

## Task 1: useListingStore — listingMode 타입 변경 (`'bulk'` → `'assets'`)

**Files:**
- Modify: `src/store/useListingStore.ts:180-181, 294, 300`
- Test: `src/__tests__/store/listing-mode.test.ts`

- [ ] **Step 1: Write the failing test**

새 파일 `src/__tests__/store/listing-mode.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useListingStore } from '@/store/useListingStore';

describe('useListingStore — listingMode', () => {
  beforeEach(() => {
    useListingStore.setState({ listingMode: 'register' });
  });

  it('기본값은 register', () => {
    expect(useListingStore.getState().listingMode).toBe('register');
  });

  it("'browse'로 전환 가능", () => {
    useListingStore.getState().setListingMode('browse');
    expect(useListingStore.getState().listingMode).toBe('browse');
  });

  it("'assets'로 전환 가능", () => {
    useListingStore.getState().setListingMode('assets');
    expect(useListingStore.getState().listingMode).toBe('assets');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/store/listing-mode.test.ts`
Expected: FAIL — `'assets'` 타입 에러 또는 `setListingMode('assets')` 호출 시 타입 거부

- [ ] **Step 3: Update store types**

`src/store/useListingStore.ts:180-181` (interface ListingStore 안):

```typescript
  listingMode: 'register' | 'browse' | 'assets';
  setListingMode: (mode: 'register' | 'browse' | 'assets') => void;
```

(2곳의 `'bulk'` → `'assets'`로 단순 치환)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/store/listing-mode.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/useListingStore.ts src/__tests__/store/listing-mode.test.ts
git commit -m "refactor(store): listingMode 타입 'bulk' → 'assets' 변경"
```

---

## Task 2: ListingDashboard — 탭 토글 변경 + URL 동기화 + bulk 분기 제거

**Files:**
- Modify: `src/components/listing/ListingDashboard.tsx`
  - Import 제거: line 18 (`BothRegisterForm`), 19 (`DomeggookPreparePanel`), 26 (`BulkImportPanel`)
  - 헤더 우측 `🤖 URL 자동등록` Link 제거: line 2477-2496
  - 모드 토글 영역 교체: line 2511-2575
  - 본문 분기 교체: line 2578-2652
  - URL 동기화 useEffect 추가: line 2384-2390 영역

- [ ] **Step 1: Write the failing test (URL 동기화)**

새 파일 일부 추가 — `src/__tests__/components/listing-dashboard-tabs.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const replaceMock = vi.fn();
const searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  usePathname: () => '/listing',
}));

import ListingDashboard from '@/components/listing/ListingDashboard';

describe('ListingDashboard — 탭 구조', () => {
  beforeEach(() => {
    replaceMock.mockClear();
    for (const k of Array.from(searchParams.keys())) searchParams.delete(k);
  });

  it('탭 3개가 렌더된다', () => {
    render(<ListingDashboard />);
    expect(screen.getByRole('button', { name: /AI 상품 등록/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /내 상품 조회/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /썸네일.*상세만 만들기/ })).toBeInTheDocument();
  });

  it("탭 클릭 시 URL ?tab= 파라미터로 동기화된다", () => {
    render(<ListingDashboard />);
    fireEvent.click(screen.getByRole('button', { name: /내 상품 조회/ }));
    expect(replaceMock).toHaveBeenCalledWith('/listing?tab=browse', { scroll: false });
  });

  it('헤더 우측의 URL 자동등록 버튼은 더 이상 존재하지 않는다', () => {
    render(<ListingDashboard />);
    expect(screen.queryByText(/URL 자동등록/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/components/listing-dashboard-tabs.test.tsx`
Expected: FAIL — 현재는 4개 토글(`+ 새 상품 등록`/`📋 내 상품 조회`/`대량 등록`/헤더 `URL 자동등록`)

- [ ] **Step 3: Remove unused imports**

`src/components/listing/ListingDashboard.tsx:18-26`에서 다음 import 제거:

```typescript
// 제거
import BothRegisterForm from '@/components/listing/BothRegisterForm';
import DomeggookPreparePanel from '@/components/listing/DomeggookPreparePanel';
import BulkImportPanel from '@/components/listing/BulkImportPanel';
```

(주의: `BothRegisterForm`은 Step3에서 계속 사용 — `Step3ReviewRegister.tsx` 안의 import는 유지)

- [ ] **Step 4: Add URL sync useEffect + replace tab toggle markup**

`src/components/listing/ListingDashboard.tsx`의 `ListingDashboard` 함수 안:

```typescript
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
// ↑ 이미 useSearchParams는 import 되어 있음. useRouter, usePathname 추가

// 함수 본문 상단:
const router = useRouter();
const pathname = usePathname();

useEffect(() => {
  const tab = searchParams.get('tab');
  if (tab === 'browse' || tab === 'assets' || tab === 'register') {
    setListingMode(tab);
  }
}, [searchParams, setListingMode]);

// setListingMode 직접 호출 대신 URL과 함께 갱신하는 헬퍼:
const goTab = (mode: 'register' | 'browse' | 'assets') => {
  setListingMode(mode);
  const params = new URLSearchParams(Array.from(searchParams.entries()));
  if (mode === 'register') params.delete('tab');
  else params.set('tab', mode);
  const qs = params.toString();
  router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
};
```

기존 모드 토글 마크업(line 2511-2575) 전체를 다음으로 교체:

```tsx
<div
  style={{
    display: 'flex',
    gap: '4px',
    marginBottom: '20px',
    padding: '4px',
    backgroundColor: '#f3f3f3',
    borderRadius: '10px',
    width: 'fit-content',
  }}
>
  {([
    { id: 'register', label: 'AI 상품 등록' },
    { id: 'browse', label: '내 상품 조회' },
    { id: 'assets', label: '썸네일·상세만 만들기' },
  ] as const).map((tab) => {
    const isActive = listingMode === tab.id;
    return (
      <button
        key={tab.id}
        onClick={() => goTab(tab.id)}
        style={{
          padding: '7px 18px',
          fontSize: '13px',
          fontWeight: isActive ? 700 : 500,
          borderRadius: '7px',
          border: 'none',
          cursor: 'pointer',
          backgroundColor: isActive ? '#fff' : 'transparent',
          color: isActive ? C.text : C.textSub,
          boxShadow: isActive ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
        }}
      >
        {tab.label}
      </button>
    );
  })}
</div>
```

- [ ] **Step 5: Replace mode-branching block + remove header button**

`src/components/listing/ListingDashboard.tsx:2578-2652`의 분기를 다음으로 교체:

```tsx
{listingMode === 'register' ? (
  <>
    {/* StepIndicator + 이전 단계로/새로 시작 버튼 — 기존 그대로 유지 */}
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0' }}>
      <div style={{ flex: 1 }}>
        <StepIndicator
          currentStep={currentStep}
          onStepClick={(step) => { if (step < currentStep) setCurrentStep(step); }}
        />
      </div>
      {/* 기존 새로 시작/이전 단계로 버튼 그대로 유지 (line 2590-2642) */}
    </div>
    {currentStep === 1 && <Step1SourceSelect />}
    {currentStep === 2 && <Step2Processing />}
    {currentStep === 3 && <Step3ReviewRegister />}
  </>
) : listingMode === 'assets' ? (
  <AssetsTab />
) : (
  <BrowseMode />
)}
```

`AssetsTab` import 추가 (Task 10에서 만들지만, 임시로 placeholder 컴포넌트):

```tsx
// import 영역
import AssetsTab from '@/components/listing/assets/AssetsTab';
```

placeholder 파일 임시 생성: `src/components/listing/assets/AssetsTab.tsx`

```tsx
'use client';
export default function AssetsTab() {
  return <div>썸네일·상세만 만들기 — 곧 구현됩니다</div>;
}
```

헤더 우측 `<Link href="/listing/auto-register">` 영역(line 2477-2496) **전체 제거**.

- [ ] **Step 6: Run test to verify it passes + smoke type check**

```bash
npx vitest run src/__tests__/components/listing-dashboard-tabs.test.tsx
npx tsc --noEmit
```

Expected: 테스트 PASS, 타입 에러 없음.

- [ ] **Step 7: Commit**

```bash
git add src/components/listing/ListingDashboard.tsx \
        src/components/listing/assets/AssetsTab.tsx \
        src/__tests__/components/listing-dashboard-tabs.test.tsx
git commit -m "feat(listing): 상위 탭 3개 + URL 동기화로 재편

- 탭: AI 상품 등록 / 내 상품 조회 / 썸네일·상세만 만들기
- ?tab= 파라미터로 URL 동기화
- 헤더 우측 URL 자동등록 버튼 제거
- bulk/도매꾹/BothRegisterForm 진입점 제거"
```

---

## Task 3: Step1SourceSelect — URL 입력 전용으로 축소

**Files:**
- Modify: `src/components/listing/workflow/Step1SourceSelect.tsx` (전면 축소)
- Test: `src/__tests__/components/step1-url-only.test.tsx`

기존 Step1은 ① 썸네일 만들기 ② 상품 상세 만들기(이미지/URL 두 탭) ③ 상품 기본 정보 + 가격 계산기로 구성. 이번 단계에서는 ②의 "URL로 가져오기" 탭을 단독 노출하고 ①과 ③, 그리고 이미지 업로드 탭은 제거.

> **참고**: ③ 가격 계산기 기능을 잃지 않기 위해, 가격 계산은 Step3의 `BothRegisterForm` 안에서 이미 가능하다는 점을 확인. (사용자 결정: Step1 단순화 우선)

- [ ] **Step 1: Write the failing test**

`src/__tests__/components/step1-url-only.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Step1SourceSelect from '@/components/listing/workflow/Step1SourceSelect';
import { useListingStore } from '@/store/useListingStore';

describe('Step1SourceSelect — URL 입력 전용', () => {
  it('URL 입력 필드와 자동 처리 시작 버튼만 노출된다', () => {
    render(<Step1SourceSelect />);
    expect(screen.getByPlaceholderText(/https?:\/\//)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /자동 처리 시작/ })).toBeInTheDocument();
    // 제거된 항목
    expect(screen.queryByText(/썸네일 만들기/)).not.toBeInTheDocument();
    expect(screen.queryByText(/이미지로 만들기/)).not.toBeInTheDocument();
    expect(screen.queryByText(/상품 기본 정보/)).not.toBeInTheDocument();
  });

  it('빈 URL이면 버튼이 비활성화된다', () => {
    render(<Step1SourceSelect />);
    const btn = screen.getByRole('button', { name: /자동 처리 시작/ });
    expect(btn).toBeDisabled();
  });

  it('http(s)가 아닌 URL이면 에러를 표시하고 다음 단계로 가지 않는다', () => {
    const goNextStep = vi.fn();
    useListingStore.setState({ /* @ts-expect-error 부분 모킹 */ goNextStep });
    render(<Step1SourceSelect />);
    const input = screen.getByPlaceholderText(/https?:\/\//);
    fireEvent.change(input, { target: { value: 'invalid' } });
    fireEvent.click(screen.getByRole('button', { name: /자동 처리 시작/ }));
    expect(screen.getByText(/올바른 URL/)).toBeInTheDocument();
    expect(goNextStep).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/components/step1-url-only.test.tsx`
Expected: FAIL — 현재 Step1은 썸네일/상품정보 섹션이 노출됨

- [ ] **Step 3: Replace Step1SourceSelect with URL-only implementation**

`src/components/listing/workflow/Step1SourceSelect.tsx` **전체 교체**:

```tsx
'use client';

/**
 * Step1SourceSelect.tsx
 * Step 1 — URL 입력 전용
 * 사용자가 1개의 URL을 입력하면 백엔드가 source(쿠팡/도매꾹/코스트코 등)를 식별하여 파싱한다.
 */

import React, { useState } from 'react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  fontSize: '14px',
  border: `1px solid ${C.border}`,
  borderRadius: '10px',
  outline: 'none',
  color: C.text,
  backgroundColor: '#fff',
  boxSizing: 'border-box',
};

function isValidHttpUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function Step1SourceSelect() {
  const { sharedDraft, updateSharedDraft, goNextStep } = useListingStore();
  const [url, setUrl] = useState<string>(sharedDraft.name && /^https?:/.test(sharedDraft.name) ? sharedDraft.name : '');
  const [error, setError] = useState<string | null>(null);

  const canSubmit = url.trim().length > 0;

  const handleSubmit = () => {
    setError(null);
    if (!canSubmit) return;
    if (!isValidHttpUrl(url.trim())) {
      setError('올바른 URL 형식이 아닙니다 (http:// 또는 https://로 시작해야 합니다).');
      return;
    }
    // URL 자체는 워크플로우 메타에 임시 저장하지 않고 Step2가 직접 받는다.
    // 향후 sharedDraft에 sourceUrl 필드 추가 시 여기에 저장.
    updateSharedDraft({ name: url.trim() }); // 임시 placeholder — Step2/Step3에서 덮어씀
    goNextStep();
  };

  return (
    <div style={{
      maxWidth: '720px',
      margin: '40px auto',
      padding: '32px',
      backgroundColor: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: '14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
    }}>
      <div>
        <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: C.text }}>
          상품 URL 입력
        </h2>
        <p style={{ fontSize: '13px', color: C.textSub, margin: '6px 0 0' }}>
          상품 페이지 URL을 붙여넣으세요. 도매꾹·쿠팡·코스트코 등의 URL을 자동으로 인식합니다.
        </p>
      </div>

      <input
        type="url"
        style={inputStyle}
        value={url}
        onChange={(e) => { setUrl(e.target.value); setError(null); }}
        placeholder="https://"
        autoFocus
      />

      {error && (
        <div style={{
          padding: '10px 14px',
          backgroundColor: '#fee2e2',
          color: '#b91c1c',
          fontSize: '13px',
          borderRadius: '8px',
        }}>
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        style={{
          padding: '12px 20px',
          fontSize: '14px',
          fontWeight: 700,
          backgroundColor: canSubmit ? C.accent : C.border,
          color: canSubmit ? '#fff' : C.textSub,
          border: 'none',
          borderRadius: '10px',
          cursor: canSubmit ? 'pointer' : 'not-allowed',
        }}
      >
        자동 처리 시작
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes + type check**

```bash
npx vitest run src/__tests__/components/step1-url-only.test.tsx
npx tsc --noEmit
```

Expected: 테스트 PASS, 타입 에러 없음. (기존 Step1에서 사용되던 import — `AiEditModal`, `calcCoupangWing` 등은 더 이상 참조되지 않음. 다른 파일에서도 사용 중이라면 그대로 유지.)

- [ ] **Step 5: Commit**

```bash
git add src/components/listing/workflow/Step1SourceSelect.tsx \
        src/__tests__/components/step1-url-only.test.tsx
git commit -m "refactor(step1): URL 입력 전용으로 축소

- 썸네일 만들기/상품 기본정보/가격 계산기 섹션 제거
- 이미지/도매꾹 소스 옵션 제거
- 단일 URL 입력 + 자동 처리 시작 버튼만 노출"
```

---

## Task 4: Supabase 마이그레이션 — `038_generated_assets.sql`

**Files:**
- Create: `supabase/migrations/038_generated_assets.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- 038_generated_assets.sql
-- "썸네일·상세만 만들기" 탭에서 생성한 자산을 영구 보관

CREATE TABLE generated_assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type     text NOT NULL CHECK (source_type IN ('url', 'upload')),
  source_url      text,
  thumbnails      text[] NOT NULL DEFAULT '{}',
  detail_html     text,
  detail_image    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX generated_assets_user_created_idx
  ON generated_assets(user_id, created_at DESC);

ALTER TABLE generated_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "본인 데이터만"
  ON generated_assets
  FOR ALL
  USING (auth.uid() = user_id);
```

- [ ] **Step 2: Apply migration locally**

```bash
npx supabase db push
# 또는 사용자 환경: npx supabase migration up
```

Expected: `038_generated_assets.sql` 적용 완료, 에러 없음.

확인: `npx supabase db diff` 실행 시 차이 없음.

- [ ] **Step 3: Decide Storage bucket**

```bash
# Supabase Dashboard 또는 CLI로 listing 관련 기존 버킷 확인
npx supabase storage list
```

판단:
- 기존 `listing-assets`(또는 유사) 버킷이 있으면 **재사용**.
- 없으면 다음 SQL을 마이그레이션 끝에 추가하지 말고, Dashboard에서 `generated-assets` (public 또는 private) 신규 생성. (Storage 버킷은 SQL 마이그레이션이 아니라 UI/CLI 권장.)

이 결정을 다음 task의 API에서 사용할 버킷 이름으로 고정.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/038_generated_assets.sql
git commit -m "feat(db): generated_assets 테이블 신규 마이그레이션

자산만 생성하는 탭의 결과물을 user별로 영구 저장."
```

---

## Task 5: API — `POST /api/listing/assets/generate`

**Files:**
- Create: `src/app/api/listing/assets/generate/route.ts`

이 API는 입력(URL 또는 업로드 파일)을 받아 썸네일/상세 자산을 생성한다. URL 모드는 기존 `parseSourceUrl` + `generateDetailHtml` 흐름을 재사용. 업로드 모드는 받은 파일을 그대로 통과시키고(필요 시 Sharp으로 정규화) AI에 넘긴다.

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/listing/assets/generate/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { parseSourceUrl } from '@/lib/auto-register/url-parser';

const RequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('url'),
    url: z.string().url(),
  }),
  z.object({
    mode: z.literal('upload'),
    // base64 인코딩된 이미지 배열 (Step 1 범위: 단순 통과)
    images: z.array(z.string()).min(1),
    text: z.string().optional(),
  }),
]);

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const json = await req.json();
  const parsed = RequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.message },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.mode === 'url') {
      const sourceResult = await parseSourceUrl(parsed.data.url);
      // sourceResult에서 썸네일·상세 HTML 추출. 기존 parser 결과 형식에 맞춰 매핑.
      return NextResponse.json({
        success: true,
        data: {
          thumbnails: sourceResult.thumbnails ?? [],
          detailHtml: sourceResult.detailHtml ?? '',
          detailImage: null,
        },
      });
    }

    // upload 모드 — 받은 이미지를 그대로 반환 (1단계)
    return NextResponse.json({
      success: true,
      data: {
        thumbnails: parsed.data.images,
        detailHtml: parsed.data.text ? `<div>${parsed.data.text}</div>` : '',
        detailImage: null,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'unknown error' },
      { status: 500 },
    );
  }
}
```

> **메모**: `parseSourceUrl`의 실제 반환 형식에 맞게 `thumbnails`/`detailHtml` 키 매핑 조정 필요. Task 작업자는 `src/lib/auto-register/url-parser.ts`를 확인 후 정확한 필드를 사용한다.

- [ ] **Step 2: Smoke test (수동)**

```bash
# 개발 서버 기동
npm run dev

# 로그인된 세션 쿠키와 함께 호출
curl -X POST http://localhost:3000/api/listing/assets/generate \
  -H 'Content-Type: application/json' \
  --cookie "$(cat /tmp/test-cookie.txt)" \
  -d '{"mode":"url","url":"https://www.domeggook.com/main/item/itemDetail.do?itemNo=12345678"}'
```

Expected: `{ success: true, data: { thumbnails: [...], detailHtml: "...", detailImage: null } }`

(자동화된 테스트는 Task 6의 save API와 함께 작성한다. 이 generate API는 외부 의존이 많아 happy-path 단위 테스트가 어렵다 — 통합/E2E에서 검증.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/listing/assets/generate/route.ts
git commit -m "feat(api): POST /api/listing/assets/generate

URL 또는 업로드 이미지에서 썸네일·상세 자산을 생성."
```

---

## Task 6: API — `POST /api/listing/assets/save`

**Files:**
- Create: `src/app/api/listing/assets/save/route.ts`
- Test: `src/__tests__/api/listing-assets-save.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/api/listing-assets-save.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertMock = vi.fn();
const fromMock = vi.fn(() => ({ insert: insertMock, select: () => ({ single: () => ({ data: { id: 'uuid-x' }, error: null }) }) }));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabase: () => ({ from: fromMock }),
}));

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(async () => ({ userId: 'user-1' })),
}));

import { POST } from '@/app/api/listing/assets/save/route';

function makeReq(body: object) {
  return new Request('http://localhost/api/listing/assets/save', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/listing/assets/save', () => {
  beforeEach(() => {
    insertMock.mockReset();
    fromMock.mockClear();
    insertMock.mockReturnValue({
      select: () => ({ single: () => ({ data: { id: 'uuid-x' }, error: null }) }),
    });
  });

  it('필수 필드가 빠지면 400을 반환한다', async () => {
    const res = await POST(makeReq({}) as never);
    expect(res.status).toBe(400);
  });

  it('성공 시 generated_assets에 insert하고 id를 반환한다', async () => {
    const res = await POST(makeReq({
      sourceType: 'url',
      sourceUrl: 'https://x.com',
      thumbnails: ['t1.jpg'],
      detailHtml: '<div></div>',
    }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.id).toBe('uuid-x');
    expect(fromMock).toHaveBeenCalledWith('generated_assets');
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      source_type: 'url',
      source_url: 'https://x.com',
      thumbnails: ['t1.jpg'],
      detail_html: '<div></div>',
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/api/listing-assets-save.test.ts`
Expected: FAIL — route 파일 미존재

- [ ] **Step 3: Implement the route**

```typescript
// src/app/api/listing/assets/save/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { createServerSupabase } from '@/lib/supabase/server';

const RequestSchema = z.object({
  sourceType: z.enum(['url', 'upload']),
  sourceUrl: z.string().url().optional(),
  thumbnails: z.array(z.string()).default([]),
  detailHtml: z.string().optional(),
  detailImage: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const json = await req.json();
  const parsed = RequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.message },
      { status: 400 },
    );
  }

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('generated_assets')
    .insert({
      user_id: auth.userId,
      source_type: parsed.data.sourceType,
      source_url: parsed.data.sourceUrl ?? null,
      thumbnails: parsed.data.thumbnails,
      detail_html: parsed.data.detailHtml ?? null,
      detail_image: parsed.data.detailImage ?? null,
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ success: true, data: { id: data.id } });
}
```

> 만약 `@/lib/supabase/server`의 정확한 export 이름이 다르면, 기존 다른 route(예: `src/app/api/auto-register/save-corrections/route.ts`)에서 사용하는 패턴을 그대로 따른다.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/api/listing-assets-save.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/listing/assets/save/route.ts \
        src/__tests__/api/listing-assets-save.test.ts
git commit -m "feat(api): POST /api/listing/assets/save

생성된 자산 메타데이터를 generated_assets에 저장."
```

---

## Task 7: useListingStore — `assetsDraft` 슬라이스 추가

**Files:**
- Modify: `src/store/useListingStore.ts`

- [ ] **Step 1: Write the failing test**

`src/__tests__/store/listing-mode.test.ts`에 추가:

```typescript
describe('useListingStore — assetsDraft', () => {
  beforeEach(() => {
    useListingStore.getState().resetAssetsDraft();
  });

  it('초기 mode는 url, 입력은 비어 있다', () => {
    const d = useListingStore.getState().assetsDraft;
    expect(d.mode).toBe('url');
    expect(d.url).toBe('');
    expect(d.uploadedFiles).toEqual([]);
    expect(d.generatedThumbnails).toEqual([]);
    expect(d.generatedDetailHtml).toBe('');
    expect(d.isGenerating).toBe(false);
    expect(d.lastError).toBe(null);
  });

  it('updateAssetsDraft로 부분 업데이트가 가능하다', () => {
    useListingStore.getState().updateAssetsDraft({ url: 'https://x.com', mode: 'url' });
    const d = useListingStore.getState().assetsDraft;
    expect(d.url).toBe('https://x.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/store/listing-mode.test.ts`
Expected: FAIL — `assetsDraft`/`updateAssetsDraft`/`resetAssetsDraft` 미존재

- [ ] **Step 3: Add slice to store**

`src/store/useListingStore.ts` 내 적절한 위치에 추가:

```typescript
// 타입 영역 (interface ListingStore 위)
interface AssetsDraft {
  mode: 'url' | 'upload';
  url: string;
  uploadedFiles: string[]; // base64 또는 임시 URL 배열
  generatedThumbnails: string[];
  generatedDetailHtml: string;
  isGenerating: boolean;
  lastError: string | null;
}

const ASSETS_DRAFT_INITIAL: AssetsDraft = {
  mode: 'url',
  url: '',
  uploadedFiles: [],
  generatedThumbnails: [],
  generatedDetailHtml: '',
  isGenerating: false,
  lastError: null,
};

// interface ListingStore 안에 추가
  assetsDraft: AssetsDraft;
  updateAssetsDraft: (patch: Partial<AssetsDraft>) => void;
  resetAssetsDraft: () => void;

// store 본문(create) 안 적절한 위치에 추가
  assetsDraft: ASSETS_DRAFT_INITIAL,
  updateAssetsDraft: (patch) =>
    set(
      (s) => ({ assetsDraft: { ...s.assetsDraft, ...patch } }),
      false,
      'listing/updateAssetsDraft',
    ),
  resetAssetsDraft: () =>
    set({ assetsDraft: ASSETS_DRAFT_INITIAL }, false, 'listing/resetAssetsDraft'),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/store/listing-mode.test.ts`
Expected: PASS (모두)

- [ ] **Step 5: Commit**

```bash
git add src/store/useListingStore.ts src/__tests__/store/listing-mode.test.ts
git commit -m "feat(store): assetsDraft 슬라이스 추가

자산 탭의 입력/생성 결과/진행 상태 관리."
```

---

## Task 8: AssetsInputPanel 컴포넌트

**Files:**
- Create: `src/components/listing/assets/AssetsInputPanel.tsx`
- Test: `src/__tests__/components/assets-input-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/components/assets-input-panel.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AssetsInputPanel from '@/components/listing/assets/AssetsInputPanel';
import { useListingStore } from '@/store/useListingStore';

describe('AssetsInputPanel', () => {
  it('URL/직접 업로드 모드 토글이 동작한다', () => {
    render(<AssetsInputPanel onGenerate={() => {}} />);
    expect(screen.getByRole('radio', { name: /URL/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /직접 업로드/ }));
    expect(useListingStore.getState().assetsDraft.mode).toBe('upload');
  });

  it('URL 모드에서 빈 입력은 생성 버튼이 비활성화된다', () => {
    useListingStore.getState().updateAssetsDraft({ mode: 'url', url: '' });
    render(<AssetsInputPanel onGenerate={() => {}} />);
    expect(screen.getByRole('button', { name: /자산 생성/ })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/components/assets-input-panel.test.tsx`
Expected: FAIL — 컴포넌트 미존재

- [ ] **Step 3: Implement the component**

```tsx
// src/components/listing/assets/AssetsInputPanel.tsx
'use client';

import React from 'react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';

interface Props {
  onGenerate: () => void;
}

export default function AssetsInputPanel({ onGenerate }: Props) {
  const { assetsDraft, updateAssetsDraft } = useListingStore();
  const { mode, url, uploadedFiles, isGenerating } = assetsDraft;

  const canGenerate = !isGenerating && (
    (mode === 'url' && url.trim().length > 0) ||
    (mode === 'upload' && uploadedFiles.length > 0)
  );

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const arr = await Promise.all(
      Array.from(files).map((f) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(f);
      })),
    );
    updateAssetsDraft({ uploadedFiles: arr });
  };

  return (
    <div style={{
      backgroundColor: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: '12px',
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
    }}>
      <div style={{ display: 'flex', gap: '16px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input
            type="radio"
            name="assets-mode"
            checked={mode === 'url'}
            onChange={() => updateAssetsDraft({ mode: 'url' })}
          />
          <span style={{ fontSize: '13px', color: C.text }}>URL</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input
            type="radio"
            name="assets-mode"
            checked={mode === 'upload'}
            onChange={() => updateAssetsDraft({ mode: 'upload' })}
          />
          <span style={{ fontSize: '13px', color: C.text }}>직접 업로드</span>
        </label>
      </div>

      {mode === 'url' ? (
        <input
          type="url"
          value={url}
          onChange={(e) => updateAssetsDraft({ url: e.target.value })}
          placeholder="https://"
          style={{
            width: '100%',
            padding: '10px 14px',
            fontSize: '13px',
            border: `1px solid ${C.border}`,
            borderRadius: '8px',
            outline: 'none',
            color: C.text,
            backgroundColor: '#fff',
            boxSizing: 'border-box',
          }}
        />
      ) : (
        <div>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            style={{ fontSize: '12px' }}
          />
          {uploadedFiles.length > 0 && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: C.textSub }}>
              {uploadedFiles.length}장 업로드됨
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate}
        style={{
          padding: '10px 20px',
          fontSize: '13px',
          fontWeight: 700,
          backgroundColor: canGenerate ? C.accent : C.border,
          color: canGenerate ? '#fff' : C.textSub,
          border: 'none',
          borderRadius: '8px',
          cursor: canGenerate ? 'pointer' : 'not-allowed',
          alignSelf: 'flex-start',
        }}
      >
        {isGenerating ? '생성 중...' : '자산 생성'}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/components/assets-input-panel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/listing/assets/AssetsInputPanel.tsx \
        src/__tests__/components/assets-input-panel.test.tsx
git commit -m "feat(assets): AssetsInputPanel — URL/업로드 토글 + 생성 버튼"
```

---

## Task 9: AssetsResultPanel 컴포넌트

**Files:**
- Create: `src/components/listing/assets/AssetsResultPanel.tsx`
- Test: `src/__tests__/components/assets-result-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/components/assets-result-panel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AssetsResultPanel from '@/components/listing/assets/AssetsResultPanel';
import { useListingStore } from '@/store/useListingStore';

describe('AssetsResultPanel', () => {
  it('생성 결과가 없으면 안내문을 표시한다', () => {
    useListingStore.getState().resetAssetsDraft();
    render(<AssetsResultPanel onSave={() => {}} />);
    expect(screen.getByText(/자산을 먼저 생성/)).toBeInTheDocument();
  });

  it('썸네일과 상세 HTML이 있으면 미리보기와 액션이 노출된다', () => {
    useListingStore.getState().updateAssetsDraft({
      generatedThumbnails: ['data:image/png;base64,xxx'],
      generatedDetailHtml: '<div>x</div>',
    });
    render(<AssetsResultPanel onSave={() => {}} />);
    expect(screen.getByRole('button', { name: /ZIP 다운로드/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Supabase에 저장/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/components/assets-result-panel.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement the component**

```tsx
// src/components/listing/assets/AssetsResultPanel.tsx
'use client';

import React from 'react';
import { useListingStore } from '@/store/useListingStore';
import { C } from '@/lib/design-tokens';

interface Props {
  onSave: () => void;
}

export default function AssetsResultPanel({ onSave }: Props) {
  const { assetsDraft } = useListingStore();
  const { generatedThumbnails, generatedDetailHtml } = assetsDraft;
  const hasResult = generatedThumbnails.length > 0 || generatedDetailHtml.length > 0;

  if (!hasResult) {
    return (
      <div style={{
        padding: '40px',
        textAlign: 'center',
        color: C.textSub,
        fontSize: '13px',
        backgroundColor: C.card,
        border: `1px dashed ${C.border}`,
        borderRadius: '12px',
      }}>
        좌측에서 자산을 먼저 생성하세요.
      </div>
    );
  }

  const handleDownloadOne = (url: string, idx: number) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `thumbnail-${idx + 1}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadZip = async () => {
    // 동적 import — 번들 사이즈 절감. JSZip이 없으면 dependency 추가 필요.
    const JSZipMod = await import('jszip');
    const zip = new JSZipMod.default();
    generatedThumbnails.forEach((url, i) => {
      const base64 = url.split(',')[1] ?? '';
      zip.file(`thumbnail-${i + 1}.png`, base64, { base64: true });
    });
    if (generatedDetailHtml) {
      zip.file('detail.html', generatedDetailHtml);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'assets.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{
        backgroundColor: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: '12px',
        padding: '16px',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: C.text, marginBottom: '12px' }}>
          썸네일 ({generatedThumbnails.length})
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {generatedThumbnails.map((url, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img
                src={url}
                alt={`썸네일 ${i + 1}`}
                style={{ width: '120px', height: '120px', objectFit: 'cover', borderRadius: '8px', border: `1px solid ${C.border}` }}
              />
              <button
                onClick={() => handleDownloadOne(url, i)}
                style={{
                  position: 'absolute', bottom: '4px', right: '4px',
                  padding: '2px 6px', fontSize: '10px',
                  backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff',
                  border: 'none', borderRadius: '4px', cursor: 'pointer',
                }}
              >
                다운로드
              </button>
            </div>
          ))}
        </div>
      </div>

      {generatedDetailHtml && (
        <div style={{
          backgroundColor: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: '12px',
          padding: '16px',
        }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: C.text, marginBottom: '12px' }}>
            상세 HTML
          </div>
          <iframe
            srcDoc={generatedDetailHtml}
            title="상세 HTML 미리보기"
            style={{ width: '100%', height: '400px', border: `1px solid ${C.border}`, borderRadius: '8px' }}
            sandbox="allow-same-origin"
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          type="button"
          onClick={handleDownloadZip}
          style={{
            padding: '10px 16px', fontSize: '13px', fontWeight: 600,
            backgroundColor: C.text, color: '#fff',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
          }}
        >
          ZIP 다운로드
        </button>
        <button
          type="button"
          onClick={onSave}
          style={{
            padding: '10px 16px', fontSize: '13px', fontWeight: 600,
            backgroundColor: C.accent, color: '#fff',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
          }}
        >
          Supabase에 저장
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2.5: Add jszip dependency if missing**

```bash
npm ls jszip || npm i jszip
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/components/assets-result-panel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/listing/assets/AssetsResultPanel.tsx \
        src/__tests__/components/assets-result-panel.test.tsx \
        package.json package-lock.json
git commit -m "feat(assets): AssetsResultPanel — 미리보기 + 다운로드/저장"
```

---

## Task 10: AssetsTab — 입력/결과 통합 + API 호출

**Files:**
- Modify: `src/components/listing/assets/AssetsTab.tsx` (placeholder를 실제 구현으로)
- Test: `src/__tests__/components/assets-tab.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/components/assets-tab.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AssetsTab from '@/components/listing/assets/AssetsTab';
import { useListingStore } from '@/store/useListingStore';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('AssetsTab', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    useListingStore.getState().resetAssetsDraft();
  });

  it('입력 + 결과 패널이 모두 렌더된다', () => {
    render(<AssetsTab />);
    expect(screen.getByRole('radio', { name: /URL/ })).toBeInTheDocument();
    expect(screen.getByText(/자산을 먼저 생성/)).toBeInTheDocument();
  });

  it('자산 생성 버튼 클릭 시 generate API를 호출하고 결과를 store에 반영한다', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      data: { thumbnails: ['t1.png'], detailHtml: '<div></div>', detailImage: null },
    })));
    useListingStore.getState().updateAssetsDraft({ mode: 'url', url: 'https://x.com' });
    render(<AssetsTab />);
    fireEvent.click(screen.getByRole('button', { name: /자산 생성/ }));
    await waitFor(() => {
      expect(useListingStore.getState().assetsDraft.generatedThumbnails).toEqual(['t1.png']);
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/listing/assets/generate', expect.any(Object));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/components/assets-tab.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement AssetsTab**

```tsx
// src/components/listing/assets/AssetsTab.tsx
'use client';

import React from 'react';
import AssetsInputPanel from './AssetsInputPanel';
import AssetsResultPanel from './AssetsResultPanel';
import { useListingStore } from '@/store/useListingStore';

export default function AssetsTab() {
  const { assetsDraft, updateAssetsDraft } = useListingStore();

  const handleGenerate = async () => {
    updateAssetsDraft({ isGenerating: true, lastError: null });
    const body = assetsDraft.mode === 'url'
      ? { mode: 'url', url: assetsDraft.url.trim() }
      : { mode: 'upload', images: assetsDraft.uploadedFiles };
    try {
      const res = await fetch('/api/listing/assets/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) {
        updateAssetsDraft({ isGenerating: false, lastError: json.error ?? '생성 실패' });
        return;
      }
      updateAssetsDraft({
        isGenerating: false,
        generatedThumbnails: json.data.thumbnails ?? [],
        generatedDetailHtml: json.data.detailHtml ?? '',
      });
    } catch (e) {
      updateAssetsDraft({
        isGenerating: false,
        lastError: e instanceof Error ? e.message : 'unknown error',
      });
    }
  };

  const handleSave = async () => {
    const body = {
      sourceType: assetsDraft.mode,
      sourceUrl: assetsDraft.mode === 'url' ? assetsDraft.url : undefined,
      thumbnails: assetsDraft.generatedThumbnails,
      detailHtml: assetsDraft.generatedDetailHtml,
    };
    const res = await fetch('/api/listing/assets/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.success) {
      alert('자산이 저장되었습니다.');
    } else {
      alert('저장 실패: ' + (json.error ?? 'unknown'));
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '20px', alignItems: 'start' }}>
      <AssetsInputPanel onGenerate={handleGenerate} />
      <AssetsResultPanel onSave={handleSave} />
      {assetsDraft.lastError && (
        <div style={{ gridColumn: '1 / -1', padding: '10px 14px', backgroundColor: '#fee2e2', color: '#b91c1c', fontSize: '13px', borderRadius: '8px' }}>
          {assetsDraft.lastError}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/components/assets-tab.test.tsx`
Expected: PASS

- [ ] **Step 5: Smoke test in browser**

```bash
npm run dev
# /listing?tab=assets 접속
# - URL 입력 → 자산 생성 → 결과 패널 확인
# - Supabase에 저장 → 알림 확인 + DB row 확인
```

- [ ] **Step 6: Commit**

```bash
git add src/components/listing/assets/AssetsTab.tsx \
        src/__tests__/components/assets-tab.test.tsx
git commit -m "feat(assets): AssetsTab — 생성/저장 API 연동 통합"
```

---

## Task 11: 회귀 가드 + 마이그레이션 노트

**Files:**
- Modify: `src/store/useListingStore.ts` (localStorage 마이그레이션)
- Run: 빌드 + 타입체크 + 테스트 + lint

- [ ] **Step 1: localStorage `'bulk'` → `'register'` 강제 변환**

`src/store/useListingStore.ts`의 store 초기값 영역에서 만약 zustand persist가 listingMode를 저장한다면 다음 같은 마이그레이션 추가. (현재 코드에 persist가 없다면 이 step은 skip.)

확인 명령:

```bash
grep -n "persist\|listingMode" src/store/useListingStore.ts
```

persist가 사용되면 아래 패턴을 적용:

```typescript
persist(
  (set, get) => ({ /* ... */ }),
  {
    name: 'listing-store',
    migrate: (persistedState: unknown, version) => {
      const s = persistedState as { listingMode?: string };
      if (s?.listingMode === 'bulk') {
        return { ...s, listingMode: 'register' };
      }
      return s;
    },
    version: 2,
  },
);
```

persist 미사용이면 다음 가드만 ListingDashboard 마운트 시 추가:

```typescript
useEffect(() => {
  // 외부 코드에서 'bulk'를 set한 경우 방어
  // @ts-expect-error 런타임 가드
  if (listingMode === 'bulk') setListingMode('register');
}, [listingMode, setListingMode]);
```

- [ ] **Step 2: Full test suite + typecheck + lint + build**

```bash
npx vitest run
npx tsc --noEmit
npm run lint
npm run build
```

Expected: 모두 통과. 빌드 시 unused-import 경고가 나오면 해당 import 제거.

- [ ] **Step 3: Verify deprecated routes still work**

```bash
npm run dev
# 직접 URL 진입: http://localhost:3000/listing/auto-register
# → 페이지가 여전히 렌더되어야 함 (라우트 유지 정책)
```

- [ ] **Step 4: Commit**

```bash
git add -u
git commit -m "chore(listing): 탭 재편 마이그레이션 가드 + 회귀 가드 통과

- localStorage listingMode 'bulk' → 'register' 강제 변환
- 빌드/타입체크/테스트/린트 모두 통과
- /listing/auto-register 라우트는 유지 (Phase 2에서 통합 예정)"
```

---

## Self-Review Notes (자체 점검)

**Spec 커버리지:**
- ✅ 탭 3개 + URL 동기화 → Task 1, 2
- ✅ Step1 URL 입력 전용 → Task 3
- ✅ Supabase `generated_assets` → Task 4
- ✅ generate/save API → Task 5, 6
- ✅ assetsDraft 슬라이스 → Task 7
- ✅ 자산 탭 컴포넌트 (입력/결과/통합) → Task 8, 9, 10
- ✅ 헤더 우측 버튼 제거 → Task 2
- ✅ bulk 분기 제거 → Task 2
- ✅ `/listing/auto-register` 라우트 유지 → Task 11
- ✅ 폐기 예정 컴포넌트(BulkImportPanel/DomeggookPreparePanel) 진입점 제거 → Task 2 (import 삭제)
- ⏸ Step3 6 섹션 + BothRegisterForm 폐기 → **Phase 2로 분리** (사용자 동의)

**타입 일관성:**
- `listingMode`: `'register' | 'browse' | 'assets'` — Task 1, 2, 11에서 일관
- `assetsDraft` 필드명: `generatedThumbnails`, `generatedDetailHtml` — Task 7, 8, 9, 10에서 일관
- API 키: `thumbnails`/`detailHtml`/`detailImage` — Task 5, 6, 10에서 일관

**플레이스홀더 스캔:**
- "TBD"/"TODO" 없음. Task 4의 Storage 버킷 결정만 작업자가 환경 확인 후 결정 (지시 명확함).
- Task 5 generate API의 `parseSourceUrl` 반환 형식 확인은 작업자 책임 (지시 명시).

---

## 작업 후 다음 단계 (Phase 2 예고)

Phase 2 spec 작성/계획 시 다룰 항목:
1. Step3의 BothRegisterForm을 6 섹션 아코디언 폼으로 분리
2. BothRegisterForm 실제 폐기 + Step3 통합
3. (선택) 자산 탭에서 생성한 자산을 "AI 상품 등록"에서 불러오기 UI
4. (선택) `/listing/auto-register` 라우트 정리/통합 결정
