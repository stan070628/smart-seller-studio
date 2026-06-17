# 상품상세 자동만들기 — 참고 텍스트 + 썸네일 탭 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상품상세 자동만들기에 (1) 판매자가 AI 생성 시 참고할 자유 텍스트를 선택적으로 입력하는 기능과 (2) 왼쪽 패널을 "상세페이지" / "썸네일" 2탭으로 분리하는 기능을 추가한다.

**Architecture:** lib 함수(`buildDetailPageUserPrompt`) 시그니처 확장 → API route RequestSchema 확장 → Client state 추가 → InputPanel UI 변경 순으로 진행. TDD: 라이브러리 함수와 UI 컴포넌트 모두 테스트 먼저 작성.

**Tech Stack:** Next.js App Router, React (inline styles, design-tokens), Vitest + React Testing Library, Zod, TypeScript

---

## 변경 파일 목록

| 파일 | 역할 |
|------|------|
| `src/lib/ai/prompts/detail-page.ts` | `buildDetailPageUserPrompt`에 `referenceText?` 파라미터 추가 |
| `src/__tests__/lib/detail-page-prompts.test.ts` | referenceText 관련 테스트 추가 |
| `src/app/api/ai/generate-detail-html/route.ts` | `RequestSchema`에 `referenceText` 필드 추가 + 프롬프트 빌더 호출에 전달 |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | `referenceText` state 추가 + `handleGenerate`에서 API body에 포함 + `DetailMakerInputPanel` props 전달 |
| `src/components/listing/detail-maker/DetailMakerInputPanel.tsx` | 탭 UI + 참고 텍스트 접기/펼치기 섹션 추가 |
| `src/__tests__/components/detail-maker-input-panel.test.tsx` | 탭 전환 + 참고 텍스트 섹션 동작 테스트 |

---

### Task 1: `buildDetailPageUserPrompt`에 referenceText 파라미터 추가

**Files:**
- Modify: `src/lib/ai/prompts/detail-page.ts:401-451`
- Test: `src/__tests__/lib/detail-page-prompts.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/__tests__/lib/detail-page-prompts.test.ts`의 `describe('buildDetailPageUserPrompt', ...)` 블록 끝(275번째 줄 닫는 `}` 직전)에 아래 테스트 3개를 추가한다.

```ts
  describe('referenceText (판매자 참고 텍스트)', () => {
    it('referenceText가 있으면 프롬프트에 판매자 참고 텍스트 블록이 포함된다', () => {
      const result = buildDetailPageUserPrompt(
        validImageAnalysis,
        '텀블러',
        undefined,
        undefined,
        '경쟁사 셀링 포인트: 보온력 뛰어남, 가벼움',
      );
      expect(result).toContain('[판매자 참고 텍스트]');
      expect(result).toContain('경쟁사 셀링 포인트: 보온력 뛰어남, 가벼움');
    });

    it('referenceText가 없으면 판매자 참고 텍스트 블록이 없다', () => {
      const result = buildDetailPageUserPrompt(validImageAnalysis, '텀블러');
      expect(result).not.toContain('[판매자 참고 텍스트]');
    });

    it('referenceText가 공백만이면 판매자 참고 텍스트 블록이 없다', () => {
      const result = buildDetailPageUserPrompt(
        validImageAnalysis,
        '텀블러',
        undefined,
        undefined,
        '   ',
      );
      expect(result).not.toContain('[판매자 참고 텍스트]');
    });
  });
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/lib/detail-page-prompts.test.ts
```

Expected: 새로 추가한 3개 테스트가 TypeScript 오류(파라미터 없음)로 실패.

- [ ] **Step 3: `buildDetailPageUserPrompt` 시그니처 및 구현 수정**

`src/lib/ai/prompts/detail-page.ts`의 `buildDetailPageUserPrompt` 함수를 아래와 같이 수정한다.

