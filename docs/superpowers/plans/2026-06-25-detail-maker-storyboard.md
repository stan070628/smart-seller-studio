# Detail Maker 스토리라인 씬 기획 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 씬 이미지 생성 전 Claude가 씬 스토리라인을 제시하고 사용자가 편집 후 생성하는 2단계 흐름 구현

**Architecture:** plan-scene-images API로 스토리라인 기획 → StoryboardEditor에서 씬 편집/순서변경/이미지매핑 → generateSceneImages 호출 시 storyboard 반영해 씬별 소스이미지·프롬프트 적용

**Tech Stack:** Next.js App Router, callClaude (claude-cli), @dnd-kit/sortable, React state, Vitest

---

## 파일 구조

| 파일 | 종류 | 역할 |
|------|------|------|
| `src/types/detail-page.ts` | 수정 | `SceneStoryboardItem` 타입 추가 |
| `src/app/api/ai/plan-scene-images/route.ts` | 신규 | Claude로 씬 스토리라인 생성 API |
| `src/__tests__/api/plan-scene-images.test.ts` | 신규 | plan-scene-images route 단위 테스트 |
| `src/components/listing/detail-maker/StoryboardEditor.tsx` | 신규 | 씬 카드 편집 UI 컴포넌트 |
| `src/__tests__/components/storyboard-editor.test.tsx` | 신규 | StoryboardEditor 단위 테스트 |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | 수정 | 2단계 흐름 상태·핸들러·JSX |

---

### Task 1: SceneStoryboardItem 타입 추가

**Files:**
- Modify: `src/types/detail-page.ts` (파일 끝에 추가)

- [ ] **Step 1: `SceneStoryboardItem` 인터페이스를 `src/types/detail-page.ts` 끝에 추가**

```typescript
// src/types/detail-page.ts 파일 끝에 추가
export interface SceneStoryboardItem {
  id: string;                 // crypto.randomUUID()
  title: string;
  description: string;
  prompt: string;
  sourceImageIndex: number;   // uploadedUrls[sourceImageIndex]
  mode: 'ai' | 'cleanup';
}
```

- [ ] **Step 2: TypeScript 빌드 확인**

```bash
Run: npx tsc --noEmit 2>&1 | head -20
Expected: 에러 없음 (또는 기존 에러만 출력)
```

- [ ] **Step 3: 커밋**

```bash
git add src/types/detail-page.ts
git commit -m "feat(types): add SceneStoryboardItem interface"
```

---

### Task 2: plan-scene-images API 라우트

**Files:**
- Create: `src/app/api/ai/plan-scene-images/route.ts`
- Test: `src/__tests__/api/plan-scene-images.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

```typescript
// src/__tests__/api/plan-scene-images.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true }),
  getRateLimitKey: vi.fn().mockReturnValue('key'),
}));

const mockCallClaude = vi.fn();
vi.mock('@/lib/ai/claude-cli', () => ({
  callClaude: (...args: unknown[]) => mockCallClaude(...args),
}));

import { POST } from '@/app/api/ai/plan-scene-images/route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/ai/plan-scene-images', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const VALID_BODY = { productName: '에어팟', category: 'basic', imageCount: 2, sceneCount: 2 };
const MOCK_SCENES = [
  { title: '전면샷', description: '제품 정면', prompt: 'Studio product shot on white background...', suggestedImageIndex: 0 },
  { title: '라이프스타일', description: '일상 사용', prompt: 'Lifestyle scene with warm natural light...', suggestedImageIndex: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockCallClaude.mockResolvedValue(JSON.stringify({ scenes: MOCK_SCENES }));
});

