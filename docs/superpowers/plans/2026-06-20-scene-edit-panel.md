# 씬 이미지 편집 패널 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** hero/point 섹션의 AI 생성 씬 이미지를 레퍼런스 이미지 + 지시어로 편집하거나 새로 생성할 수 있는 인라인 패널을 SectionCard에 추가한다.

**Architecture:** 기존 `generate-scene-image` route에 `baseImageUrl` + `instruction` 필드를 추가해 편집/새생성 모드를 프롬프트 빌더에서 분기. 신규 `SceneEditPanel` 컴포넌트가 레퍼런스 선택·PC 업로드·지시어를 로컬 상태로 관리. `DetailMakerClient`가 편집 상태(`editingSectionId`, `sceneEditError`, undo URL)를 소유하고 `DetailPageEditor` → `SectionCard` 체인으로 prop 전달.

**Tech Stack:** Next.js App Router, React, Vitest + React Testing Library, Zod, TypeScript, Sharp (서버), Gemini gemini-2.5-flash-image (이미지 편집), Claude Sonnet (프롬프트 생성)

---

## 변경 파일 목록

| 파일 | 역할 |
|---|---|
| `src/app/api/ai/generate-scene-image/prompt.ts` | `SceneEditOpts` 타입 추가, `buildSceneUserPrompt` 4번째 파라미터 |
| `src/app/api/ai/generate-scene-image/route.ts` | `baseImageUrl`, `instruction` 스키마 추가, 편집 모드 분기 로직 |
| `src/components/listing/detail-editor/SceneEditPanel.tsx` | 신규 인라인 편집 패널 컴포넌트 |
| `src/components/listing/detail-editor/SectionCard.tsx` | `onSceneRegenerate` 제거 → `onSceneEdit` + `SceneEditPanel` 마운트 |
| `src/components/listing/detail-editor/DetailPageEditor.tsx` | 신규 props 추가 → SectionCard 전달 |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | `handleSceneEdit` + undo 상태 + 새 props 전달 |
| `src/__tests__/api/ai/generate-scene-image-prompt.test.ts` | 편집 모드 프롬프트 테스트 추가 |
| `src/__tests__/components/scene-edit-panel.test.tsx` | 신규 컴포넌트 단위 테스트 |

---

### Task 1: `buildSceneUserPrompt` 편집 모드 확장

**Files:**
- Modify: `src/app/api/ai/generate-scene-image/prompt.ts`
- Test: `src/__tests__/api/ai/generate-scene-image-prompt.test.ts`

- [ ] **Step 1: 실패 테스트 추가**

`src/__tests__/api/ai/generate-scene-image-prompt.test.ts` 파일 끝(마지막 `});` 직전)에 아래 블록을 추가한다:

```ts
describe('buildSceneUserPrompt — 편집 모드 (editOpts.isEditMode)', () => {
  it('isEditMode=true이면 첫 번째 이미지가 편집 대상임을 프롬프트에 명시한다', () => {
    const out = buildSceneUserPrompt('hero', { headline: '텀블러' }, undefined, {
      isEditMode: true,
      instruction: '배경을 야외로 바꿔줘',
    });
    expect(out).toContain('FIRST image');
    expect(out).toContain('existing scene');
    expect(out).toContain('배경을 야외로 바꿔줘');
  });

  it('isEditMode=true + instruction 없으면 instruction 라인이 없다', () => {
    const out = buildSceneUserPrompt('lifestyle', undefined, undefined, { isEditMode: true });
    expect(out).toContain('FIRST image');
    expect(out).not.toContain('Edit instruction');
  });

  it('isEditMode=false + instruction이면 Art direction으로 취급한다', () => {
    const out = buildSceneUserPrompt('hero', undefined, undefined, {
      isEditMode: false,
      instruction: '밝고 화사하게',
    });
    expect(out).toContain('Art direction');
    expect(out).toContain('밝고 화사하게');
    expect(out).not.toContain('FIRST image');
  });

  it('isEditMode=false이면 sceneHint와 instruction 모두 Art direction에 포함된다', () => {
    const out = buildSceneUserPrompt('hero', undefined, '골드 톤', {
      isEditMode: false,
      instruction: '밝게',
    });
    expect(out).toContain('골드 톤');
    expect(out).toContain('밝게');
  });

  it('기존 시그니처(editOpts 없음)는 하위호환 유지', () => {
    const out = buildSceneUserPrompt('hero', { headline: '향수' }, 'moody gold');
    expect(out).toContain('Art direction');
    expect(out).toContain('moody gold');
    expect(out).not.toContain('FIRST image');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/api/ai/generate-scene-image-prompt.test.ts
```

Expected: 새 블록 5개 테스트가 `타입 에러` 또는 assertion 실패로 FAIL.

- [ ] **Step 3: `prompt.ts` 구현**

`src/app/api/ai/generate-scene-image/prompt.ts` 전체를 아래로 교체한다:

```ts
export interface SceneProductInfo {
  headline?: string;
  subheadline?: string;
  sellingPoints?: Array<{ title: string; description: string }>;
  features?: Array<{ title: string }>;
}

export interface SceneEditOpts {
  /** true: 첫 번째 reference 이미지가 수정할 기존 씬 이미지 */
  isEditMode?: boolean;
  /** 편집 지시어 (편집 모드) 또는 art direction (새 생성 모드) */
  instruction?: string;
}

export function buildSceneUserPrompt(
  sectionType: string,
  productInfo: SceneProductInfo | undefined,
  sceneHint: string | undefined,
  editOpts?: SceneEditOpts,
): string {
  if (editOpts?.isEditMode) {
    const lines: string[] = [
      'The FIRST image is the existing scene image to be modified (previously AI-generated).',
      'The remaining image(s) are the original product reference photos — use them to ensure product accuracy.',
    ];
    if (editOpts.instruction?.trim()) {
      lines.push(`Edit instruction: ${editOpts.instruction.trim()}`);
    }
    lines.push('');
    lines.push(`Section type: ${sectionType}`);
    lines.push(
      'Generate a Gemini image editing prompt that modifies the existing scene per the edit instruction while keeping the product appearance unchanged. Return only JSON: {"prompt": "..."}',
    );
    return lines.join('\n');
  }

  // 새 생성 모드
  const lines: string[] = ['Product reference image(s) are attached above.'];

  if (productInfo) {
    if (productInfo.headline) lines.push(`Product headline: ${productInfo.headline}`);
    if (productInfo.subheadline) lines.push(`Subheadline: ${productInfo.subheadline}`);
    if (productInfo.sellingPoints?.length) {
      lines.push(`Key selling points: ${productInfo.sellingPoints.map((sp) => sp.title).join(', ')}`);
    }
    if (productInfo.features?.length) {
      lines.push(`Product features: ${productInfo.features.map((f) => f.title).join(', ')}`);
    }
  }

  // instruction + sceneHint 합산 (둘 다 있으면 '. '으로 이음)
  const hints = [sceneHint?.trim(), editOpts?.instruction?.trim()].filter(Boolean).join('. ');
  if (hints) {
    lines.push('');
    lines.push(`Art direction (apply this mood/style to the scene): ${hints}`);
  }

  lines.push('');
  lines.push(`Section type: ${sectionType}`);
  lines.push('Generate a detailed Gemini image generation prompt for this section. Return only JSON.');

  return lines.join('\n');
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/api/ai/generate-scene-image-prompt.test.ts
```

Expected: 전체 9개 테스트 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/ai/generate-scene-image/prompt.ts src/__tests__/api/ai/generate-scene-image-prompt.test.ts
git commit -m "feat(prompt): buildSceneUserPrompt에 편집 모드(SceneEditOpts) 파라미터 추가"
```

---

### Task 2: `generate-scene-image` route 확장

**Files:**
- Modify: `src/app/api/ai/generate-scene-image/route.ts`

- [ ] **Step 1: RequestBodySchema에 필드 추가**

`route.ts`의 `RequestBodySchema` 안 `sceneHint` 필드 바로 뒤에 추가한다:

```ts
  sceneHint: z.string().max(600).optional(),
  // 편집 모드: 기존 씬 이미지 URL (있으면 편집, 없으면 새 생성)
  baseImageUrl: z.string().url().optional(),
  // 편집 지시어 또는 새 생성 art direction
  instruction: z.string().max(500).optional(),
```

- [ ] **Step 2: rate limit 상수 추가**

파일 상단 `const RATE_LIMIT = ...` 줄 바로 아래에 추가한다:

```ts
const EDIT_RATE_LIMIT = { windowMs: 60_000, maxRequests: 6 };
```

- [ ] **Step 3: POST 핸들러 rate limit 분기 수정**

기존:
```ts
const rl = checkRateLimit(getRateLimitKey(ip, 'generate-scene-image'), RATE_LIMIT);
```

아래로 교체한다:
```ts
const bodyForRL = await req.clone().json().catch(() => ({})) as { baseImageUrl?: string };
const isEditMode = !!bodyForRL.baseImageUrl;
const rl = checkRateLimit(
  getRateLimitKey(ip, isEditMode ? 'edit-scene-image' : 'generate-scene-image'),
  isEditMode ? EDIT_RATE_LIMIT : RATE_LIMIT,
);
```

- [ ] **Step 4: try 블록 내 분기 로직 추가**

기존 `const { sectionType, productInfo, sceneHint } = parsed.data;` 줄을 아래로 교체한다:

```ts
const { sectionType, productInfo, sceneHint, baseImageUrl, instruction } = parsed.data;
const isEditMode = !!baseImageUrl;
```

그리고 기존 `const referenceImages = await loadReferenceImages({...});` 호출 **앞에** 아래 블록을 삽입한다:

```ts
// 편집 모드: base 이미지를 첫 번째 reference로 로딩 (실패 시 명시적 에러)
let baseImages: import('@/lib/ai/reference-images').ReferenceImage[] = [];
if (baseImageUrl) {
  baseImages = await loadReferenceImages({ productImageUrls: [baseImageUrl] });
  if (baseImages.length === 0) {
    return NextResponse.json(
      { success: false, error: '현재 씬 이미지를 불러오지 못했습니다. 이미지 URL이 만료되었거나 접근이 제한되었습니다.' },
      { status: 422 },
    );
  }
}
```

- [ ] **Step 5: 이미지 배열 합산 + 프롬프트 빌더 호출 수정**

기존 `const referenceImages = await loadReferenceImages({...});` 호출 직후 기존 `userContent` 루프 전체를 아래로 교체한다:

```ts
// 상품 레퍼런스 이미지 로딩 (편집 모드는 base 1장을 이미 소비 → 최대 2장)
const productRefs = await loadReferenceImages({
  referenceImages: parsed.data.referenceImages,
  productImageUrls: parsed.data.productImageUrls,
  productImageBase64: parsed.data.productImageBase64,
  productImageMimeType: parsed.data.productImageMimeType,
  productImageUrl: parsed.data.productImageUrl,
});