```ts
export function buildDetailPageUserPrompt(
  imageAnalysis: ProductImageAnalysis,
  productName?: string,
  productSpecs?: Array<{ label: string; value: string }>,
  conversationContext?: import('@/lib/conversational-detail/types').ConversationContext,
  referenceText?: string,
): string {
  const lines: string[] = [];

  if (productName) {
    lines.push(`상품명: ${productName}`);
  }

  if (conversationContext && conversationContext.answers.length > 0) {
    lines.push('\n[마케팅 브리프 — 절대 우선 반영]');
    lines.push('아래 사용자 답변을 톤·구성·강조점의 핵심 가이드로 사용하세요. 이미지 분석보다 우선합니다.');
    for (const answer of conversationContext.answers) {
      if (answer.resolvedValue && answer.resolvedValue.trim()) {
        lines.push(`- ${answer.questionId}: ${answer.resolvedValue.trim()}`);
      }
    }
  }

  lines.push(`\n[이미지 분석 결과]`);
  lines.push(`소재: ${imageAnalysis.material}`);
  lines.push(`형태: ${imageAnalysis.shape}`);
  lines.push(`색상: ${imageAnalysis.colors.join(", ")}`);
  lines.push(`주요 구성 요소: ${imageAnalysis.keyComponents.join(", ")}`);

  if (productSpecs && productSpecs.length > 0) {
    lines.push('\n[소스 URL 실측 스펙 — 이미지 분석보다 절대 우선 적용]');
    lines.push('⚠ 아래 스펙 데이터만 사용하세요. 원본에 없는 특징(오버핏, 드롭숄더, 두툼한 소재 등)을 이미지 추론·창작으로 추가 금지:');
    productSpecs.forEach(({ label, value }) => {
      lines.push(`${label}: ${value}`);
    });
    lines.push('- 판매 단위/소분 단위가 있으면 headline, specs, warnings에서 총중량만 단독 강조하지 말고 판매 단위를 우선 표기하세요.');
    lines.push('- 예: "44개입 (총 4.1kg) / 개당 93.2g"처럼 소분 수량, 총량, 개당 중량을 함께 보여주세요.');
    lines.push('- 원재료·함량·내용량 항목도 전체 중량보다 실제 판매되는 소분 포장 단위를 먼저 노출하세요.');
    lines.push('↑ 위 스펙에 명시되지 않은 속성(핏, 두께감, 질감 등)은 절대 기재하지 마세요.');
  }

  if (referenceText?.trim()) {
    lines.push(`\n[판매자 참고 텍스트]\n${referenceText.trim()}`);
  }

  lines.push(
    `\n위 상품 정보를 바탕으로 한국 이커머스 상세 페이지 콘텐츠를 JSON으로 생성해 주세요.`
  );

  return lines.join("\n");
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/lib/detail-page-prompts.test.ts
```

