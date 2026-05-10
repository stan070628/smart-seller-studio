# AssetsTab 상세페이지 기능 확장 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AssetsTab(썸네일·상세만 만들기)에 업로드 이미지 AI 편집, 섹션 이미지 AI 편집, 2장 나란히 렌더링, 미리보기 인라인 텍스트 수정, 섹션별 hover 구분을 추가한다.

**Architecture:** section-renderer → SectionImageAttachment → SectionCard → DetailPageEditor → AssetsResultPanel/AssetsInputPanel 순서로 하위 컴포넌트부터 수정. 인라인 편집 로직(buildEditablePreviewDocument, updatePathValue)은 Step3ReviewRegister에서 DetailPageEditor로 이식.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest + React Testing Library, @dnd-kit, Supabase Storage

---

## 파일 맵

| 파일 | 역할 |
|------|------|
| `src/lib/detail-page/section-renderer.ts` | attachedImages 2장 나란히 렌더링 |
| `src/__tests__/lib/detail-page/section-renderer.test.ts` | 기존 테스트 파일에 2장 케이스 추가 |
| `src/components/listing/detail-editor/SectionImageAttachment.tsx` | MAX_IMAGES 2, AI 편집 버튼 |
| `src/components/listing/detail-editor/SectionCard.tsx` | onSectionImageAiEdit prop 추가 |
| `src/components/listing/detail-editor/DetailPageEditor.tsx` | onSectionImageAiEdit prop, 인라인 편집, 섹션 구분 CSS |
| `src/components/listing/assets/AssetsResultPanel.tsx` | 섹션 이미지 AI 편집 모달 연결 |
| `src/components/listing/assets/AssetsInputPanel.tsx` | 업로드 이미지 AI 편집 버튼 |

---

## Task 1: section-renderer — 2장 나란히 렌더링

**Files:**
- Modify: `src/lib/detail-page/section-renderer.ts:63-72`
- Modify: `src/__tests__/lib/detail-page/section-renderer.test.ts`

- [ ] **Step 1: 실패하는 테스트 추가**

`src/__tests__/lib/detail-page/section-renderer.test.ts` 파일 끝에 아래 describe 블록 추가:

```typescript
// ---------------------------------------------------------------------------
// renderSection — attachedImages 2장 나란히 렌더링
// ---------------------------------------------------------------------------
describe('renderSection — attachedImages 2장', () => {
  const twoImageSection = baseSection({
    type: 'hero',
    content: { type: 'hero', headline: '제목', subheadline: '부제목' },
    attachedImages: [
      { url: 'https://example.com/img1.jpg', order: 0, processingMode: 'original' },
      { url: 'https://example.com/img2.jpg', order: 1, processingMode: 'original' },
    ],
  });

  it('2장 모두 img 태그로 렌더링된다', () => {
    const html = renderSection(twoImageSection, WARM_CREAM_THEME);
    expect(html).toContain('https://example.com/img1.jpg');
    expect(html).toContain('https://example.com/img2.jpg');
  });

  it('flex 컨테이너로 나란히 배치된다', () => {
    const html = renderSection(twoImageSection, WARM_CREAM_THEME);
    expect(html).toContain('display:flex');
    expect(html).toContain('width:50%');
  });

  it('1장만 있을 때는 단일 이미지 렌더링(width:100%)', () => {
    const oneImageSection = baseSection({
      type: 'hero',
      content: { type: 'hero', headline: '제목', subheadline: '부제목' },
      attachedImages: [
        { url: 'https://example.com/img1.jpg', order: 0, processingMode: 'original' },
      ],
    });
    const html = renderSection(oneImageSection, WARM_CREAM_THEME);
    expect(html).toContain('width:100%');
    expect(html).not.toContain('width:50%');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/section-renderer.test.ts
```

Expected: 새로 추가한 3개 테스트 FAIL ("2장 모두", "flex 컨테이너", 1장 테스트는 PASS)

- [ ] **Step 3: renderAttachedImage 함수 수정**

`src/lib/detail-page/section-renderer.ts`의 `renderAttachedImage` 함수를 다음으로 교체:

```typescript
function renderAttachedImage(section: DetailSection): string {
  if (section.attachedImages.length === 0) return '';

  if (section.attachedImages.length >= 2) {
    const img1 = section.attachedImages[0];
    const img2 = section.attachedImages[1];
    const safeUrl1 = sanitizeUrl(img1.url);
    const safeUrl2 = sanitizeUrl(img2.url);
    if (!safeUrl1 && !safeUrl2) return '';
    const imgTag = (url: string) =>
      url
        ? `<img src="${escapeHtml(url)}" alt="" style="flex:1;min-width:0;width:50%;display:block;height:auto;" />`
        : `<div style="flex:1;min-width:0;width:50%;"></div>`;
    return `<div style="display:flex;gap:8px;width:100%;box-sizing:border-box;">${imgTag(safeUrl1)}${imgTag(safeUrl2)}</div>`;
  }

  const img = section.attachedImages[0];
  const safeUrl = sanitizeUrl(img.url);
  if (!safeUrl) return '';
  return `<img src="${escapeHtml(safeUrl)}" alt="" style="width:100%;display:block;max-width:100%;height:auto;" />`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/section-renderer.test.ts
```

Expected: 모든 테스트 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/detail-page/section-renderer.ts src/__tests__/lib/detail-page/section-renderer.test.ts
git commit -m "feat(section-renderer): 섹션 이미지 2장 나란히 렌더링 추가"
```

---

## Task 2: SectionImageAttachment — MAX 2장 + AI 편집 버튼

**Files:**
- Modify: `src/components/listing/detail-editor/SectionImageAttachment.tsx`

- [ ] **Step 1: onAiEdit prop 추가 및 MAX_IMAGES 변경**

`SectionImageAttachment.tsx`에서 아래 두 곳을 수정:

**인터페이스 수정** (`interface SectionImageAttachmentProps` 블록):
```typescript
interface SectionImageAttachmentProps {
  images: AttachedImage[];
  palette: PaletteName;
  onChange: (images: AttachedImage[]) => void;
  onAiEdit?: (imageUrl: string, index: number) => void;
}
```

**상수 변경** (`const MAX_IMAGES = 3;` 라인):
```typescript
const MAX_IMAGES = 2;
```

**컴포넌트 함수 시그니처 수정** (`export default function SectionImageAttachment({` 블록):
```typescript
export default function SectionImageAttachment({
  images,
  palette,
  onChange,
  onAiEdit,
}: SectionImageAttachmentProps) {
```

- [ ] **Step 2: 이미지 썸네일에 AI 편집 버튼 추가**

기존 이미지 썸네일 렌더 블록에서 삭제 버튼 아래에 AI 편집 버튼 추가. 삭제 버튼 `<button>` 바로 아래에 삽입:

```tsx
{/* AI 편집 버튼 */}
{onAiEdit && (
  <button
    onClick={(e) => {
      e.stopPropagation();
      onAiEdit(img.url, idx);
    }}
    title="AI로 편집"
    style={{
      position: 'absolute',
      bottom: 2,
      left: 2,
      background: '#7c3aed',
      border: 'none',
      borderRadius: 4,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      padding: '2px 5px',
    }}
  >
    <span style={{ fontSize: 9, color: '#fff', fontFamily: 'system-ui, sans-serif', fontWeight: 600 }}>🪄</span>
  </button>
)}
```

이 버튼은 각 이미지 썸네일 `<div>` 내부 (삭제 버튼 `<button>` 바로 다음)에 위치한다. 기존 삭제 버튼은 `position: absolute; top: 2; right: 2`.

- [ ] **Step 3: 수동 확인**

dev 서버 없이 TypeScript 오류만 확인:

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep "SectionImageAttachment"
```

Expected: 출력 없음 (오류 없음)

- [ ] **Step 4: 커밋**

```bash
git add src/components/listing/detail-editor/SectionImageAttachment.tsx
git commit -m "feat(SectionImageAttachment): MAX_IMAGES 2장으로 변경, AI 편집 버튼 추가"
```

---

## Task 3: SectionCard — onSectionImageAiEdit prop 전달

**Files:**
- Modify: `src/components/listing/detail-editor/SectionCard.tsx`

- [ ] **Step 1: Props 인터페이스에 onSectionImageAiEdit 추가**

`interface SectionCardProps` 블록에 아래 항목 추가:

```typescript
interface SectionCardProps {
  section: DetailSection;
  isActive?: boolean;
  onAiEdit: (section: DetailSection, instruction: string) => Promise<void>;
  onDelete: (id: string) => void;
  onClick: (id: string) => void;
  onImagesChange: (id: string, images: AttachedImage[]) => void;
  palette: PaletteName;
  /** 섹션 이미지 AI 편집 콜백 */
  onSectionImageAiEdit?: (sectionId: string, imageUrl: string, imageIndex: number) => void;
}
```

- [ ] **Step 2: 컴포넌트 함수 시그니처 및 SectionImageAttachment 전달**

`export default function SectionCard({...})` 구조분해에 `onSectionImageAiEdit` 추가:

```typescript
export default function SectionCard({
  section,
  isActive = false,
  onAiEdit,
  onDelete,
  onClick,
  onImagesChange,
  palette,
  onSectionImageAiEdit,
}: SectionCardProps) {
```

기존 `<SectionImageAttachment ... />` 렌더링 코드 (`DetailPageEditor.tsx` 라인 266 근처):

```tsx
<SectionImageAttachment
  images={section.attachedImages}
  palette={palette}
  onChange={(images) => onImagesChange(section.id, images)}
  onAiEdit={
    onSectionImageAiEdit
      ? (url, idx) => onSectionImageAiEdit(section.id, url, idx)
      : undefined
  }
/>
```

- [ ] **Step 3: TypeScript 오류 확인**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep "SectionCard"
```

Expected: 출력 없음

- [ ] **Step 4: 커밋**

```bash
git add src/components/listing/detail-editor/SectionCard.tsx
git commit -m "feat(SectionCard): onSectionImageAiEdit prop 추가 및 SectionImageAttachment 연결"
```

---

## Task 4: DetailPageEditor — 인라인 편집 + onSectionImageAiEdit prop

**Files:**
- Modify: `src/components/listing/detail-editor/DetailPageEditor.tsx`

이 Task는 변경량이 많으므로 3개 스텝으로 나눈다.

- [ ] **Step 1: import 추가 및 헬퍼 함수 삽입**

파일 상단 import 블록에 `useCallback, useEffect, useMemo, useRef` 추가 (React import 수정):

```typescript
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
```

`export interface DetailPageEditorProps` 블록 바로 **위**에 아래 헬퍼들을 추가:

```typescript
// ─── 인라인 편집 헬퍼 (Step3ReviewRegister와 동일한 로직) ───────────────────

const PREVIEW_GUIDE_CSS = `
  [data-section-id] {
    position: relative;
    outline: 1px dashed transparent;
    outline-offset: -2px;
    transition: outline-color 120ms ease, background-color 120ms ease;
  }
  [data-section-id]:hover {
    outline-color: #7c3aed;
    background-image: linear-gradient(rgba(124, 58, 237, 0.035), rgba(124, 58, 237, 0.035));
  }
  [data-section-id]:hover::before {
    content: attr(data-section-label);
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 20;
    padding: 4px 8px;
    border-radius: 6px;
    background: #5b21b6;
    color: #fff;
    font: 700 12px/1.2 system-ui, -apple-system, sans-serif;
    box-shadow: 0 4px 14px rgba(0,0,0,0.18);
    pointer-events: none;
  }
  [data-edit-path] {
    border-radius: 4px;
    cursor: text;
    min-height: 1em;
  }
  [data-edit-path]:hover {
    box-shadow: 0 0 0 2px rgba(124, 58, 237, 0.24);
  }
  [data-edit-path][contenteditable="true"]:focus {
    outline: 2px solid #7c3aed;
    outline-offset: 2px;
    background: rgba(255,255,255,0.72);
  }
`;

function updatePathValue(target: unknown, parts: string[], value: string): unknown {
  if (parts.length === 0) return value;
  const [head, ...rest] = parts;
  if (Array.isArray(target)) {
    const index = Number(head);
    const next = [...target];
    next[index] = updatePathValue(next[index], rest, value);
    return next;
  }
  if (target && typeof target === 'object') {
    return {
      ...(target as Record<string, unknown>),
      [head]: updatePathValue((target as Record<string, unknown>)[head], rest, value),
    };
  }
  return target;
}

function updateSectionText(section: DetailSection, path: string, value: string): DetailSection {
  return updatePathValue(section, path.split('.'), value) as DetailSection;
}

function buildEditablePreviewDocument(html: string): string {
  const script = `
    (() => {
      const post = (type, el) => {
        const section = el.closest('[data-section-id]');
        if (!section) return;
        window.parent.postMessage({
          source: 'detail-preview-inline-editor',
          type,
          sectionId: section.getAttribute('data-section-id'),
          path: el.getAttribute('data-edit-path'),
          value: el.textContent || ''
        }, '*');
      };
      document.querySelectorAll('[data-edit-path]').forEach((el) => {
        el.setAttribute('contenteditable', 'true');
        el.setAttribute('spellcheck', 'false');
        el.addEventListener('input', () => post('input', el));
        el.addEventListener('blur', () => post('commit', el));
      });
    })();
  `;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>${PREVIEW_GUIDE_CSS}</style>
</head>
<body style="margin:0;background:#fff;">
${html}
<script>${script}<\/script>
</body>
</html>`;
}
```

- [ ] **Step 2: onSectionImageAiEdit prop 추가, sectionsRef + message listener 추가**

`DetailPageEditorProps` 인터페이스에 새 prop 추가:

```typescript
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
  /** 섹션 이미지 AI 편집 — 없으면 버튼 미노출 */
  onSectionImageAiEdit?: (sectionId: string, imageUrl: string, imageIndex: number) => void;
}
```

컴포넌트 함수 구조분해에 `onSectionImageAiEdit` 추가:

```typescript
export default function DetailPageEditor({
  sections,
  theme,
  isGenerating = false,
  onSectionsChange,
  onThemeChange,
  onRegenerateAll,
  onSectionAiEdit,
  onHtmlCopy,
  onDownload,
  generatedHtml,
  hidePreview = false,
  onSectionImageAiEdit,
}: DetailPageEditorProps) {
```

기존 `const addMenuRef = useRef...` 바로 아래에 추가:

```typescript
  // 인라인 편집: message handler에서 stale closure 방지
  const sectionsRef = useRef<DetailSection[]>(sections);
  sectionsRef.current = sections;

  // 인라인 편집: generatedHtml을 contenteditable 문서로 래핑
  const editablePreviewHtml = useMemo(
    () => (!hidePreview && generatedHtml ? buildEditablePreviewDocument(generatedHtml) : ''),
    [hidePreview, generatedHtml],
  );

  // 인라인 편집: iframe → parent postMessage 수신
  const handleInlineEdit = useCallback(
    (sectionId: string, path: string, value: string, commit: boolean) => {
      const next = sectionsRef.current.map((s) =>
        s.id === sectionId ? updateSectionText(s, path, value) : s,
      );
      sectionsRef.current = next;
      onSectionsChange(next);
    },
    [onSectionsChange],
  );

  useEffect(() => {
    if (hidePreview) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        source?: string;
        type?: string;
        sectionId?: string;
        path?: string;
        value?: string;
      };
      if (data?.source !== 'detail-preview-inline-editor') return;
      if (!data.sectionId || !data.path || typeof data.value !== 'string') return;
      handleInlineEdit(data.sectionId, data.path, data.value, data.type === 'commit');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [hidePreview, handleInlineEdit]);
```

- [ ] **Step 3: SectionCard에 onSectionImageAiEdit 전달 + iframe srcDoc 교체**

`<SectionCard ... />` 렌더링 블록에 prop 추가:

```tsx
<SectionCard
  key={section.id}
  section={section}
  isActive={activeSectionId === section.id}
  onAiEdit={onSectionAiEdit}
  onDelete={handleDelete}
  onClick={handleSectionClick}
  onImagesChange={handleImagesChange}
  palette={theme.palette}
  onSectionImageAiEdit={onSectionImageAiEdit}
/>
```

미리보기 iframe의 `srcDoc` 교체 (기존 `srcDoc={generatedHtml}` → `srcDoc={editablePreviewHtml}`):

```tsx
<iframe
  srcDoc={editablePreviewHtml}
  title="상세페이지 미리보기"
  sandbox="allow-scripts allow-same-origin"
  style={{
    width: '100%',
    height: '100%',
    border: 'none',
    minHeight: 600,
    borderRadius: 8,
    background: '#ffffff',
    boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
  }}
/>
```

> **주의:** 기존 `sandbox="allow-same-origin"` → `sandbox="allow-scripts allow-same-origin"`으로 변경. 인라인 스크립트 실행 허용이 필요하다.

- [ ] **Step 4: TypeScript 오류 확인**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep "DetailPageEditor\|SectionCard"
```

Expected: 출력 없음

- [ ] **Step 5: 커밋**

```bash
git add src/components/listing/detail-editor/DetailPageEditor.tsx
git commit -m "feat(DetailPageEditor): 인라인 텍스트 편집, 섹션 구분 CSS, onSectionImageAiEdit prop 추가"
```

---

## Task 5: AssetsResultPanel — 섹션 이미지 AI 편집 모달 연결

**Files:**
- Modify: `src/components/listing/assets/AssetsResultPanel.tsx`

- [ ] **Step 1: sectionImageEditTarget state 추가**

기존 `const [mergeTarget, setMergeTarget] = useState...` 바로 아래에 추가:

```typescript
  // 섹션 이미지 AI 편집 모달 타겟
  const [sectionImageEditTarget, setSectionImageEditTarget] = useState<{
    sectionId: string;
    imageUrl: string;
    imageIndex: number;
  } | null>(null);
```

- [ ] **Step 2: handleSectionImageAiEditSaved 핸들러 추가**

`handleMergeSaved` 함수 바로 아래에 추가:

```typescript
  const handleSectionImageAiEditSaved = (resultUrl: string) => {
    if (!sectionImageEditTarget) return;
    const { sectionId, imageIndex } = sectionImageEditTarget;
    const updated = detailPageSections.map((s) => {
      if (s.id !== sectionId) return s;
      const newImages = [...s.attachedImages];
      newImages[imageIndex] = { ...newImages[imageIndex], url: resultUrl };
      return { ...s, attachedImages: newImages };
    });
    updateAssetsDraft({ detailPageSections: updated });
    refreshRenderedHtml(updated, detailPageTheme);
    setSectionImageEditTarget(null);
  };
```

- [ ] **Step 3: DetailPageEditor에 onSectionImageAiEdit prop 전달**

기존 `<DetailPageEditor ... />` 블록에 prop 추가:

```tsx
<DetailPageEditor
  sections={detailPageSections}
  theme={detailPageTheme}
  isGenerating={isRendering}
  onSectionsChange={(sections) => {
    updateAssetsDraft({ detailPageSections: sections });
  }}
  onThemeChange={(theme) => {
    updateAssetsDraft({ detailPageTheme: theme });
    refreshRenderedHtml(detailPageSections, theme);
  }}
  onSectionAiEdit={handleSectionAiEdit}
  onHtmlCopy={async () => {
    await navigator.clipboard.writeText(generatedDetailHtml).catch(() => {});
  }}
  onDownload={() => {
    const blob = new Blob([generatedDetailHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'detail-page.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }}
  generatedHtml={generatedDetailHtml}
  onSectionImageAiEdit={(sectionId, imageUrl, imageIndex) =>
    setSectionImageEditTarget({ sectionId, imageUrl, imageIndex })
  }
/>
```

- [ ] **Step 4: 섹션 이미지 AI 편집 모달 JSX 추가**

기존 `{/* 두 이미지 합치기 모달 */}` 블록 바로 아래에 추가:

```tsx
{/* 섹션 이미지 AI 편집 모달 */}
{sectionImageEditTarget && (
  <AiEditModal
    imageUrl={sectionImageEditTarget.imageUrl}
    imageFile={null}
    onClose={() => setSectionImageEditTarget(null)}
    onSave={handleSectionImageAiEditSaved}
  />
)}
```

- [ ] **Step 5: TypeScript 오류 확인**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep "AssetsResultPanel"
```

Expected: 출력 없음

- [ ] **Step 6: 커밋**

```bash
git add src/components/listing/assets/AssetsResultPanel.tsx
git commit -m "feat(AssetsResultPanel): 섹션 이미지 AI 편집 모달 연결"
```

---

## Task 6: AssetsInputPanel — 업로드 이미지 AI 편집 버튼

**Files:**
- Modify: `src/components/listing/assets/AssetsInputPanel.tsx`

- [ ] **Step 1: AiEditModal import 및 state 추가**

파일 상단 import에 AiEditModal 추가:

```typescript
import AiEditModal from '@/components/listing/AiEditModal';
```

`export default function AssetsInputPanel({ onGenerate }: Props) {` 블록 내부, 기존 `const thumbInputRef = ...` 바로 아래에 state 추가:

```typescript
  const [inputImageEditTarget, setInputImageEditTarget] = useState<{
    slot: 'thumbnail' | 'detail';
    index: number;
    url: string;
  } | null>(null);
```

`useState` import 추가 (기존 import React에서 `useState`가 없으면 추가):

```typescript
import React, { useRef, useState } from 'react';
```

- [ ] **Step 2: handleInputImageAiEditSaved 핸들러 추가**

`removeAt` 함수 바로 아래에 추가:

```typescript
  const handleInputImageAiEditSaved = (resultUrl: string) => {
    if (!inputImageEditTarget) return;
    const { slot, index } = inputImageEditTarget;
    if (slot === 'thumbnail') {
      const next = [...thumbnailFiles];
      next[index] = resultUrl;
      updateAssetsDraft({ thumbnailFiles: next });
    } else {
      const next = [...detailFiles];
      next[index] = resultUrl;
      updateAssetsDraft({ detailFiles: next });
    }
    setInputImageEditTarget(null);
  };
```

- [ ] **Step 3: renderSlot 이미지 그리드에 AI 편집 버튼 추가**

`renderSlot` 함수 내부, 각 이미지 렌더링 블록에서 삭제 버튼(`×`) 아래에 AI 편집 버튼 추가.

기존 삭제 버튼을 찾아 그 바로 아래에 추가:

```tsx
{/* AI 편집 버튼 */}
{!isGenerating && (
  <button
    type="button"
    onClick={() => setInputImageEditTarget({ slot, index: i, url: u })}
    title="AI로 편집"
    style={{
      position: 'absolute',
      bottom: 4,
      left: 4,
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      padding: '2px 6px',
      fontSize: 10,
      fontWeight: 600,
      background: '#7c3aed',
      color: '#fff',
      border: 'none',
      borderRadius: 4,
      cursor: 'pointer',
    }}
  >
    🪄
  </button>
)}
```

- [ ] **Step 4: AiEditModal JSX 추가**

컴포넌트 `return` 블록의 최상위 `<div>` 마지막에 추가:

```tsx
{/* 업로드 이미지 AI 편집 모달 */}
{inputImageEditTarget && (
  <AiEditModal
    imageUrl={inputImageEditTarget.url}
    imageFile={null}
    onClose={() => setInputImageEditTarget(null)}
    onSave={handleInputImageAiEditSaved}
  />
)}
```

- [ ] **Step 5: TypeScript 오류 확인**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep "AssetsInputPanel"
```

Expected: 출력 없음

- [ ] **Step 6: 전체 빌드 확인**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | head -30
```

Expected: 오류 없음 또는 이 기능과 무관한 기존 오류만

- [ ] **Step 7: 전체 테스트 실행**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: 새로 추가한 테스트 포함 전체 PASS (기존 통과 테스트도 유지)

- [ ] **Step 8: 커밋**

```bash
git add src/components/listing/assets/AssetsInputPanel.tsx
git commit -m "feat(AssetsInputPanel): 업로드 이미지 AI 편집 버튼 추가"
```

---

## 완료 체크리스트

- [ ] section-renderer: 2장 나란히 렌더링 동작 (unit test 통과)
- [ ] SectionImageAttachment: MAX 2장 제한 동작, 🪄 버튼 노출
- [ ] SectionCard: onSectionImageAiEdit prop 연결
- [ ] DetailPageEditor: 미리보기에서 텍스트 hover 시 보라색 아웃라인, 클릭 시 편집 가능
- [ ] AssetsResultPanel: 섹션 이미지 🪄 클릭 → AiEditModal 열림 → 저장 시 섹션 이미지 URL 교체
- [ ] AssetsInputPanel: 업로드 이미지 🪄 클릭 → AiEditModal 열림 → 저장 시 thumbnailFiles/detailFiles URL 교체
- [ ] 전체 TypeScript 빌드 통과
- [ ] 전체 Vitest 테스트 통과