describe('POST /api/ai/plan-scene-images', () => {
  it('정상 요청 시 scenes 배열 반환', async () => {
    const res = await POST(makeRequest(VALID_BODY));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.scenes).toHaveLength(2);
    expect(json.scenes[0].title).toBe('전면샷');
  });

  it('Claude가 ```json 코드블록으로 감싸 반환해도 파싱 성공', async () => {
    mockCallClaude.mockResolvedValue('```json\n' + JSON.stringify({ scenes: MOCK_SCENES }) + '\n```');
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.scenes).toHaveLength(2);
  });

  it('suggestedImageIndex가 imageCount 범위를 초과하면 imageCount-1로 클램핑', async () => {
    const overflowScenes = [{ ...MOCK_SCENES[0], suggestedImageIndex: 99 }];
    mockCallClaude.mockResolvedValue(JSON.stringify({ scenes: overflowScenes }));
    const res = await POST(makeRequest(VALID_BODY));
    const json = await res.json();
    expect(json.scenes[0].suggestedImageIndex).toBe(1); // imageCount-1 = 1
  });

  it('productName 없으면 400', async () => {
    const res = await POST(makeRequest({ category: 'basic', imageCount: 1 }));
    expect(res.status).toBe(400);
  });

  it('callClaude 실패 시 500', async () => {
    mockCallClaude.mockRejectedValue(new Error('network error'));
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(500);
  });

  it('brandName 포함 시 callClaude에 브랜드명이 전달된다', async () => {
    await POST(makeRequest({ ...VALID_BODY, brandName: '애플' }));
    expect(mockCallClaude).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('애플'),
      'sonnet',
      2048,
    );
  });
});
```

- [ ] **Step 2: 테스트 실패 확인 (라우트 파일 없으므로)**

```bash
Run: npx vitest run src/__tests__/api/plan-scene-images.test.ts
Expected: FAIL — "Cannot find module '@/app/api/ai/plan-scene-images/route'"
```

- [ ] **Step 3: 라우트 파일 구현**

```typescript
// src/app/api/ai/plan-scene-images/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { callClaude } from '@/lib/ai/claude-cli';

export const maxDuration = 30;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 10 };

const RequestBodySchema = z.object({
  productName: z.string().min(1).max(200),
  brandName: z.string().max(100).optional(),
  category: z.enum(['basic', 'fashion', 'living', 'food']),
  imageCount: z.number().int().min(1).max(10),
  referenceText: z.string().max(2000).optional(),
  sceneCount: z.number().int().min(1).max(8).default(4),
});

const SYSTEM_PROMPT = `You are a Korean e-commerce product photographer and content strategist.
Create a scene image storyboard for a product detail page.
Return ONLY valid JSON (no markdown, no code block): {"scenes": [...]}

Each scene object must have:
- title: Korean string, max 15 chars (e.g. "제품 전면 클로즈업")
- description: one-line Korean marketing purpose, max 50 chars
- prompt: detailed English Gemini image generation prompt, 80-150 words
- suggestedImageIndex: integer 0-based, which uploaded image index to use

Prompt format: [Setting/environment]. [Product placement]. [Lighting quality]. [Camera angle and framing]. [Mood and color palette]. No text, logos, or watermarks in the scene. The product must appear exactly as-is — do not alter its shape, color, or material.

Make each scene serve a distinct purpose: studio hero shot, lifestyle in-use scene, texture/detail macro, benefit visualization.`;