// base 먼저, 그다음 product refs (합산 최대 3장)
const allImages = [...baseImages, ...productRefs].slice(0, 3);

// Claude 유저 콘텐츠 구성
type ContentBlock =
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'text'; text: string };

const userContent: ContentBlock[] = [];

for (const ref of allImages) {
  userContent.push({
    type: 'image',
    source: { type: 'base64', media_type: ref.mimeType, data: ref.base64 },
  });
}

userContent.push({
  type: 'text',
  text: buildSceneUserPrompt(sectionType, productInfo, sceneHint, { isEditMode, instruction }),
});
```

그리고 기존 `const imageResult = await generateFrameImage({ imagePrompt: scenePrompt, referenceImages });` 줄을 아래로 교체한다:

```ts
const imageResult = await generateFrameImage({
  imagePrompt: scenePrompt,
  referenceImages: allImages,
});
```

- [ ] **Step 6: TypeScript 오류 확인**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: 오류 없음.

- [ ] **Step 7: 커밋**

```bash
git add src/app/api/ai/generate-scene-image/route.ts
git commit -m "feat(api): generate-scene-image에 baseImageUrl·instruction 편집 모드 추가"
```

---

### Task 3: `SceneEditPanel` 신규 컴포넌트 (TDD)

**Files:**
- Create: `src/components/listing/detail-editor/SceneEditPanel.tsx`
- Create: `src/__tests__/components/scene-edit-panel.test.tsx`

- [ ] **Step 1: 실패 테스트 파일 작성**

`src/__tests__/components/scene-edit-panel.test.tsx` 를 새로 생성한다:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SceneEditPanel from '@/components/listing/detail-editor/SceneEditPanel';
import type { DetailSection } from '@/types/detail-page';

const sectionNoImage: DetailSection = {
  id: 'sec-1',
  type: 'hero',
  content: { type: 'hero', headline: '강력한 성능', subheadline: '최고의 선택' },
  attachedImages: [],
};

const sectionWithImage: DetailSection = {
  id: 'sec-2',
  type: 'point',
  content: { type: 'point', headline: '슬림 디자인', subheadline: '가볍게', pointLabel: null },
  attachedImages: [{ url: 'https://example.supabase.co/img/scene.jpg', order: 0, processingMode: 'original' }],
};

const baseProps = {
  uploadedUrls: ['https://example.supabase.co/img/a.jpg', 'https://example.supabase.co/img/b.jpg'],
  isEditing: false,
  error: null,
  onEdit: vi.fn().mockResolvedValue(undefined),
  onUndo: vi.fn(),
  onClose: vi.fn(),
};

describe('SceneEditPanel — 이미지 없을 때', () => {
  it('안내 배너를 표시한다', () => {
    render(<SceneEditPanel {...baseProps} section={sectionNoImage} />);
    expect(screen.getByText(/아직 생성된 이미지가 없어요/)).toBeInTheDocument();
  });

  it('현재 이미지 미리보기가 없다', () => {
    render(<SceneEditPanel {...baseProps} section={sectionNoImage} />);
    expect(screen.queryByAltText('현재 씬 이미지')).not.toBeInTheDocument();
  });

  it('"새로 생성" 버튼 텍스트가 노출된다', () => {
    render(<SceneEditPanel {...baseProps} section={sectionNoImage} />);
    expect(screen.getByRole('button', { name: /씬 이미지 새로 생성/ })).toBeInTheDocument();
  });
});

describe('SceneEditPanel — 이미지 있을 때', () => {
  it('현재 이미지 썸네일을 표시한다', () => {
    render(<SceneEditPanel {...baseProps} section={sectionWithImage} />);
    expect(screen.getByAltText('현재 씬 이미지')).toBeInTheDocument();
  });

  it('"수정 재생성" 버튼 텍스트가 노출된다', () => {
    render(<SceneEditPanel {...baseProps} section={sectionWithImage} />);
    expect(screen.getByRole('button', { name: /이미지 수정 재생성/ })).toBeInTheDocument();
  });

  it('prevSceneUrl이 있으면 되돌리기 버튼이 노출된다', () => {
    render(
      <SceneEditPanel
        {...baseProps}
        section={sectionWithImage}
        prevSceneUrl="https://example.supabase.co/img/prev.jpg"
      />,
    );
    expect(screen.getByRole('button', { name: /되돌리기/ })).toBeInTheDocument();
  });

  it('prevSceneUrl이 없으면 되돌리기 버튼이 없다', () => {
    render(<SceneEditPanel {...baseProps} section={sectionWithImage} />);
    expect(screen.queryByRole('button', { name: /되돌리기/ })).not.toBeInTheDocument();
  });
});

describe('SceneEditPanel — 레퍼런스 이미지', () => {
  it('"참고 이미지에서" 버튼 클릭 시 이미지 그리드가 표시된다', () => {
    render(<SceneEditPanel {...baseProps} section={sectionNoImage} />);
    fireEvent.click(screen.getByRole('button', { name: /참고 이미지에서/ }));
    // uploadedUrls 이미지들이 그리드로 렌더링됨
    const imgs = screen.getAllByRole('img');
    expect(imgs.length).toBeGreaterThanOrEqual(2);
  });

  it('이미지 선택 시 선택 카운트가 증가한다', () => {
    render(<SceneEditPanel {...baseProps} section={sectionNoImage} />);
    fireEvent.click(screen.getByRole('button', { name: /참고 이미지에서/ }));
    const imgs = screen.getAllByRole('img');
    fireEvent.click(imgs[0]);
    expect(screen.getByText(/1\/2/)).toBeInTheDocument();
  });

  it('최대 2장 초과 선택이 불가하다', () => {
    render(
      <SceneEditPanel
        {...baseProps}
        section={sectionNoImage}
        uploadedUrls={[
          'https://example.supabase.co/img/a.jpg',
          'https://example.supabase.co/img/b.jpg',
          'https://example.supabase.co/img/c.jpg',
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /참고 이미지에서/ }));
    const imgs = screen.getAllByRole('img');
    // 첫 번째 두 이미지 선택
    fireEvent.click(imgs[0]);
    fireEvent.click(imgs[1]);
    // 세 번째 클릭해도 카운트가 2를 초과하지 않음
    fireEvent.click(imgs[2]);
    expect(screen.getByText(/2\/2/)).toBeInTheDocument();
  });
});

describe('SceneEditPanel — 제출', () => {
  it('제출 버튼 클릭 시 onEdit이 instruction과 referenceImageUrls로 호출된다', async () => {
    const onEdit = vi.fn().mockResolvedValue(undefined);
    render(<SceneEditPanel {...baseProps} section={sectionNoImage} onEdit={onEdit} />);

    fireEvent.change(screen.getByPlaceholderText(/밝고 화사한/), {
      target: { value: '야외 카페 분위기' },
    });
    fireEvent.click(screen.getByRole('button', { name: /씬 이미지 새로 생성/ }));

    await waitFor(() => {
      expect(onEdit).toHaveBeenCalledWith({
        instruction: '야외 카페 분위기',
        referenceImageUrls: [],
      });
    });
  });

  it('isEditing=true이면 제출 버튼이 disabled 상태다', () => {
    render(<SceneEditPanel {...baseProps} section={sectionNoImage} isEditing={true} />);
    expect(screen.getByRole('button', { name: /생성 중/ })).toBeDisabled();
  });

  it('error prop이 있으면 에러 메시지를 표시한다', () => {
    render(
      <SceneEditPanel {...baseProps} section={sectionNoImage} error="씬 이미지 생성에 실패했습니다." />,
    );
    expect(screen.getByText('씬 이미지 생성에 실패했습니다.')).toBeInTheDocument();
  });

  it('닫기 버튼 클릭 시 onClose가 호출된다', () => {
    const onClose = vi.fn();
    render(<SceneEditPanel {...baseProps} section={sectionNoImage} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('되돌리기 버튼 클릭 시 onUndo가 호출된다', () => {
    const onUndo = vi.fn();
    render(
      <SceneEditPanel
        {...baseProps}
        section={sectionWithImage}
        prevSceneUrl="https://example.supabase.co/img/prev.jpg"
        onUndo={onUndo}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /되돌리기/ }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/components/scene-edit-panel.test.tsx
```