Expected: 전체 통과. 새로 추가한 3개 테스트 포함.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/ai/prompts/detail-page.ts src/__tests__/lib/detail-page-prompts.test.ts
git commit -m "feat(prompts): buildDetailPageUserPrompt에 referenceText 파라미터 추가"
```

---

### Task 2: API route에 referenceText 필드 추가

**Files:**
- Modify: `src/app/api/ai/generate-detail-html/route.ts`

- [ ] **Step 1: RequestSchema에 referenceText 추가**

`src/app/api/ai/generate-detail-html/route.ts`의 `RequestSchema` 안에 다음 필드를 추가한다. `conversationContext` 필드 정의 바로 뒤(`.optional(),` 이후 `.refine(` 직전)에 삽입:

```ts
  referenceText: z.string().max(3000).optional(),
```

- [ ] **Step 2: 구조분해에 referenceText 추가**

route.ts line 354 근처의 destructuring을 수정한다:

```ts
const {
  images: rawImages,
  imageUrls,
  productName,
  existingHtml,
  studioMode,
  mobileMode,
  productSpecs,
  category,
  conversationContext,
  includeImagePrompts,
  referenceText,          // 추가
} = parseResult.data;
```

- [ ] **Step 3: 모바일 모드 프롬프트 빌더 호출에 referenceText 전달**

route.ts의 `mobileMode` 블록 안 `buildDetailPageUserPrompt` 호출(line 500 근처)을 수정:

```ts
const mobileUserMessage = buildDetailPageUserPrompt(
  imageAnalysis,
  productName,
  productSpecs,
  conversationContext,
  referenceText,          // 추가
);
```

- [ ] **Step 4: 데스크톱 모드 프롬프트 빌더 호출에 referenceText 전달**

route.ts의 `buildDetailPageUserPrompt` 두 번째 호출(line 601 근처)을 수정:

```ts
const userMessage = buildDetailPageUserPrompt(
  imageAnalysis,
  productName,
  productSpecs,
  conversationContext,
  referenceText,          // 추가
);
```

- [ ] **Step 5: TypeScript 타입 오류 없는지 확인**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: 오류 없음.

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/ai/generate-detail-html/route.ts
git commit -m "feat(api): generate-detail-html route에 referenceText 필드 추가"
```

---

### Task 3: DetailMakerClient에 referenceText state 추가

**Files:**
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx`

- [ ] **Step 1: referenceText state 추가**

`DetailMakerClient.tsx`의 기존 state 선언 블록(썸네일 state 아래)에 추가:

```ts
// 참고 텍스트
const [referenceText, setReferenceText] = useState('');
```

- [ ] **Step 2: handleGenerate의 fetch body에 referenceText 추가**

`handleGenerate` 함수 내 `fetch('/api/ai/generate-detail-html', ...)` 호출의 body를 수정:

```ts
body: JSON.stringify({
  imageUrls: uploadedUrls,
  productName: fullProductName,
  category,
  mobileMode: true,
  referenceText: referenceText.trim() || undefined,  // 추가
}),
```

- [ ] **Step 3: DetailMakerInputPanel에 새 props 전달**

`DetailMakerClient.tsx` 렌더 부분의 `<DetailMakerInputPanel>` JSX에 추가:

```tsx
<DetailMakerInputPanel
  productName={productName}
  setProductName={setProductName}
  brandName={brandName}
  setBrandName={setBrandName}
  category={category}
  setCategory={setCategory}
  uploadedUrls={uploadedUrls}
  uploading={uploading}
  isGenerating={isGenerating || isGeneratingScenes}
  error={error}
  onUploadFiles={handleUploadFiles}
  onRemoveImage={handleRemoveImage}
  onGenerate={handleGenerate}
  suggestedMoodIds={suggestedMoodIds}
  selectedMoodId={creativeBrief?.moodId ?? null}
  isSuggestingMood={isSuggestingMood}
  onSelectMood={handleSelectMood}
  thumbnailRefUrls={uploadedUrls}
  isGeneratingThumbnail={isGeneratingThumbnail}
  thumbnailError={thumbnailError}
  onGenerateThumbnail={handleGenerateThumbnail}
  referenceText={referenceText}         // 추가
  setReferenceText={setReferenceText}   // 추가
/>
```

- [ ] **Step 4: TypeScript 타입 오류 없는지 확인**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: `referenceText`/`setReferenceText` props 관련 오류 발생 (아직 InputPanel Props에 추가 안 했으므로 정상). Task 4에서 해결.

- [ ] **Step 5: 커밋**

```bash
git add src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "feat(client): DetailMakerClient에 referenceText state + API 전달 추가"
```

---

### Task 4: DetailMakerInputPanel — 탭 UI + 참고 텍스트 섹션 추가

**Files:**
- Modify: `src/components/listing/detail-maker/DetailMakerInputPanel.tsx`
- Create: `src/__tests__/components/detail-maker-input-panel.test.tsx`

- [ ] **Step 1: 실패 테스트 파일 작성**

`src/__tests__/components/detail-maker-input-panel.test.tsx`를 새로 생성:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DetailMakerInputPanel from '@/components/listing/detail-maker/DetailMakerInputPanel';

const baseProps = {
  productName: '',
  setProductName: vi.fn(),
  brandName: '',
  setBrandName: vi.fn(),
  category: 'basic' as const,
  setCategory: vi.fn(),
  uploadedUrls: [],
  uploading: false,
  isGenerating: false,
  error: null,
  onUploadFiles: vi.fn(),
  onRemoveImage: vi.fn(),
  onGenerate: vi.fn(),
  suggestedMoodIds: [],
  selectedMoodId: null,
  isSuggestingMood: false,
  onSelectMood: vi.fn(),
  thumbnailRefUrls: [],
  isGeneratingThumbnail: false,
  thumbnailError: null,
  onGenerateThumbnail: vi.fn(),
  referenceText: '',
  setReferenceText: vi.fn(),
};

describe('DetailMakerInputPanel — 탭', () => {
  it('초기에 상세페이지 탭이 활성화되어 상품명 입력이 보인다', () => {
    render(<DetailMakerInputPanel {...baseProps} />);
    expect(screen.getByPlaceholderText(/나이키 에어맥스/)).toBeInTheDocument();
  });

  it('썸네일 탭 클릭 시 AI 썸네일 생성 버튼이 보인다', () => {
    render(<DetailMakerInputPanel {...baseProps} thumbnailRefUrls={['https://x/a.jpg']} />);
    fireEvent.click(screen.getByRole('button', { name: '썸네일' }));
    expect(screen.getByRole('button', { name: /AI 썸네일 생성/ })).toBeInTheDocument();
  });

  it('상세페이지 탭으로 돌아오면 상품명 입력이 다시 보인다', () => {
    render(<DetailMakerInputPanel {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '썸네일' }));
    fireEvent.click(screen.getByRole('button', { name: '상세페이지' }));
    expect(screen.getByPlaceholderText(/나이키 에어맥스/)).toBeInTheDocument();
  });
});

describe('DetailMakerInputPanel — 참고 텍스트', () => {
  it('초기에 "참고 텍스트 추가" 버튼이 보이고 textarea는 숨겨져 있다', () => {
    render(<DetailMakerInputPanel {...baseProps} />);
    expect(screen.getByRole('button', { name: /참고 텍스트 추가/ })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/경쟁사 상세페이지/)).not.toBeInTheDocument();
  });

  it('"+ 참고 텍스트 추가" 클릭 시 textarea가 나타난다', () => {
    render(<DetailMakerInputPanel {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /참고 텍스트 추가/ }));
    expect(screen.getByPlaceholderText(/경쟁사 상세페이지/)).toBeInTheDocument();
  });

  it('textarea에 입력하면 setReferenceText가 호출된다', () => {
    const setReferenceText = vi.fn();
    render(<DetailMakerInputPanel {...baseProps} setReferenceText={setReferenceText} />);
    fireEvent.click(screen.getByRole('button', { name: /참고 텍스트 추가/ }));
    fireEvent.change(screen.getByPlaceholderText(/경쟁사 상세페이지/), {
      target: { value: '좋은 텍스트' },
    });
    expect(setReferenceText).toHaveBeenCalledWith('좋은 텍스트');
  });

  it('▲ 클릭 시 textarea가 숨겨진다 (내용 초기화 없음 — setReferenceText 호출 안함)', () => {
    const setReferenceText = vi.fn();
    render(
      <DetailMakerInputPanel
        {...baseProps}
        referenceText="기존 텍스트"
        setReferenceText={setReferenceText}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /참고 텍스트 추가/ }));
    fireEvent.click(screen.getByRole('button', { name: /참고 텍스트 ▲/ }));
    expect(screen.queryByPlaceholderText(/경쟁사 상세페이지/)).not.toBeInTheDocument();
    // 접기만 했으므로 setReferenceText('')는 호출하지 않는다
    expect(setReferenceText).not.toHaveBeenCalledWith('');
  });

  it('× 클릭 시 setReferenceText("")가 호출되고 textarea가 숨겨진다', () => {
    const setReferenceText = vi.fn();
    render(
      <DetailMakerInputPanel
        {...baseProps}
        referenceText="기존 텍스트"
        setReferenceText={setReferenceText}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /참고 텍스트 추가/ }));
    fireEvent.click(screen.getByRole('button', { name: '참고 텍스트 초기화' }));
    expect(setReferenceText).toHaveBeenCalledWith('');
    expect(screen.queryByPlaceholderText(/경쟁사 상세페이지/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/components/detail-maker-input-panel.test.tsx
```

Expected: 컴포넌트가 아직 탭/참고 텍스트 UI를 갖지 않으므로 실패.

- [ ] **Step 3: `DetailMakerInputPanel` 전체 교체**

`src/components/listing/detail-maker/DetailMakerInputPanel.tsx`를 아래 내용으로 교체한다:

```tsx
'use client';

import React, { useRef, useState } from 'react';
import { C } from '@/lib/design-tokens';
import CreativeBriefPanel from './CreativeBriefPanel';
import DetailMakerThumbnailPanel from './DetailMakerThumbnailPanel';

type Category = 'basic' | 'fashion' | 'living' | 'food';
type Tab = 'detail' | 'thumbnail';

const BRAND_PURPLE = '#7c3aed';

const CATEGORY_LABELS: Record<Category, string> = {
  basic: '기본',
  fashion: '패션',
  living: '리빙',
  food: '식품',
};

interface Props {
  productName: string;
  setProductName: (v: string) => void;
  brandName: string;
  setBrandName: (v: string) => void;
  category: Category;
  setCategory: (v: Category) => void;
  uploadedUrls: string[];
  uploading: boolean;
  isGenerating: boolean;
  error: string | null;
  onUploadFiles: (files: FileList | File[]) => void;
  onRemoveImage: (idx: number) => void;
  onGenerate: () => void;
  suggestedMoodIds: string[];
  selectedMoodId: string | null;
  isSuggestingMood: boolean;
  onSelectMood: (id: string) => void;
  thumbnailRefUrls: string[];
  isGeneratingThumbnail: boolean;
  thumbnailError: string | null;
  onGenerateThumbnail: (direction: string) => void;
  referenceText: string;
  setReferenceText: (v: string) => void;
}

export default function DetailMakerInputPanel({
  productName,
  setProductName,
  brandName,
  setBrandName,
  category,
  setCategory,
  uploadedUrls,
  uploading,
  isGenerating,
  error,
  onUploadFiles,
  onRemoveImage,
  onGenerate,
  suggestedMoodIds,
  selectedMoodId,
  isSuggestingMood,
  onSelectMood,
  thumbnailRefUrls,
  isGeneratingThumbnail,
  thumbnailError,
  onGenerateThumbnail,
  referenceText,
  setReferenceText,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<Tab>('detail');
  const [showReferenceText, setShowReferenceText] = useState(false);

  const canGenerate = !isGenerating && productName.trim().length > 0 && uploadedUrls.length > 0;

  return (
    <div
      style={{
        width: '300px',
        minWidth: '300px',
        height: '100%',
        borderRight: `1px solid ${C.border}`,
        background: C.card,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      {/* 헤더 */}
      <div
        style={{
          padding: '20px 16px 12px',
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <div style={{ fontSize: '15px', fontWeight: 700, color: C.text }}>
          상품상세 자동만들기
        </div>
        <div style={{ fontSize: '12px', color: C.textSub, marginTop: '4px' }}>
          상품명 + 이미지로 1분 만에 상세페이지 생성
        </div>
      </div>

      {/* 탭 토글 */}
      <div
        style={{
          display: 'flex',
          padding: '8px 16px',
          borderBottom: `1px solid ${C.border}`,
          gap: '4px',
        }}
      >
        {(['detail', 'thumbnail'] as const).map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: '7px 0',
              fontSize: '13px',
              fontWeight: activeTab === tab ? 700 : 400,
              border: 'none',
              borderRadius: '6px',
              background: activeTab === tab ? BRAND_PURPLE : 'transparent',
              color: activeTab === tab ? '#fff' : C.textSub,
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {tab === 'detail' ? '상세페이지' : '썸네일'}
          </button>
        ))}
      </div>

      {/* ── 상세페이지 탭 ── */}
      {activeTab === 'detail' && (
        <>
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
            {/* 상품명 */}
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: C.text, display: 'block', marginBottom: '6px' }}>
                상품명 <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                value={productName}
                onChange={e => setProductName(e.target.value)}
                placeholder="예) 나이키 에어맥스 런닝화 270"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: '13px',
                  border: `1px solid ${C.border}`,
                  borderRadius: '6px',
                  background: '#fff',
                  color: '#111',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* 카테고리 */}
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: C.text, display: 'block', marginBottom: '6px' }}>
                카테고리
              </label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {(Object.keys(CATEGORY_LABELS) as Category[]).map(cat => (
                  <button
                    key={cat}
                    onClick={() => setCategory(cat)}
                    style={{
                      padding: '5px 12px',
                      fontSize: '12px',
                      borderRadius: '20px',
                      border: category === cat ? `1.5px solid ${BRAND_PURPLE}` : `1px solid ${C.border}`,
                      background: category === cat ? '#f5f3ff' : '#fff',
                      color: category === cat ? BRAND_PURPLE : C.text,
                      cursor: 'pointer',
                      fontWeight: category === cat ? 600 : 400,
                    }}
                  >
                    {CATEGORY_LABELS[cat]}
                  </button>
                ))}
              </div>
            </div>

            {/* 브랜드명 */}
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: C.text, display: 'block', marginBottom: '6px' }}>
                브랜드명 <span style={{ fontSize: '11px', color: C.textSub, fontWeight: 400 }}>(선택)</span>
              </label>
              <input
                type="text"
                value={brandName}
                onChange={e => setBrandName(e.target.value)}
                placeholder="예) 나이키"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: '13px',
                  border: `1px solid ${C.border}`,
                  borderRadius: '6px',
                  background: '#fff',
                  color: '#111',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* 참고 이미지 */}
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: C.text, display: 'block', marginBottom: '6px' }}>
                참고 이미지 <span style={{ color: '#ef4444' }}>*</span>{' '}
                <span style={{ fontSize: '11px', color: C.textSub, fontWeight: 400 }}>
                  ({uploadedUrls.length}/6, 권장 3장)
                </span>
              </label>

              {uploadedUrls.length < 6 && (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${C.border}`,
                    borderRadius: '8px',
                    padding: '20px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: '#fafafa',
                    marginBottom: uploadedUrls.length > 0 ? '10px' : undefined,
                  }}
                >
                  {uploading ? (
                    <div style={{ fontSize: '13px', color: C.textSub }}>업로드 중...</div>
                  ) : (
                    <>
                      <div style={{ fontSize: '24px', marginBottom: '4px' }}>📷</div>
                      <div style={{ fontSize: '12px', color: C.textSub }}>
                        클릭하여 이미지 선택
                        <br />
                        JPG, PNG, WebP · 최대 10MB
                      </div>
                    </>
                  )}
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                style={{ display: 'none' }}
                onChange={e => {
                  if (e.target.files) onUploadFiles(e.target.files);
                  e.target.value = '';
                }}
              />

              {uploadedUrls.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                  {uploadedUrls.map((url, idx) => (
                    <div key={url} style={{ position: 'relative' }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`참고 이미지 ${idx + 1}`}
                        style={{
                          width: '100%',
                          aspectRatio: '1',
                          objectFit: 'cover',
                          borderRadius: '6px',
                          border: `1px solid ${C.border}`,
                        }}
                      />
                      <button
                        onClick={() => onRemoveImage(idx)}
                        style={{
                          position: 'absolute',
                          top: '2px',
                          right: '2px',
                          width: '18px',
                          height: '18px',
                          borderRadius: '50%',
                          background: 'rgba(0,0,0,0.6)',
                          color: '#fff',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '10px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 무드 브리프 */}
            <CreativeBriefPanel
              suggestedMoodIds={suggestedMoodIds}
              selectedMoodId={selectedMoodId}
              isSuggesting={isSuggestingMood}
              onSelectMood={onSelectMood}
            />

            {/* 참고 텍스트 */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => setShowReferenceText(v => !v)}
                  style={{
                    fontSize: '12px',
                    color: BRAND_PURPLE,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    fontWeight: 600,
                  }}
                >
                  {showReferenceText ? '참고 텍스트 ▲' : '+ 참고 텍스트 추가'}
                </button>
                {showReferenceText && (
                  <button
                    type="button"
                    onClick={() => { setReferenceText(''); setShowReferenceText(false); }}
                    aria-label="참고 텍스트 초기화"
                    style={{
                      fontSize: '14px',
                      color: C.textSub,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '0 2px',
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
              {showReferenceText && (
                <div style={{ marginTop: '8px' }}>
                  <textarea
                    value={referenceText}
                    onChange={e => setReferenceText(e.target.value)}
                    placeholder="경쟁사 상세페이지, 제품 스펙, 셀링 포인트 등 참고할 내용을 자유롭게 입력하세요"
                    maxLength={3000}
                    rows={5}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      fontSize: '12px',
                      color: '#111827',
                      border: `1px solid ${C.border}`,
                      borderRadius: '8px',
                      resize: 'vertical',
                      outline: 'none',
                      lineHeight: 1.5,
                      boxSizing: 'border-box',
                      fontFamily: 'inherit',
                    }}
                  />
                  <div style={{ textAlign: 'right', fontSize: '11px', color: C.textSub, marginTop: '2px' }}>
                    {referenceText.length}/3000
                  </div>
                </div>
              )}
            </div>

            {/* 에러 */}
            {error && (
              <div
                style={{
                  padding: '10px 12px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '6px',
                  fontSize: '12px',
                  color: '#dc2626',
                }}
              >
                {error}
              </div>
            )}
          </div>

          {/* 생성 버튼 (하단 고정) */}
          <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}` }}>
            <button
              onClick={onGenerate}
              disabled={!canGenerate}
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '14px',
                fontWeight: 700,
                borderRadius: '8px',
                border: 'none',
                background: canGenerate ? BRAND_PURPLE : C.border,
                color: canGenerate ? '#fff' : C.textSub,
                cursor: canGenerate ? 'pointer' : 'not-allowed',
                transition: 'background 0.15s',
              }}
            >
              {isGenerating ? '✨ 생성 중...' : '✨ AI 상세페이지 생성'}
            </button>
            {!productName.trim() && (
              <div style={{ fontSize: '11px', color: C.textSub, textAlign: 'center', marginTop: '6px' }}>
                상품명을 입력하세요
              </div>
            )}
            {productName.trim() && uploadedUrls.length === 0 && (
              <div style={{ fontSize: '11px', color: C.textSub, textAlign: 'center', marginTop: '6px' }}>
                이미지를 1장 이상 업로드하세요
              </div>
            )}
          </div>
        </>
      )}

      {/* ── 썸네일 탭 ── */}
      {activeTab === 'thumbnail' && (
        <div style={{ padding: '16px', flex: 1 }}>
          <DetailMakerThumbnailPanel
            refImageUrls={thumbnailRefUrls}
            isGenerating={isGeneratingThumbnail}
            error={thumbnailError}
            onGenerate={onGenerateThumbnail}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/components/detail-maker-input-panel.test.tsx
```

Expected: 전체 통과.

- [ ] **Step 5: TypeScript 오류 없는지 전체 확인**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: 오류 없음.

- [ ] **Step 6: 기존 관련 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/detail-page-prompts.test.ts src/__tests__/components/detail-maker-thumbnail-panel.test.tsx src/__tests__/components/detail-maker-input-panel.test.tsx
```

Expected: 전체 통과.

- [ ] **Step 7: 커밋**

```bash
git add src/components/listing/detail-maker/DetailMakerInputPanel.tsx src/__tests__/components/detail-maker-input-panel.test.tsx
git commit -m "feat(ui): DetailMakerInputPanel 탭 분리 + 참고 텍스트 입력 섹션 추가"
```