const CATEGORY_LABELS: Record<string, string> = {
  basic: '일반 상품',
  fashion: '패션/의류',
  living: '생활/인테리어',
  food: '식품/음료',
};

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult as NextResponse;

  const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'plan-scene-images'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '입력값이 올바르지 않습니다.' }, { status: 400 });
  }

  const { productName, brandName, category, imageCount, referenceText, sceneCount } = parsed.data;

  const userPrompt = `Product: ${[brandName, productName].filter(Boolean).join(' ')}
Category: ${CATEGORY_LABELS[category] ?? category}
Number of uploaded images: ${imageCount}
${referenceText ? `Reference context: ${referenceText}` : ''}

Create ${sceneCount} diverse scene storyboard items for the product detail page.`;

  try {
    const raw = await callClaude(SYSTEM_PROMPT, userPrompt, 'sonnet', 2048);
    const jsonStr = raw.replace(/^```json\s*/m, '').replace(/```\s*$/m, '').trim();
    const data = JSON.parse(jsonStr) as { scenes: Array<Record<string, unknown>> };
    if (!Array.isArray(data.scenes)) throw new Error('invalid response shape');

    const scenes = data.scenes.map(s => ({
      ...s,
      suggestedImageIndex: Math.min(
        Math.max(Number(s.suggestedImageIndex) || 0, 0),
        imageCount - 1,
      ),
    }));

    return NextResponse.json({ scenes });
  } catch {
    return NextResponse.json(
      { error: '스토리라인 생성 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
Run: npx vitest run src/__tests__/api/plan-scene-images.test.ts
Expected: PASS — 6 tests passed
```

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/ai/plan-scene-images/route.ts src/__tests__/api/plan-scene-images.test.ts
git commit -m "feat(api): add plan-scene-images route for storyboard generation"
```

---

### Task 3: StoryboardEditor 컴포넌트

**Files:**
- Create: `src/components/listing/detail-maker/StoryboardEditor.tsx`
- Test: `src/__tests__/components/storyboard-editor.test.tsx`

- [ ] **Step 1: 테스트 파일 작성**

```typescript
// src/__tests__/components/storyboard-editor.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StoryboardEditor from '@/components/listing/detail-maker/StoryboardEditor';
import type { SceneStoryboardItem } from '@/types/detail-page';

// dnd-kit은 DOM 환경 없이 테스트하기 어려우므로 mock
vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core');
  return {
    ...actual,
    DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});
vi.mock('@dnd-kit/sortable', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/sortable')>('@dnd-kit/sortable');
  return {
    ...actual,
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      transition: null,
    }),
    SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

const makeScene = (overrides: Partial<SceneStoryboardItem> = {}): SceneStoryboardItem => ({
  id: 'scene-1',
  title: '전면샷',
  description: '제품 정면 강조',
  prompt: 'Studio lighting on white background...',
  sourceImageIndex: 0,
  mode: 'ai',
  ...overrides,
});

const baseProps = {
  scenes: [makeScene()],
  uploadedUrls: ['https://x/a.jpg'],
  isHtmlReady: true,
  isGeneratingScenes: false,
  onScenesChange: vi.fn(),
  onGenerate: vi.fn(),
};

describe('StoryboardEditor', () => {
  it('씬 제목 input이 렌더링된다', () => {
    render(<StoryboardEditor {...baseProps} />);
    expect(screen.getByDisplayValue('전면샷')).toBeInTheDocument();
  });

  it('씬 추가 버튼 클릭 시 onScenesChange에 기존+새 씬 배열 전달', () => {
    const onScenesChange = vi.fn();
    render(<StoryboardEditor {...baseProps} onScenesChange={onScenesChange} />);
    fireEvent.click(screen.getByText(/씬 추가/));
    expect(onScenesChange).toHaveBeenCalledOnce();
    const called = onScenesChange.mock.calls[0][0] as SceneStoryboardItem[];
    expect(called).toHaveLength(2);
    expect(called[1]).toMatchObject({ title: '새 씬', mode: 'ai', sourceImageIndex: 0 });
  });

  it('isHtmlReady=false 이면 씬 이미지 생성 버튼이 disabled', () => {
    render(<StoryboardEditor {...baseProps} isHtmlReady={false} />);
    expect(screen.getByRole('button', { name: /씬 이미지 생성/ })).toBeDisabled();
  });

  it('isHtmlReady=true, isGeneratingScenes=false 이면 씬 이미지 생성 버튼 활성화', () => {
    render(<StoryboardEditor {...baseProps} isHtmlReady={true} isGeneratingScenes={false} />);
    expect(screen.getByRole('button', { name: /② 씬 이미지 생성/ })).not.toBeDisabled();
  });

  it('씬 이미지 생성 버튼 클릭 시 onGenerate 호출', () => {
    const onGenerate = vi.fn();
    render(<StoryboardEditor {...baseProps} onGenerate={onGenerate} />);
    fireEvent.click(screen.getByRole('button', { name: /② 씬 이미지 생성/ }));
    expect(onGenerate).toHaveBeenCalledOnce();
  });

  it('제목 수정 시 onScenesChange가 업데이트된 씬으로 호출됨', () => {
    const onScenesChange = vi.fn();
    render(<StoryboardEditor {...baseProps} onScenesChange={onScenesChange} />);
    fireEvent.change(screen.getByDisplayValue('전면샷'), { target: { value: '새 제목' } });
    expect(onScenesChange).toHaveBeenCalledWith([
      expect.objectContaining({ title: '새 제목' }),
    ]);
  });

  it('삭제 버튼 클릭 시 씬이 제거된 빈 배열 전달', () => {
    const onScenesChange = vi.fn();
    render(<StoryboardEditor {...baseProps} onScenesChange={onScenesChange} />);
    fireEvent.click(screen.getByRole('button', { name: /🗑/ }));
    expect(onScenesChange).toHaveBeenCalledWith([]);
  });

  it('isGeneratingScenes=true 이면 버튼 텍스트가 "씬 이미지 생성 중…"으로 변경되고 disabled', () => {
    render(<StoryboardEditor {...baseProps} isGeneratingScenes={true} />);
    const btn = screen.getByRole('button', { name: /씬 이미지 생성 중/ });
    expect(btn).toBeDisabled();
  });

  it('isHtmlReady=false 이면 "상세페이지 HTML 생성 중…" 안내 텍스트 노출', () => {
    render(<StoryboardEditor {...baseProps} isHtmlReady={false} />);
    expect(screen.getByText(/상세페이지 HTML 생성 중/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
Run: npx vitest run src/__tests__/components/storyboard-editor.test.tsx
Expected: FAIL — "Cannot find module '@/components/listing/detail-maker/StoryboardEditor'"
```

- [ ] **Step 3: StoryboardEditor 컴포넌트 구현**

```tsx
// src/components/listing/detail-maker/StoryboardEditor.tsx
'use client';

import React from 'react';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { C } from '@/lib/design-tokens';
import type { SceneStoryboardItem } from '@/types/detail-page';

export interface StoryboardEditorProps {
  scenes: SceneStoryboardItem[];
  uploadedUrls: string[];
  isHtmlReady: boolean;
  isGeneratingScenes: boolean;
  onScenesChange: (scenes: SceneStoryboardItem[]) => void;
  onGenerate: () => void;
}

interface SceneCardProps {
  scene: SceneStoryboardItem;
  uploadedUrls: string[];
  onUpdate: (updated: SceneStoryboardItem) => void;
  onDelete: () => void;
}

function SceneCard({ scene, uploadedUrls, onUpdate, onDelete }: SceneCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: scene.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        background: '#2d2d44',
        borderRadius: '8px',
        padding: '14px',
        marginBottom: '10px',
        borderLeft: `3px solid ${scene.mode === 'cleanup' ? '#059669' : '#6366f1'}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span
          {...attributes}
          {...listeners}
          style={{ color: '#6b7280', fontSize: '14px', cursor: 'grab', userSelect: 'none' }}
        >
          ⠿
        </span>
        <input
          value={scene.title}
          onChange={e => onUpdate({ ...scene, title: e.target.value })}
          placeholder="씬 제목"
          style={{
            flex: 1,
            background: '#1a1a2e',
            border: '1px solid #4b5563',
            borderRadius: '5px',
            padding: '4px 8px',
            color: '#fff',
            fontSize: '13px',
          }}
        />
        <button
          onClick={onDelete}
          aria-label="씬 삭제 🗑"
          style={{ background: 'transparent', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }}
        >
          🗑
        </button>
      </div>

      <input
        value={scene.description}
        onChange={e => onUpdate({ ...scene, description: e.target.value })}
        placeholder="씬 설명 (한 줄)"
        style={{
          width: '100%',
          background: '#1a1a2e',
          border: '1px solid #374151',
          borderRadius: '5px',
          padding: '4px 8px',
          color: '#9ca3af',
          fontSize: '12px',
          marginBottom: '8px',
          boxSizing: 'border-box',
        }}
      />

      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
        {scene.mode === 'ai' && (
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '4px' }}>IMAGE PROMPT</div>
            <textarea
              value={scene.prompt}
              onChange={e => onUpdate({ ...scene, prompt: e.target.value })}
              style={{
                width: '100%',
                background: '#111827',
                border: '1px solid #374151',
                borderRadius: '5px',
                padding: '6px 8px',
                color: '#9ca3af',
                fontSize: '11px',
                boxSizing: 'border-box',
                resize: 'vertical',
                height: '60px',
              }}
            />
          </div>
        )}

        <div style={{ width: scene.mode === 'ai' ? '80px' : '100%', flexShrink: 0 }}>
          <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '4px' }}>소스 이미지</div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {uploadedUrls.map((url, i) => (
              <button
                key={i}
                onClick={() => onUpdate({ ...scene, sourceImageIndex: i })}
                aria-label={`이미지 ${i + 1} 선택`}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '4px',
                  border: scene.sourceImageIndex === i ? '2px solid #6366f1' : '2px solid transparent',
                  padding: 0,
                  cursor: 'pointer',
                  overflow: 'hidden',
                  background: '#374151',
                }}
              >
                <img
                  src={url}
                  alt={`이미지 ${i + 1}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StoryboardEditor({
  scenes,
  uploadedUrls,
  isHtmlReady,
  isGeneratingScenes,
  onScenesChange,
  onGenerate,
}: StoryboardEditorProps) {
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = scenes.findIndex(s => s.id === active.id);
    const newIndex = scenes.findIndex(s => s.id === over.id);
    onScenesChange(arrayMove(scenes, oldIndex, newIndex));
  }

  function handleAddScene() {
    onScenesChange([
      ...scenes,
      {
        id: crypto.randomUUID(),
        title: '새 씬',
        description: '',
        prompt: '',
        sourceImageIndex: 0,
        mode: 'ai',
      },
    ]);
  }

  const canGenerate = isHtmlReady && !isGeneratingScenes;

  return (
    <div style={{ padding: '16px', overflowY: 'auto', height: '100%' }}>
      <div style={{ fontSize: '15px', fontWeight: 600, color: C.text, marginBottom: '4px' }}>
        스토리라인 편집
      </div>
      <div style={{ fontSize: '12px', color: C.textSub, marginBottom: '16px' }}>
        씬을 드래그해 순서를 변경하거나 프롬프트를 직접 수정할 수 있어요
      </div>

      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={scenes.map(s => s.id)} strategy={verticalListSortingStrategy}>
          {scenes.map((scene, i) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              uploadedUrls={uploadedUrls}
              onUpdate={updated => {
                const next = [...scenes];
                next[i] = updated;
                onScenesChange(next);
              }}
              onDelete={() => onScenesChange(scenes.filter((_, j) => j !== i))}
            />
          ))}
        </SortableContext>
      </DndContext>

      <button
        onClick={handleAddScene}
        style={{
          width: '100%',
          padding: '10px',
          background: 'transparent',
          border: '1px dashed #4b5563',
          borderRadius: '8px',
          color: '#6b7280',
          fontSize: '13px',
          cursor: 'pointer',
          marginBottom: '14px',
        }}
      >
        + 씬 추가
      </button>

      {!isHtmlReady && (
        <div style={{ fontSize: '12px', color: '#9ca3af', textAlign: 'center', marginBottom: '8px' }}>
          상세페이지 HTML 생성 중…
        </div>
      )}

      <button
        onClick={onGenerate}
        disabled={!canGenerate}
        style={{
          width: '100%',
          padding: '12px',
          background: canGenerate ? '#6366f1' : '#374151',
          border: 'none',
          borderRadius: '8px',
          color: canGenerate ? '#fff' : '#6b7280',
          fontSize: '14px',
          fontWeight: 600,
          cursor: canGenerate ? 'pointer' : 'not-allowed',
        }}
      >
        {isGeneratingScenes ? '씬 이미지 생성 중…' : '② 씬 이미지 생성'}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
Run: npx vitest run src/__tests__/components/storyboard-editor.test.tsx
Expected: PASS — 8 tests passed
```

- [ ] **Step 5: 커밋**

```bash
git add src/components/listing/detail-maker/StoryboardEditor.tsx src/__tests__/components/storyboard-editor.test.tsx
git commit -m "feat(ui): add StoryboardEditor component with dnd-kit drag sorting"
```

---

### Task 4: DetailMakerClient 수정 (2단계 흐름)

**Files:**
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx`

기존 `handleGenerate()`가 HTML+씬을 일괄 생성했지만, 신규 흐름에서는:
1. `handlePlanStoryboard()` → HTML 생성(background) + 스토리라인 기획(parallel) → StoryboardEditor 표시
2. `handleGenerateScenesFromStoryboard()` → 사용자가 편집 후 "② 씬 이미지 생성" 클릭 시 실행

- [ ] **Step 1: import에 `SceneStoryboardItem` 추가**

파일 상단 import 라인 수정 (`src/app/listing/detail-maker/DetailMakerClient.tsx:12`):

```typescript
// 기존
import type { DetailSection, DetailPageTheme, CreativeBrief } from '@/types/detail-page';

// 변경 후
import type { DetailSection, DetailPageTheme, CreativeBrief, SceneStoryboardItem } from '@/types/detail-page';
```

그리고 파일 상단에 `StoryboardEditor` import 추가 (기존 import 블록 안):

```typescript
import StoryboardEditor from '@/components/listing/detail-maker/StoryboardEditor';
```

- [ ] **Step 2: 상태 변수 추가**

기존 상태 블록 끝(line ~54, `const [referenceText, ...]` 바로 아래)에 추가:

```typescript
// 스토리라인
const [storyboard, setStoryboard] = useState<SceneStoryboardItem[] | null>(null);
const [isGeneratingStoryboard, setIsGeneratingStoryboard] = useState(false);
const [storyboardError, setStoryboardError] = useState<string | null>(null);
```

- [ ] **Step 3: `generateSceneImages` 함수에 `storyboard` 파라미터 추가**

기존 함수 시그니처(line ~230):
```typescript
// Before
async function generateSceneImages(
  sectionsSnapshot: DetailSection[],
  refUrls: string[],
  genId: number,
  currentTheme: DetailPageTheme,
  sceneHint?: string,
)
```

변경 후:
```typescript
// After
async function generateSceneImages(
  sectionsSnapshot: DetailSection[],
  refUrls: string[],
  genId: number,
  currentTheme: DetailPageTheme,
  sceneHint?: string,
  storyboardItems?: SceneStoryboardItem[] | null,
)
```

함수 내부 `targets.map(async (section, idx) =>` 블록에서 기존 `startIdx`/`sectionRefUrls`/`combinedHint` 계산 부분을 아래로 교체:

```typescript
// storyboard 있으면 씬별 소스 이미지 + 프롬프트 사용, 없으면 기존 로테이션 로직
let sectionRefUrls: string[];
let combinedHint: string | undefined;

const storyboardScene = storyboardItems?.[idx];
if (storyboardScene) {
  const srcIdx = Math.min(storyboardScene.sourceImageIndex, refUrls.length - 1);
  sectionRefUrls = [refUrls[srcIdx]];
  const promptBase = storyboardScene.prompt.trim() || undefined;
  const headlineBase = headline?.trim() || undefined;
  combinedHint = promptBase ?? headlineBase ?? sceneHint;
} else {
  const startIdx = refUrls.length > 3 ? idx % (refUrls.length - 2) : 0;
  sectionRefUrls = refUrls.slice(startIdx, startIdx + 3);
  combinedHint = [headline?.trim(), sceneHint?.trim()].filter(Boolean).join(' — ') || undefined;
}
```

기존 `sceneRes = await fetch(...)` body에서 `productImageUrls: sectionRefUrls`와 `sceneHint: combinedHint`는 그대로 유지.

- [ ] **Step 4: `handlePlanStoryboard` 함수 추가**

기존 `handleGenerate` 함수 바로 앞에 새 함수 삽입:

```typescript
async function handlePlanStoryboard() {
  if (!productName.trim()) { setError('상품명을 입력하세요.'); return; }
  if (uploadedUrls.length === 0) { setError('이미지를 1장 이상 업로드하세요.'); return; }

  setIsGeneratingStoryboard(true);
  setStoryboardError(null);
  setIsGenerating(true);
  setError(null);
  sceneGenIdRef.current += 1;

  const fullProductName = [brandName.trim(), productName.trim()].filter(Boolean).join(' ');

  // HTML 생성과 스토리라인 기획을 병렬로 시작
  const htmlPromise = fetch('/api/ai/generate-detail-html', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageUrls: uploadedUrls,
      productName: fullProductName,
      category,
      mobileMode: true,
      referenceText: referenceText.trim() || undefined,
    }),
  }).then(r => r.json());

  const storyboardPromise = fetch('/api/ai/plan-scene-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      productName: productName.trim(),
      brandName: brandName.trim() || undefined,
      category,
      imageCount: uploadedUrls.length,
      referenceText: referenceText.trim() || undefined,
      sceneCount: 4,
    }),
  }).then(async r => {
    if (!r.ok) throw new Error(`스토리라인 생성 실패 (${r.status})`);
    return r.json();
  });

  // 스토리라인 완료 즉시 에디터 표시 (HTML 기다리지 않음)
  storyboardPromise
    .then(data => {
      if (!data.scenes) throw new Error(data.error ?? '스토리라인 생성 실패');
      setStoryboard(
        (data.scenes as Array<Record<string, unknown>>).map(s => ({
          ...s,
          id: crypto.randomUUID(),
          mode: 'ai' as const,
        } as SceneStoryboardItem)),
      );
    })
    .catch(e => {
      setStoryboardError(e instanceof Error ? e.message : '스토리라인 생성 중 오류가 발생했습니다.');
    })
    .finally(() => {
      setIsGeneratingStoryboard(false);
    });

  // HTML 완료 시 sections 파싱 (isHtmlReady 역할)
  try {
    const json = await htmlPromise;
    if (!json.success) throw new Error(json.error ?? '생성 실패');
    setGeneratedHtml(json.html);
    if (json.mobileContent) {
      try {
        const parsed = mobileContentToSections(
          json.mobileContent as import('@/lib/ai/prompts/detail-page').MobileDetailPageContent,
          uploadedUrls,
        );
        setSections(parsed);
        await refreshRenderedHtml(parsed, theme);
      } catch (e) {
        console.warn('[detail-maker] mobileContentToSections 실패:', e);
        setError('생성 결과를 편집기로 불러오지 못했습니다. 다시 시도해주세요.');
      }
    }
  } catch (e) {
    setError(e instanceof Error ? e.message : 'HTML 생성 중 오류가 발생했습니다.');
  } finally {
    setIsGenerating(false);
  }
}
```

- [ ] **Step 5: `handleGenerateScenesFromStoryboard` 함수 추가**

`handlePlanStoryboard` 바로 아래에 추가:

```typescript
function handleGenerateScenesFromStoryboard() {
  if (sections.length === 0) return;
  sceneGenIdRef.current += 1;
  const currentGenId = sceneGenIdRef.current;
  setIsGeneratingScenes(true);
  void generateSceneImages(
    sections,
    uploadedUrls,
    currentGenId,
    theme,
    creativeBrief?.sceneHint,
    storyboard,
  ).finally(() => {
    if (sceneGenIdRef.current === currentGenId) setIsGeneratingScenes(false);
  });
}
```

- [ ] **Step 6: JSX 변경 — `onGenerate` prop 교체 및 StoryboardEditor 추가**

`DetailMakerInputPanel`의 `onGenerate` prop을 `handlePlanStoryboard`로 교체 (line ~548):

```tsx
// 기존
onGenerate={handleGenerate}