Expected: 컴포넌트 파일이 없으므로 전체 FAIL.

- [ ] **Step 3: `SceneEditPanel.tsx` 구현**

`src/components/listing/detail-editor/SceneEditPanel.tsx` 를 생성한다:

```tsx
'use client';

import React, { useRef, useState } from 'react';
import { C } from '@/lib/design-tokens';
import type { DetailSection } from '@/types/detail-page';

const BRAND_PURPLE = '#7c3aed';
const MAX_REF = 2;

export interface SceneEditPanelProps {
  section: DetailSection;
  uploadedUrls: string[];
  isEditing: boolean;
  error: string | null;
  prevSceneUrl?: string;
  onEdit: (opts: { instruction: string; referenceImageUrls: string[] }) => Promise<void>;
  onUndo?: () => void;
  onClose: () => void;
}

export default function SceneEditPanel({
  section,
  uploadedUrls,
  isEditing,
  error,
  prevSceneUrl,
  onEdit,
  onUndo,
  onClose,
}: SceneEditPanelProps) {
  const [instruction, setInstruction] = useState('');
  const [selectedRefUrls, setSelectedRefUrls] = useState<string[]>([]);
  const [pcUploadedUrls, setPcUploadedUrls] = useState<string[]>([]);
  const [showRefPicker, setShowRefPicker] = useState(false);
  const [pcUploading, setPcUploading] = useState(false);
  const [pcUploadError, setPcUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentImageUrl = section.attachedImages[0]?.url ?? null;
  const allRefUrls = [...selectedRefUrls, ...pcUploadedUrls];
  const canAddMore = allRefUrls.length < MAX_REF;
  const hasCurrentImage = !!currentImageUrl;

  function toggleRefUrl(url: string) {
    setSelectedRefUrls(prev => {
      if (prev.includes(url)) return prev.filter(u => u !== url);
      if (prev.length + pcUploadedUrls.length >= MAX_REF) return prev;
      return [...prev, url];
    });
  }

  function removePcUrl(url: string) {
    setPcUploadedUrls(prev => prev.filter(u => u !== url));
  }

  async function handlePcFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    e.target.value = '';
    if (!files || files.length === 0 || !canAddMore) return;
    setPcUploading(true);
    setPcUploadError(null);
    try {
      const fd = new FormData();
      fd.append('file', files[0]);
      fd.append('usageContext', 'scene_reference');
      const res = await fetch('/api/listing/upload-image', { method: 'POST', body: fd });
      const json = await res.json() as { success: boolean; data?: { url: string }; error?: string };
      if (!res.ok || !json.success) throw new Error(json.error ?? '업로드 실패');
      setPcUploadedUrls(prev => [...prev, json.data!.url].slice(0, MAX_REF));
    } catch (err) {
      setPcUploadError(err instanceof Error ? err.message : '이미지 업로드에 실패했습니다.');
    } finally {
      setPcUploading(false);
    }
  }

  async function handleSubmit() {
    if (isEditing) return;
    await onEdit({ instruction: instruction.trim(), referenceImageUrls: allRefUrls });
  }

  const submitLabel = hasCurrentImage ? '✨ 이미지 수정 재생성' : '✨ 씬 이미지 새로 생성';

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ padding: '14px 14px 16px', background: '#faf9ff', borderTop: `2px solid ${BRAND_PURPLE}22` }}
    >
      {/* 현재 이미지 미리보기 or 안내 배너 */}
      {hasCurrentImage ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentImageUrl}
              alt="현재 씬 이미지"
              style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 6, border: `1px solid ${C.border}` }}
            />
            <span style={{
              position: 'absolute', bottom: -4, right: -4,
              background: BRAND_PURPLE, color: '#fff', fontSize: 8,
              padding: '1px 4px', borderRadius: 3, fontWeight: 700,
            }}>현재</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 2 }}>현재 AI 생성 이미지</div>
            <div style={{ fontSize: 10, color: C.textSub, lineHeight: 1.4 }}>
              이 이미지를 기반으로 수정합니다. 레퍼런스와 지시어로 원하는 방향으로 변경하세요.
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6,
          padding: '8px 10px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 14 }}>💡</span>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#92400e' }}>아직 생성된 이미지가 없어요</div>
            <div style={{ fontSize: 10, color: '#b45309', marginTop: 1 }}>레퍼런스와 방향을 입력하면 새로 만들어드립니다</div>
          </div>
        </div>
      )}

      {/* 레퍼런스 이미지 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 8 }}>
          레퍼런스 이미지{' '}
          <span style={{ fontWeight: 400, color: C.textSub }}>(선택 · {allRefUrls.length}/{MAX_REF}장)</span>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {uploadedUrls.length > 0 && canAddMore && (
            <button
              type="button"
              onClick={() => setShowRefPicker(v => !v)}
              style={{
                padding: '6px 10px', border: `1.5px dashed ${BRAND_PURPLE}77`,
                borderRadius: 6, background: '#fff', color: BRAND_PURPLE,
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              🗂 참고 이미지에서
            </button>
          )}
          {canAddMore && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={pcUploading}
              style={{
                padding: '6px 10px', border: `1.5px dashed ${BRAND_PURPLE}77`,
                borderRadius: 6, background: '#fff', color: BRAND_PURPLE,
                fontSize: 11, fontWeight: 600,
                cursor: pcUploading ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              💻 {pcUploading ? '업로드 중...' : 'PC에서 업로드'}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={handlePcFileChange}
          />
        </div>

        {showRefPicker && uploadedUrls.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 8 }}>
            {uploadedUrls.map(url => {
              const selected = selectedRefUrls.includes(url);
              const disabled = !selected && allRefUrls.length >= MAX_REF;
              return (
                <div
                  key={url}
                  role="img"
                  onClick={() => !disabled && toggleRefUrl(url)}
                  style={{ position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1 }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt=""
                    style={{
                      width: '100%', aspectRatio: '1', objectFit: 'cover',
                      borderRadius: 4, border: `2px solid ${selected ? BRAND_PURPLE : C.border}`,
                    }}
                  />
                  {selected && (
                    <div style={{
                      position: 'absolute', top: 2, right: 2,
                      width: 14, height: 14, borderRadius: '50%',
                      background: BRAND_PURPLE, color: '#fff',
                      fontSize: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700,
                    }}>✓</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {allRefUrls.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {allRefUrls.map(url => (
              <div key={url} style={{ position: 'relative' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, border: `1px solid ${C.border}` }} />
                <button
                  type="button"
                  onClick={() => {
                    if (selectedRefUrls.includes(url)) toggleRefUrl(url);
                    else removePcUrl(url);
                  }}
                  style={{
                    position: 'absolute', top: -4, right: -4,
                    width: 14, height: 14, borderRadius: '50%',
                    background: '#ef4444', color: '#fff', border: 'none',
                    fontSize: 8, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >×</button>
              </div>
            ))}
          </div>
        )}

        {pcUploadError && (
          <div style={{ fontSize: 10, color: '#dc2626', marginTop: 4 }}>{pcUploadError}</div>
        )}
      </div>

      {/* 지시어 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 6 }}>
          {hasCurrentImage ? '수정 지시어' : '생성 방향'}{' '}
          <span style={{ fontWeight: 400, color: C.textSub }}>(선택)</span>
        </div>
        <textarea
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          placeholder={hasCurrentImage ? '예) 배경을 더 밝게, 야외 카페 분위기로 바꿔줘' : '예) 밝고 화사한 야외 카페 분위기'}
          rows={2}
          maxLength={500}
          style={{
            width: '100%', padding: '8px 10px', fontSize: 11,
            color: '#111827', border: `1px solid ${BRAND_PURPLE}55`,
            borderRadius: 6, resize: 'vertical', outline: 'none',
            lineHeight: 1.5, boxSizing: 'border-box', fontFamily: 'inherit', background: '#fff',
          }}
        />
      </div>

      {error && (
        <div style={{
          padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca',
          borderRadius: 6, fontSize: 11, color: '#dc2626', marginBottom: 10,
        }}>
          {error}
        </div>
      )}

      {/* 액션 버튼 */}
      <div style={{ display: 'flex', gap: 6 }}>
        {prevSceneUrl && onUndo && (
          <button
            type="button"
            onClick={onUndo}
            style={{
              padding: '9px 10px', border: `1px solid ${C.border}`,
              borderRadius: 7, background: '#fff', color: C.text,
              fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            ↩ 되돌리기
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '9px 12px', border: `1px solid ${C.border}`,
            borderRadius: 7, background: '#fff', color: C.text,
            fontSize: 12, cursor: 'pointer',
          }}
        >
          닫기
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isEditing}
          style={{
            flex: 1, padding: '9px', border: 'none',
            background: isEditing ? C.border : BRAND_PURPLE,
            color: isEditing ? C.textSub : '#fff',
            borderRadius: 7, fontSize: 12, fontWeight: 700,
            cursor: isEditing ? 'not-allowed' : 'pointer',
          }}
        >
          {isEditing ? '⏳ 생성 중...' : submitLabel}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/components/scene-edit-panel.test.tsx
```

Expected: 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/components/listing/detail-editor/SceneEditPanel.tsx src/__tests__/components/scene-edit-panel.test.tsx
git commit -m "feat(ui): SceneEditPanel 컴포넌트 추가 — 씬 이미지 편집/재생성 인라인 패널"
```

---

### Task 4: `SectionCard` 수정

**Files:**
- Modify: `src/components/listing/detail-editor/SectionCard.tsx`

- [ ] **Step 1: import 추가**

`SectionCard.tsx` 상단 import 블록에 아래를 추가한다:

```ts
import SceneEditPanel from './SceneEditPanel';
```

- [ ] **Step 2: Props 인터페이스 교체**

기존 `interface SectionCardProps` 의 `onSceneRegenerate` 관련 prop을 제거하고 아래 props를 추가한다:

```ts
interface SectionCardProps {
  section: DetailSection;
  isActive?: boolean;
  onAiEdit: (section: DetailSection, instruction: string) => Promise<void>;
  onDelete: (id: string) => void;
  onClick: (id: string) => void;
  onImagesChange: (id: string, images: AttachedImage[]) => void;
  palette: PaletteName;
  onSectionImageAiEdit?: (sectionId: string, imageUrl: string, imageIndex: number) => void;
  /** 씬 이미지 편집/재생성 (hero/point에서만 노출) */
  onSceneEdit?: (section: DetailSection, opts: { instruction: string; referenceImageUrls: string[] }) => Promise<void>;
  uploadedUrls?: string[];
  isSceneEditing?: boolean;
  sceneEditError?: string | null;
  prevSceneUrl?: string;
  onSceneUndo?: () => void;
}
```

- [ ] **Step 3: 구조분해 및 로컬 상태 교체**

기존 `onSceneRegenerate` 구조분해를 제거하고 새 props를 추가한다. 그리고 기존 `const [isRegenerating, setIsRegenerating] = useState(false);` 와 관련 `canRegenerate`, `handleRegenerateClick` 를 모두 아래로 교체한다:

```ts
export default function SectionCard({
  section,
  isActive = false,
  onAiEdit,
  onDelete,
  onClick,
  onImagesChange,
  palette,
  onSectionImageAiEdit,
  onSceneEdit,
  uploadedUrls = [],
  isSceneEditing = false,
  sceneEditError = null,
  prevSceneUrl,
  onSceneUndo,
}: SectionCardProps) {
  const [showPanel, setShowPanel] = useState(false);
  const [showScenePanel, setShowScenePanel] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  // ... (나머지 기존 useSortable 등 그대로)

  const canSceneEdit = !!onSceneEdit && (section.type === 'hero' || section.type === 'point');
```

- [ ] **Step 4: 버튼 교체 + SceneEditPanel 마운트**

기존 "씬 재생성 버튼 (hero/point)" JSX 블록 전체를 아래로 교체한다:

```tsx
{/* 씬 편집 버튼 (hero/point) */}
{canSceneEdit && (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); setShowScenePanel(v => !v); }}
    style={{
      padding: '4px 8px', borderRadius: 5, flexShrink: 0,
      border: `1px solid ${showScenePanel ? '#7c3aed' : '#dddddd'}`,
      background: showScenePanel ? '#7c3aed10' : 'transparent',
      color: showScenePanel ? '#7c3aed' : C.textSub,
      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
      transition: 'border-color 0.15s, background 0.15s, color 0.15s',
    }}
  >
    <span>🎨</span>
    <span>씬 편집 {showScenePanel ? '▴' : '▾'}</span>
  </button>
)}
```

그리고 카드 div의 닫는 태그 (`</div>`) 직전(카드 헤더 행 div 닫힌 후, 기존 SectionInstructionPanel 마운트와 동일 위치)에 SceneEditPanel을 추가한다:

```tsx
{/* 씬 편집 패널 */}
{showScenePanel && onSceneEdit && (
  <SceneEditPanel
    section={section}
    uploadedUrls={uploadedUrls}
    isEditing={isSceneEditing}
    error={sceneEditError}
    prevSceneUrl={prevSceneUrl}
    onEdit={async (opts) => {
      try {
        await onSceneEdit(section, opts);
        setShowScenePanel(false); // 성공 시만 닫힘
      } catch {
        // 실패 시 패널 유지 — 에러는 sceneEditError prop으로 표시
      }
    }}
    onUndo={onSceneUndo}
    onClose={() => setShowScenePanel(false)}
  />
)}
```

- [ ] **Step 5: TypeScript 오류 확인**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: DetailPageEditor에서 `onSceneRegenerate` 전달 관련 오류 발생 (다음 Task에서 해결).

- [ ] **Step 6: 커밋**

```bash
git add src/components/listing/detail-editor/SectionCard.tsx
git commit -m "feat(ui): SectionCard — 씬 편집 패널 버튼 + SceneEditPanel 마운트"
```

---

### Task 5: `DetailPageEditor` 수정

**Files:**
- Modify: `src/components/listing/detail-editor/DetailPageEditor.tsx`

- [ ] **Step 1: Props 인터페이스에 필드 추가 및 `onSceneRegenerate` 제거**

`DetailPageEditorProps` 에서 `onSceneRegenerate` 를 제거하고 아래 필드를 추가한다:

```ts
export interface DetailPageEditorProps {
  sections: DetailSection[];
  theme: DetailPageTheme;
  isGenerating?: boolean;
  onSectionsChange: (sections: DetailSection[]) => void;
  onThemeChange: (theme: DetailPageTheme) => void;
  onRegenerateAll?: () => void;
  onSectionAiEdit: (section: DetailSection, instruction: string) => Promise<void>;
  onHtmlCopy?: () => void;
  onDownload?: () => void;
  generatedHtml?: string;
  hidePreview?: boolean;
  onSectionImageAiEdit?: (sectionId: string, imageUrl: string, imageIndex: number) => void;
  // 씬 편집 관련 (SectionCard로 전달)
  uploadedUrls?: string[];
  onSceneEdit?: (section: DetailSection, opts: { instruction: string; referenceImageUrls: string[] }) => Promise<void>;
  editingSectionId?: string | null;
  sceneEditError?: { sectionId: string; message: string } | null;
  prevSceneUrlMap?: Map<string, string>;
  onSceneUndo?: (sectionId: string) => void;
}
```

- [ ] **Step 2: 구조분해에 새 props 추가**

`export default function DetailPageEditor({` 구조분해에 아래를 추가하고 `onSceneRegenerate`를 제거한다:

```ts
  uploadedUrls,
  onSceneEdit,
  editingSectionId,
  sceneEditError,
  prevSceneUrlMap,
  onSceneUndo,
```

- [ ] **Step 3: SectionCard 호출에 새 props 전달**

`sections.map((section) => (...))` 안의 `<SectionCard>` JSX에서 `onSceneRegenerate={onSceneRegenerate}` 를 제거하고 아래를 추가한다:

```tsx
onSceneEdit={onSceneEdit}
uploadedUrls={uploadedUrls}
isSceneEditing={editingSectionId === section.id}
sceneEditError={sceneEditError?.sectionId === section.id ? sceneEditError.message : null}
prevSceneUrl={prevSceneUrlMap?.get(section.id)}
onSceneUndo={onSceneUndo ? () => onSceneUndo(section.id) : undefined}
```

- [ ] **Step 4: TypeScript 오류 확인**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: `DetailMakerClient`에서 `onSceneRegenerate` 전달 관련 오류 (다음 Task에서 해결).

- [ ] **Step 5: 커밋**

```bash
git add src/components/listing/detail-editor/DetailPageEditor.tsx
git commit -m "feat(ui): DetailPageEditor에 씬 편집 props 추가 + onSceneRegenerate 제거"
```

---

### Task 6: `DetailMakerClient` 수정

**Files:**
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx`

- [ ] **Step 1: 상태 및 ref 추가**

기존 `sceneGenIdRef` 선언 바로 아래에 추가한다:

```ts
// 씬 편집 상태
const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
const [sceneEditError, setSceneEditError] = useState<{ sectionId: string; message: string } | null>(null);
const sceneEditIdRef = useRef(0);
const prevSceneUrls = useRef<Map<string, string>>(new Map());
```

- [ ] **Step 2: `handleSceneRegenerate` 를 `handleSceneEdit` 으로 교체**

기존 `async function handleSceneRegenerate(section: DetailSection)` 함수 전체를 아래로 교체한다:

```ts
async function handleSceneEdit(
  section: DetailSection,
  opts: { instruction: string; referenceImageUrls: string[] },
) {
  setEditingSectionId(section.id);
  setSceneEditError(null);
  sceneEditIdRef.current += 1;
  const editId = sceneEditIdRef.current;

  // 편집 전 이전 URL 보관 (undo용)
  const prevUrl = section.attachedImages[0]?.url;
  if (prevUrl) prevSceneUrls.current.set(section.id, prevUrl);

  const FAIL_MSG = '씬 이미지 생성에 실패했습니다. 잠시 후 다시 시도해주세요.';

  try {
    const headline = (() => {
      const c = section.content;
      if (c.type === 'hero' || c.type === 'point') return c.headline;
      return undefined;
    })();

    const res = await fetch('/api/ai/generate-scene-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sectionType: section.type === 'hero' ? 'hero' : 'lifestyle',
        productImageUrls: opts.referenceImageUrls.length > 0 ? opts.referenceImageUrls : uploadedUrls.slice(0, 2),
        baseImageUrl: section.attachedImages[0]?.url,
        instruction: opts.instruction || undefined,
        productInfo: headline ? { headline } : undefined,
      }),
    });

    if (sceneEditIdRef.current !== editId) return;

    const json = await res.json() as {
      success: boolean;
      data?: { imageBase64: string; mimeType: string };
      error?: string;
    };
    if (!res.ok || !json.success) throw new Error(json.error ?? FAIL_MSG);

    const uploadRes = await fetch('/api/image/upload-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: json.data!.imageBase64,
        mimeType: json.data!.mimeType,
        role: section.type === 'hero' ? 'hero' : 'lifestyle',
      }),
    });

    if (sceneEditIdRef.current !== editId) return;

    const uploadData = await uploadRes.json() as { success: boolean; url?: string };
    if (!uploadData.success || !uploadData.url) throw new Error(FAIL_MSG);

    const newUrl = uploadData.url;
    setSections(prev => {
      const updated = prev.map(s =>
        s.id === section.id
          ? { ...s, attachedImages: [{ url: newUrl, order: 0, processingMode: 'original' as const }] }
          : s,
      );
      void refreshRenderedHtml(updated, theme);
      return updated;
    });
    setEditingSectionId(null);
  } catch (e) {
    if (sceneEditIdRef.current !== editId) return;
    setSceneEditError({
      sectionId: section.id,
      message: e instanceof Error ? e.message : FAIL_MSG,
    });
    setEditingSectionId(null);
    throw e; // re-throw → SectionCard에서 catch해 패널 유지
  }
}

function handleSceneUndo(sectionId: string) {
  const prevUrl = prevSceneUrls.current.get(sectionId);
  if (!prevUrl) return;
  setSections(prev => {
    const updated = prev.map(s =>
      s.id === sectionId
        ? { ...s, attachedImages: [{ url: prevUrl, order: 0, processingMode: 'original' as const }] }
        : s,
    );
    void refreshRenderedHtml(updated, theme);
    return updated;
  });
  prevSceneUrls.current.delete(sectionId);
  // 에러 상태도 초기화
  setSceneEditError(prev => prev?.sectionId === sectionId ? null : prev);
}
```

- [ ] **Step 3: DetailPageEditor JSX에 새 props 전달**

기존 `<DetailPageEditor>` JSX에서 `onSceneRegenerate={handleSceneRegenerate}` 를 제거하고 아래를 추가한다:

```tsx
uploadedUrls={uploadedUrls}
onSceneEdit={handleSceneEdit}
editingSectionId={editingSectionId}
sceneEditError={sceneEditError}
prevSceneUrlMap={prevSceneUrls.current}
onSceneUndo={handleSceneUndo}
```

- [ ] **Step 4: TypeScript 오류 없는지 확인**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: 오류 없음.

- [ ] **Step 5: 기존 테스트 회귀 없는지 확인**

```bash
npx vitest run src/__tests__/components/scene-edit-panel.test.tsx src/__tests__/api/ai/generate-scene-image-prompt.test.ts src/__tests__/components/detail-maker-input-panel.test.tsx
```

Expected: 전체 PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "feat(client): handleSceneEdit + undo 상태 + DetailPageEditor 씬 편집 props 배선"
```