// 변경 후
onGenerate={handlePlanStoryboard}
```

우측 패널의 `sections.length > 0 ? ... : ...` 분기 (line ~580)를 3단계로 변경:

```tsx
{sections.length > 0 ? (
  <>
    <DetailPageEditor
      sections={sections}
      theme={theme}
      isGenerating={isRendering || isGenerating}
      onSectionsChange={handleSectionsChange}
      onThemeChange={handleThemeChange}
      onRegenerateAll={handlePlanStoryboard}
      onSectionAiEdit={handleSectionAiEdit}
      onHtmlCopy={handleHtmlCopy}
      onDownload={handleDownload}
      generatedHtml={generatedHtml}
      uploadedUrls={uploadedUrls}
      onSceneEdit={handleSceneEdit}
      editingSectionId={editingSectionId}
      sceneEditError={sceneEditError}
      prevSceneUrlMap={prevSceneUrls.current}
      onSceneUndo={handleSceneUndo}
    />
    {isGeneratingScenes && (
      <div style={{
        position: 'absolute', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(124,58,237,0.92)', color: '#fff', padding: '8px 18px',
        borderRadius: '24px', fontSize: '13px', fontWeight: 600,
        backdropFilter: 'blur(4px)', pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 10,
      }}>
        ✨ AI 씬 이미지 생성 중...
      </div>
    )}
  </>
) : storyboard !== null ? (
  <>
    {storyboardError && (
      <div style={{ padding: '12px 16px', background: '#450a0a', color: '#fca5a5', fontSize: '13px' }}>
        {storyboardError}
      </div>
    )}
    <StoryboardEditor
      scenes={storyboard}
      uploadedUrls={uploadedUrls}
      isHtmlReady={!isGenerating && generatedHtml !== ''}
      isGeneratingScenes={isGeneratingScenes}
      onScenesChange={setStoryboard}
      onGenerate={handleGenerateScenesFromStoryboard}
    />
  </>
) : (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: '100%', color: C.textSub, gap: '12px',
  }}>
    {isGenerating || isGeneratingStoryboard ? (
      <>
        <div style={{ fontSize: '32px' }}>✨</div>
        <div style={{ fontSize: '15px', fontWeight: 600, color: C.text }}>
          {isGeneratingStoryboard ? '스토리라인을 구성하고 있어요' : 'AI가 상세페이지를 생성하고 있어요'}
        </div>
        <div style={{ fontSize: '13px' }}>잠시만 기다려주세요...</div>
      </>
    ) : (
      <>
        <div style={{ fontSize: '40px' }}>📄</div>
        <div style={{ fontSize: '15px', fontWeight: 600, color: C.text }}>상품상세 자동만들기</div>
        <div style={{ fontSize: '13px', textAlign: 'center', lineHeight: 1.6 }}>
          왼쪽에서 상품명과 이미지를 입력하고
          <br />
          스토리라인 구성 버튼을 눌러보세요
        </div>
      </>
    )}
  </div>
)}
```

- [ ] **Step 7: TypeScript 빌드 확인**

```bash
Run: npx tsc --noEmit 2>&1 | head -30
Expected: 에러 없음 (또는 기존 에러만)
```

- [ ] **Step 8: 커밋**

```bash
git add src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "feat(detail-maker): add 2-step storyboard flow before scene generation"
```

---

## 전체 검증

- [ ] **로컬 서버 기동 후 수동 테스트**

```bash
Run: npm run dev
```

1. `/listing/detail-maker` 접속
2. 상품명 입력 + 이미지 업로드 후 "스토리라인 구성" 클릭
3. StoryboardEditor가 우측에 나타나는지 확인
4. HTML 생성 완료 후 "② 씬 이미지 생성" 버튼 활성화 확인
5. 씬 제목 수정·순서 변경·소스 이미지 선택 후 생성 클릭
6. 씬별로 지정된 소스 이미지 기반의 씬 이미지가 각 섹션에 반영되는지 확인

- [ ] **전체 테스트 실행**

```bash
Run: npx vitest run src/__tests__/api/plan-scene-images.test.ts src/__tests__/components/storyboard-editor.test.tsx
Expected: PASS — 모든 테스트 통과
```
