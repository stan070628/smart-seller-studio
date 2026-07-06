# Detail Plan Review (Blueprint 뷰) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상품상세 자동만들기에서 Gemini 이미지 생성 전 Claude가 작성한 텍스트 구조 + 씬 이미지 기획을 함께 보여주는 Blueprint 리뷰 단계를 추가한다.

**Architecture:** `detailStep` 상태 머신(`idle|generating|planning|editing`)이 렌더 분기의 단일 소스가 된다. `SceneStoryboardItem`에 `sectionId` 필드를 추가해 인덱스 기반 매핑을 ID 기반으로 전환한다. `DetailPlanReview` 컴포넌트가 텍스트 섹션과 이미지 기획을 통합 카드로 표시하며 `StoryboardEditor`를 대체한다.

**Tech Stack:** Next.js App Router, React, TypeScript, @dnd-kit/core (기존 DnD), Vitest + React Testing Library

---

## 파일 구조

| 파일 | 변경 |
|------|------|
| `src/types/detail-page.ts` | `SceneStoryboardItem`에 `sectionId: string \| null` 추가 |
| `src/lib/detail-page/storyboard-mapping.ts` | 신규 — ID 기반 매핑 헬퍼 |
| `src/__tests__/lib/storyboard-mapping.test.ts` | 신규 — 헬퍼 단위 테스트 |
| `src/components/listing/detail-maker/DetailPlanReview.tsx` | 신규 — Blueprint 뷰 컴포넌트 |
| `src/__tests__/components/detail-plan-review.test.tsx` | 신규 — 컴포넌트 테스트 |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | 수정 — step 상태 머신, 렌더 분기, ID 기반 매핑 |
| `src/components/listing/detail-maker/DetailMakerInputPanel.tsx` | 수정 — 버튼 레이블 |
| `src/components/listing/detail-maker/StoryboardEditor.tsx` | 삭제 |

---

## Task 1: SceneStoryboardItem 타입에 sectionId 추가

**Files:**
- Modify: `src/types/detail-page.ts`

- [ ] **Step 1: `sectionId` 필드 추가**

`src/types/detail-page.ts`의 `SceneStoryboardItem` 인터페이스를 아래와 같이 수정한다:

```ts
export interface SceneStoryboardItem {
  id: string;
  title: string;
  description: string;
  prompt: string;
  sourceImageIndex: number;
  mode: 'ai' | 'cleanup';
  resultUrl?: string;
  sectionId: string | null;  // 연결된 DetailSection.id, null이면 매핑 없음
}
```

- [ ] **Step 2: TypeScript 컴파일 에러 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx tsc --noEmit 2>&1 | grep -E "SceneStoryboardItem|sectionId" | head -20
```

`sectionId`가 없다는 에러가 여러 파일에서 날 것이다. Task 4에서 모두 수정하므로 지금은 에러 목록만 확인한다.

- [ ] **Step 3: Commit**

```bash
git add src/types/detail-page.ts
git commit -m "feat(types): add sectionId field to SceneStoryboardItem"
```

---

## Task 2: 매핑 헬퍼 함수 작성 (TDD)

**Files:**
- Create: `src/lib/detail-page/storyboard-mapping.ts`
- Create: `src/__tests__/lib/storyboard-mapping.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/storyboard-mapping.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildStoryboardWithSectionIds,
  getSceneForSection,
} from '@/lib/detail-page/storyboard-mapping';
import type { DetailSection, SceneStoryboardItem } from '@/types/detail-page';

const makeSection = (id: string, type: 'hero' | 'point' | 'selling_points'): DetailSection => ({
  id,
  type,
  content: type === 'hero'
    ? { type: 'hero', headline: 'H', subheadline: 'S' }
    : type === 'point'
    ? { type: 'point', pointLabel: null, headline: 'H', subheadline: 'S' }
    : { type: 'selling_points', points: [] },
  attachedImages: [],
});

const makeRawScene = (title: string) => ({
  id: `scene-${title}`,
  title,
  description: '',
  prompt: `prompt for ${title}`,
  sourceImageIndex: 0,
  mode: 'ai' as const,
  sectionId: null,
});

describe('buildStoryboardWithSectionIds', () => {
  it('이미지 섹션(hero/point) 순서대로 sectionId를 부여한다', () => {
    const sections: DetailSection[] = [
      makeSection('s1', 'hero'),
      makeSection('s2', 'selling_points'),
      makeSection('s3', 'point'),
    ];
    const scenes = [makeRawScene('A'), makeRawScene('B')];
    const result = buildStoryboardWithSectionIds(scenes, sections);
    expect(result[0].sectionId).toBe('s1');
    expect(result[1].sectionId).toBe('s3');
  });

  it('씬이 이미지 섹션보다 많으면 초과 씬의 sectionId는 null이다', () => {
    const sections: DetailSection[] = [makeSection('s1', 'hero')];
    const scenes = [makeRawScene('A'), makeRawScene('B'), makeRawScene('C')];
    const result = buildStoryboardWithSectionIds(scenes, sections);
    expect(result[0].sectionId).toBe('s1');
    expect(result[1].sectionId).toBeNull();
    expect(result[2].sectionId).toBeNull();
  });

  it('이미지 섹션이 없으면 모든 씬의 sectionId는 null이다', () => {
    const sections: DetailSection[] = [makeSection('s1', 'selling_points')];
    const scenes = [makeRawScene('A')];
    const result = buildStoryboardWithSectionIds(scenes, sections);
    expect(result[0].sectionId).toBeNull();
  });

  it('sections가 비어있어도 동작한다', () => {
    const result = buildStoryboardWithSectionIds([makeRawScene('A')], []);
    expect(result[0].sectionId).toBeNull();
  });
});

describe('getSceneForSection', () => {
  it('sectionId가 일치하는 씬을 반환한다', () => {
    const scenes: SceneStoryboardItem[] = [
      { ...makeRawScene('A'), sectionId: 's1' },
      { ...makeRawScene('B'), sectionId: 's2' },
    ];
    const result = getSceneForSection(scenes, 's2');
    expect(result?.title).toBe('B');
  });

  it('일치하는 씬이 없으면 undefined를 반환한다', () => {
    const scenes: SceneStoryboardItem[] = [{ ...makeRawScene('A'), sectionId: 's1' }];
    expect(getSceneForSection(scenes, 'unknown')).toBeUndefined();
  });

  it('sectionId가 null인 씬은 반환하지 않는다', () => {
    const scenes: SceneStoryboardItem[] = [{ ...makeRawScene('A'), sectionId: null }];
    expect(getSceneForSection(scenes, 'anything')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/lib/storyboard-mapping.test.ts
```

Expected: `Cannot find module '@/lib/detail-page/storyboard-mapping'` 에러

- [ ] **Step 3: 헬퍼 구현**

`src/lib/detail-page/storyboard-mapping.ts`:

```ts
import type { DetailSection, SceneStoryboardItem } from '@/types/detail-page';

const IMAGE_SECTION_TYPES = new Set<string>(['hero', 'point']);

export function buildStoryboardWithSectionIds(
  scenes: SceneStoryboardItem[],
  sections: DetailSection[],
): SceneStoryboardItem[] {
  const imageSections = sections.filter(s => IMAGE_SECTION_TYPES.has(s.type));
  return scenes.map((scene, idx) => ({
    ...scene,
    sectionId: imageSections[idx]?.id ?? null,
  }));
}

export function getSceneForSection(
  storyboard: SceneStoryboardItem[],
  sectionId: string,
): SceneStoryboardItem | undefined {
  return storyboard.find(s => s.sectionId === sectionId);
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/storyboard-mapping.test.ts
```

Expected: 모든 테스트 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/detail-page/storyboard-mapping.ts src/__tests__/lib/storyboard-mapping.test.ts
git commit -m "feat(lib): add storyboard-mapping helpers with ID-based section linking"
```

---

## Task 3: DetailPlanReview 컴포넌트 작성

**Files:**
- Create: `src/components/listing/detail-maker/DetailPlanReview.tsx`
- Create: `src/__tests__/components/detail-plan-review.test.tsx`

- [ ] **Step 1: 실패하는 컴포넌트 테스트 작성**

`src/__tests__/components/detail-plan-review.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DetailPlanReview from '@/components/listing/detail-maker/DetailPlanReview';
import type { DetailSection, SceneStoryboardItem } from '@/types/detail-page';

const heroSection: DetailSection = {
  id: 'sec-hero',
  type: 'hero',
  content: { type: 'hero', headline: '최고의 필통', subheadline: '180도 오픈' },
  attachedImages: [],
};

const spSection: DetailSection = {
  id: 'sec-sp',
  type: 'selling_points',
  content: { type: 'selling_points', points: [{ icon: '✓', title: '가벼움', description: '150g' }] },
  attachedImages: [],
};

const scene: SceneStoryboardItem = {
  id: 'scene-1',
  title: '히어로 씬',
  description: '상품 전면',
  prompt: 'white desk, product centered',
  sourceImageIndex: 0,
  mode: 'ai',
  sectionId: 'sec-hero',
};

const baseProps = {
  sections: [heroSection, spSection],
  storyboard: [scene],
  uploadedUrls: ['https://example.com/img1.jpg'],
  isHtmlReady: true,
  isGeneratingScenes: false,
  onSectionsChange: vi.fn(),
  onScenesChange: vi.fn(),
  onGenerate: vi.fn(),
};

describe('DetailPlanReview', () => {
  it('위저드 헤더에 두 스텝이 표시된다', () => {
    render(<DetailPlanReview {...baseProps} />);
    expect(screen.getByText('기획 확인')).toBeInTheDocument();
    expect(screen.getByText('이미지 생성')).toBeInTheDocument();
  });

  it('hero 섹션 헤드라인이 카드에 표시된다', () => {
    render(<DetailPlanReview {...baseProps} />);
    expect(screen.getByText('최고의 필통')).toBeInTheDocument();
  });

  it('hero 섹션 이미지 프롬프트가 표시된다', () => {
    render(<DetailPlanReview {...baseProps} />);
    expect(screen.getByDisplayValue('white desk, product centered')).toBeInTheDocument();
  });

  it('selling_points 섹션은 텍스트 카드로 렌더된다', () => {
    render(<DetailPlanReview {...baseProps} />);
    expect(screen.getByText('가벼움')).toBeInTheDocument();
  });

  it('isHtmlReady=false면 로딩 인디케이터가 표시된다', () => {
    render(<DetailPlanReview {...baseProps} isHtmlReady={false} sections={[]} />);
    expect(screen.getByText(/텍스트 구조 생성 중/)).toBeInTheDocument();
  });

  it('"이미지 생성" 버튼 클릭 시 onGenerate가 호출된다', () => {
    render(<DetailPlanReview {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Gemini로 이미지 생성/ }));
    expect(baseProps.onGenerate).toHaveBeenCalledTimes(1);
  });

  it('storyboard가 빈 배열이면 이미지 기획 실패 안내가 표시된다', () => {
    render(<DetailPlanReview {...baseProps} storyboard={[]} />);
    expect(screen.getByText(/이미지 기획 생성 실패/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/components/detail-plan-review.test.tsx
```

Expected: `Cannot find module '@/components/listing/detail-maker/DetailPlanReview'`

- [ ] **Step 3: DetailPlanReview 컴포넌트 구현**

`src/components/listing/detail-maker/DetailPlanReview.tsx`:

```tsx
'use client';

import React, { useState } from 'react';
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
import { getSceneForSection } from '@/lib/detail-page/storyboard-mapping';
import type { DetailSection, SceneStoryboardItem, SectionContent } from '@/types/detail-page';

const IMAGE_SECTION_TYPES = new Set<string>(['hero', 'point']);
const BRAND_PURPLE = '#6366f1';

export interface DetailPlanReviewProps {
  sections: DetailSection[];
  storyboard: SceneStoryboardItem[];
  uploadedUrls: string[];
  isHtmlReady: boolean;
  isGeneratingScenes: boolean;
  onSectionsChange: (sections: DetailSection[]) => void;
  onScenesChange: (scenes: SceneStoryboardItem[]) => void;
  onGenerate: () => void;
}

// ── 위저드 헤더 ──────────────────────────────────────────────────────────────
function WizardHeader({ step }: { step: 1 | 2 }) {
  const steps = ['기획 확인', '이미지 생성'];
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      padding: '10px 16px',
      borderBottom: `1px solid ${C.border}`,
      background: C.bg,
      gap: '8px',
    }}>
      {steps.map((label, i) => {
        const s = i + 1;
        const isActive = s === step;
        const isDone = s < step;
        return (
          <React.Fragment key={label}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                background: isActive || isDone ? BRAND_PURPLE : '#374151',
                color: '#fff',
                fontSize: '11px',
                fontWeight: 700,
              }}>
                {isDone ? '✓' : s}
              </span>
              <span style={{
                fontSize: '13px',
                fontWeight: isActive ? 700 : 400,
                color: isActive ? C.text : C.textSub,
              }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                flex: 1,
                height: '1px',
                background: isDone ? BRAND_PURPLE : '#374151',
              }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── 섹션 타입 레이블 ──────────────────────────────────────────────────────────
function getSectionLabel(type: string): string {
  const map: Record<string, string> = {
    hero: 'HERO',
    point: 'POINT',
    selling_points: 'SELLING POINTS',
    features: 'FEATURES',
    spec_table: 'SPEC',
    usage_steps: 'HOW TO USE',
    stats: 'STATS',
    warning: 'WARNING',
    cta: 'CTA',
    brand_header: 'BRAND',
    image_grid: 'IMAGE GRID',
    point_section: 'POINTS',
    stat_callout: 'STAT CALLOUT',
    bar_chart: 'BAR CHART',
    why_icons: 'WHY',
    certifications: 'CERT',
    infographic_steps: 'STEPS',
  };
  return map[type] ?? type.toUpperCase();
}

// ── 텍스트 전용 섹션 미리보기 ─────────────────────────────────────────────────
function renderTextPreview(content: SectionContent): React.ReactNode {
  switch (content.type) {
    case 'selling_points':
      return (
        <ul style={{ margin: 0, paddingLeft: '16px', color: C.textSub, fontSize: '12px' }}>
          {content.points.map((p, i) => (
            <li key={i}>{p.title}{p.description ? ` — ${p.description}` : ''}</li>
          ))}
        </ul>
      );
    case 'features':
      return (
        <ul style={{ margin: 0, paddingLeft: '16px', color: C.textSub, fontSize: '12px' }}>
          {content.items.map((f, i) => <li key={i}>{f.title}</li>)}
        </ul>
      );
    case 'spec_table':
      return (
        <div style={{ color: C.textSub, fontSize: '12px' }}>
          {content.specs.slice(0, 3).map((s, i) => (
            <div key={i}>{s.label}: {s.value}</div>
          ))}
          {content.specs.length > 3 && <div style={{ color: '#6b7280' }}>+{content.specs.length - 3}개 더</div>}
        </div>
      );
    case 'usage_steps':
      return (
        <ol style={{ margin: 0, paddingLeft: '16px', color: C.textSub, fontSize: '12px' }}>
          {content.steps.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      );
    case 'stats':
      return (
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {content.stats.map((s, i) => (
            <span key={i} style={{ fontSize: '12px', color: C.textSub }}>
              <strong style={{ color: C.text }}>{s.value}</strong> {s.label}
            </span>
          ))}
        </div>
      );
    case 'cta':
      return <div style={{ fontSize: '12px', color: C.textSub }}>{content.text}</div>;
    case 'brand_header':
      return <div style={{ fontSize: '12px', color: C.textSub }}>{content.brandName} / {content.rightLabel}</div>;
    case 'warning':
      return (
        <ul style={{ margin: 0, paddingLeft: '16px', color: '#f59e0b', fontSize: '12px' }}>
          {content.warnings.slice(0, 2).map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      );
    default:
      return <div style={{ fontSize: '12px', color: C.textSub }}>텍스트 섹션</div>;
  }
}

// ── 이미지 섹션 카드 ─────────────────────────────────────────────────────────
interface ImageSectionCardProps {
  section: DetailSection;
  scene: SceneStoryboardItem | undefined;
  uploadedUrls: string[];
  sectionIndex: number;
  onUpdateSection: (s: DetailSection) => void;
  onUpdateScene: (s: SceneStoryboardItem) => void;
  onAddScene: () => void;
  dragHandle: React.ReactNode;
}

function ImageSectionCard({
  section,
  scene,
  uploadedUrls,
  sectionIndex,
  onUpdateSection,
  onUpdateScene,
  onAddScene,
  dragHandle,
}: ImageSectionCardProps) {
  const content = section.content;
  const headline = (content.type === 'hero' || content.type === 'point') ? content.headline : '';
  const subheadline = (content.type === 'hero' || content.type === 'point') ? content.subheadline : '';

  function updateHeadline(value: string) {
    if (content.type === 'hero') {
      onUpdateSection({ ...section, content: { ...content, headline: value } });
    } else if (content.type === 'point') {
      onUpdateSection({ ...section, content: { ...content, headline: value } });
    }
  }

  return (
    <div style={{
      background: '#2d2d44',
      borderRadius: '8px',
      marginBottom: '10px',
      border: `1px solid ${BRAND_PURPLE}44`,
      overflow: 'hidden',
    }}>
      {/* 카드 헤더 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 12px',
        background: '#252540',
        borderBottom: '1px solid #374151',
      }}>
        {dragHandle}
        <span style={{
          fontSize: '10px',
          fontWeight: 700,
          background: BRAND_PURPLE,
          color: '#fff',
          padding: '2px 8px',
          borderRadius: '4px',
        }}>
          {getSectionLabel(section.type)}
        </span>
        <span style={{ fontSize: '12px', color: C.textSub, flex: 1 }}>
          {sectionIndex + 1}번째 섹션
        </span>
      </div>

      {/* 텍스트 내용 */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #374151' }}>
        <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '4px' }}>텍스트</div>
        <input
          value={headline}
          onChange={e => updateHeadline(e.target.value)}
          placeholder="헤드라인"
          style={{
            width: '100%',
            background: '#1a1a2e',
            border: '1px solid #374151',
            borderRadius: '5px',
            padding: '5px 8px',
            color: C.text,
            fontSize: '13px',
            fontWeight: 600,
            marginBottom: '4px',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ fontSize: '12px', color: C.textSub }}>{subheadline}</div>
      </div>

      {/* 이미지 기획 */}
      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: '10px', color: '#6b7280', marginBottom: '6px' }}>🎨 이미지 기획</div>
        {scene ? (
          <>
            {scene.mode === 'ai' && (
              <textarea
                value={scene.prompt}
                onChange={e => onUpdateScene({ ...scene, prompt: e.target.value })}
                rows={3}
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
                  marginBottom: '8px',
                }}
              />
            )}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {/* 소스 이미지 선택 */}
              <div style={{ display: 'flex', gap: '4px' }}>
                {uploadedUrls.map((url, i) => (
                  <button
                    key={url}
                    onClick={() => onUpdateScene({ ...scene, sourceImageIndex: i })}
                    aria-label={`이미지 ${i + 1} 선택`}
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '4px',
                      border: scene.sourceImageIndex === i ? `2px solid ${BRAND_PURPLE}` : '2px solid transparent',
                      padding: 0,
                      cursor: 'pointer',
                      overflow: 'hidden',
                      background: '#374151',
                    }}
                  >
                    <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </button>
                ))}
              </div>
              {/* 모드 토글 */}
              <button
                onClick={() => onUpdateScene({ ...scene, mode: scene.mode === 'ai' ? 'cleanup' : 'ai' })}
                style={{
                  background: scene.mode === 'ai' ? BRAND_PURPLE : '#059669',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '3px 10px',
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                {scene.mode === 'ai' ? '⚡ AI' : '✨ 클린업'}
              </button>
            </div>
          </>
        ) : (
          <div style={{ fontSize: '12px', color: '#ef4444' }}>
            이미지 기획 생성 실패 — 직접 입력하거나 재시도하세요
            <button
              onClick={onAddScene}
              style={{
                marginLeft: '8px',
                fontSize: '11px',
                color: BRAND_PURPLE,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              + 씬 추가
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 텍스트 전용 섹션 카드 ─────────────────────────────────────────────────────
function TextSectionCard({
  section,
  sectionIndex,
  dragHandle,
}: {
  section: DetailSection;
  sectionIndex: number;
  dragHandle: React.ReactNode;
}) {
  return (
    <div style={{
      background: '#1e1e30',
      borderRadius: '8px',
      marginBottom: '10px',
      border: '1px solid #374151',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        borderBottom: '1px solid #374151',
      }}>
        {dragHandle}
        <span style={{
          fontSize: '10px',
          fontWeight: 700,
          background: '#374151',
          color: '#9ca3af',
          padding: '2px 8px',
          borderRadius: '4px',
        }}>
          {getSectionLabel(section.type)}
        </span>
        <span style={{ fontSize: '11px', color: '#6b7280' }}>{sectionIndex + 1}번째 섹션 (텍스트 전용)</span>
      </div>
      <div style={{ padding: '8px 12px' }}>
        {renderTextPreview(section.content)}
        <div style={{ marginTop: '6px', fontSize: '10px', color: '#6b7280' }}>
          상세 편집은 다음 단계(상세페이지 에디터)에서 가능합니다
        </div>
      </div>
    </div>
  );
}

// ── 드래그 가능한 섹션 카드 래퍼 ──────────────────────────────────────────────
interface SortableCardProps {
  section: DetailSection;
  scene: SceneStoryboardItem | undefined;
  storyboard: SceneStoryboardItem[];
  uploadedUrls: string[];
  sectionIndex: number;
  onUpdateSection: (s: DetailSection) => void;
  onUpdateScene: (s: SceneStoryboardItem) => void;
  onAddScene: (sectionId: string) => void;
}

function SortableCard(props: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: props.section.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const dragHandle = (
    <span
      {...attributes}
      {...listeners}
      style={{ color: '#6b7280', fontSize: '14px', cursor: 'grab', userSelect: 'none' }}
    >
      ⠿
    </span>
  );

  if (IMAGE_SECTION_TYPES.has(props.section.type)) {
    return (
      <div ref={setNodeRef} style={style}>
        <ImageSectionCard
          section={props.section}
          scene={props.scene}
          uploadedUrls={props.uploadedUrls}
          sectionIndex={props.sectionIndex}
          onUpdateSection={props.onUpdateSection}
          onUpdateScene={props.onUpdateScene}
          onAddScene={() => props.onAddScene(props.section.id)}
          dragHandle={dragHandle}
        />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style}>
      <TextSectionCard
        section={props.section}
        sectionIndex={props.sectionIndex}
        dragHandle={dragHandle}
      />
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function DetailPlanReview({
  sections,
  storyboard,
  uploadedUrls,
  isHtmlReady,
  isGeneratingScenes,
  onSectionsChange,
  onScenesChange,
  onGenerate,
}: DetailPlanReviewProps) {
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIdx = sections.findIndex(s => s.id === active.id);
    const newIdx = sections.findIndex(s => s.id === over.id);
    const reorderedSections = arrayMove(sections, oldIdx, newIdx);
    onSectionsChange(reorderedSections);

    // storyboard도 sectionId 기준으로 같은 순서로 재정렬
    const imageSections = reorderedSections.filter(s => IMAGE_SECTION_TYPES.has(s.type));
    const reorderedStoryboard = imageSections
      .map(s => storyboard.find(sc => sc.sectionId === s.id))
      .filter((sc): sc is SceneStoryboardItem => sc != null);
    const unmapped = storyboard.filter(sc => sc.sectionId === null);
    onScenesChange([...reorderedStoryboard, ...unmapped]);
  }

  function handleUpdateScene(updated: SceneStoryboardItem) {
    onScenesChange(storyboard.map(s => s.id === updated.id ? updated : s));
  }

  function handleAddScene(sectionId: string) {
    onScenesChange([
      ...storyboard,
      {
        id: crypto.randomUUID(),
        title: '새 씬',
        description: '',
        prompt: '',
        sourceImageIndex: 0,
        mode: 'ai',
        sectionId,
      },
    ]);
  }

  const canGenerate = isHtmlReady && !isGeneratingScenes;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <WizardHeader step={1} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {/* HTML 로딩 중 안내 */}
        {!isHtmlReady && (
          <div style={{
            fontSize: '12px',
            color: '#9ca3af',
            textAlign: 'center',
            padding: '12px',
            background: '#1e1e30',
            borderRadius: '8px',
            marginBottom: '12px',
          }}>
            ⏳ 텍스트 구조 생성 중… (완료 후 편집 가능)
          </div>
        )}

        {/* 섹션 카드 목록 */}
        {sections.length > 0 && (
          <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sections.map(s => s.id)} strategy={verticalListSortingStrategy}>
              {sections.map((section, idx) => (
                <SortableCard
                  key={section.id}
                  section={section}
                  scene={getSceneForSection(storyboard, section.id)}
                  storyboard={storyboard}
                  uploadedUrls={uploadedUrls}
                  sectionIndex={idx}
                  onUpdateSection={updated => {
                    onSectionsChange(sections.map(s => s.id === updated.id ? updated : s));
                  }}
                  onUpdateScene={handleUpdateScene}
                  onAddScene={handleAddScene}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* 하단 생성 버튼 */}
      <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}` }}>
        {!isHtmlReady && (
          <div style={{ fontSize: '12px', color: '#9ca3af', textAlign: 'center', marginBottom: '8px' }}>
            상세페이지 텍스트 구조 생성 중…
          </div>
        )}
        <button
          onClick={onGenerate}
          disabled={!canGenerate}
          style={{
            width: '100%',
            padding: '12px',
            background: canGenerate ? BRAND_PURPLE : '#374151',
            border: 'none',
            borderRadius: '8px',
            color: canGenerate ? '#fff' : '#6b7280',
            fontSize: '14px',
            fontWeight: 600,
            cursor: canGenerate ? 'pointer' : 'not-allowed',
          }}
        >
          {isGeneratingScenes ? '씬 이미지 생성 중…' : '② Gemini로 이미지 생성 →'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/components/detail-plan-review.test.tsx
```

Expected: 모든 테스트 PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/listing/detail-maker/DetailPlanReview.tsx src/__tests__/components/detail-plan-review.test.tsx
git commit -m "feat(ui): add DetailPlanReview blueprint view component"
```

---

## Task 4: DetailMakerClient — step 상태 머신 + 렌더 분기 교체

**Files:**
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx`

- [ ] **Step 1: detailStep 상태 및 import 추가**

`DetailMakerClient.tsx` 상단 import에 추가:

```ts
import DetailPlanReview from '@/components/listing/detail-maker/DetailPlanReview';
import { buildStoryboardWithSectionIds } from '@/lib/detail-page/storyboard-mapping';
```

상태 선언부(`useState` 블록)에 추가 (기존 `isGeneratingStoryboard` 아래):

```ts
type DetailStep = 'idle' | 'generating' | 'planning' | 'editing';
const [detailStep, setDetailStep] = useState<DetailStep>('idle');
```

그리고 기존 `sceneGenIdRef` 선언 아래에 아래 useEffect 추가 — HTML/storyboard 도착 순서 무관하게 sectionId 매핑을 적용하는 단일 진실 공급원:

```ts
// sections와 storyboard가 모두 준비되면 sectionId 매핑 수행
// (HTML이 먼저 오거나 storyboard가 먼저 오는 레이스 컨디션 대응)
useEffect(() => {
  if (sections.length === 0 || !storyboard || storyboard.length === 0) return;
  if (storyboard.every(s => s.sectionId !== null)) return; // 이미 매핑됨
  setStoryboard(prev => {
    if (!prev) return prev;
    return buildStoryboardWithSectionIds(prev, sections);
  });
}, [sections, storyboard]);
```

> `useEffect`를 사용하는 이유: HTML과 storyboard가 병렬 비동기로 도착하므로, 둘 다 준비된 시점을 감지하는 가장 안전한 방법이다. `handlePlanStoryboard` 내부에서 직접 매핑하면 어느 쪽이 먼저 도착하느냐에 따라 매핑이 누락될 수 있다.

- [ ] **Step 2: handlePlanStoryboard 수정 — step 전환 + ID 기반 매핑**

기존 `handlePlanStoryboard` 함수 전체를 아래로 교체한다.
변경 포인트:
- 함수 시작 시 `setDetailStep('generating')` 호출
- storyboard 도착 즉시 `setDetailStep('planning')` — HTML 기다리지 않음
- storyboard 씬에 `buildStoryboardWithSectionIds`로 sectionId 부여 (HTML 완료 후 sections가 채워진 시점)
- 재생성 진입 시 sections/storyboard/generatedHtml 초기화

```ts
async function handlePlanStoryboard() {
  if (!productName.trim()) { setError('상품명을 입력하세요.'); return; }
  if (uploadedUrls.length === 0) { setError('이미지를 1장 이상 업로드하세요.'); return; }

  // 재생성 시 이전 결과 초기화 (detailStep이 단일 소스이므로 파생 분기 없음)
  setSections([]);
  setStoryboard(null);
  setGeneratedHtml('');
  setDetailStep('generating');
  setStoryboardError(null);
  setError(null);
  setIsGenerating(true);
  setIsGeneratingStoryboard(true);
  sceneGenIdRef.current += 1;
  const planGenId = sceneGenIdRef.current;

  const fullProductName = [brandName.trim(), productName.trim()].filter(Boolean).join(' ');

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

  // storyboard 도착 즉시 planning 단계로 전환 (HTML 기다리지 않음)
  storyboardPromise
    .then(data => {
      if (!data.scenes) throw new Error(data.error ?? '스토리라인 생성 실패');
      // sectionId는 HTML 완료 후 sections가 채워질 때 부여 — 일단 null로 초기화
      const rawScenes = (data.scenes as Array<Record<string, unknown>>).map(s => ({
        ...s,
        id: crypto.randomUUID(),
        mode: 'ai' as const,
        sectionId: null,
      } as SceneStoryboardItem));
      setStoryboard(rawScenes);
      setDetailStep('planning'); // HTML 완료 전이라도 blueprint 뷰 표시
    })
    .catch(e => {
      // storyboard 실패 — planning 단계는 열되 빈 storyboard로 표시
      setStoryboard([]);
      setStoryboardError(e instanceof Error ? e.message : '스토리라인 생성 중 오류가 발생했습니다.');
      setDetailStep('planning');
    })
    .finally(() => {
      setIsGeneratingStoryboard(false);
    });

  // HTML 완료 시 sections 파싱 + storyboard에 sectionId 부여
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
        // sectionId 매핑은 useEffect (Step 1)가 sections+storyboard 변화를 감지해 자동 처리
      } catch (e) {
        console.warn('[detail-maker] mobileContentToSections 실패:', e);
        setError('생성 결과를 편집기로 불러오지 못했습니다. 다시 시도해주세요.');
      }
    }
  } catch (e) {
    setError(e instanceof Error ? e.message : 'HTML 생성 중 오류가 발생했습니다.');
  } finally {
    if (sceneGenIdRef.current === planGenId) setIsGenerating(false);
  }
}
```

- [ ] **Step 3: handleGenerateScenesFromStoryboard 수정 — editing 전환**

기존 함수에 `setDetailStep('editing')` 한 줄 추가:

```ts
function handleGenerateScenesFromStoryboard() {
  if (sections.length === 0) return;
  setDetailStep('editing'); // ← 추가
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

- [ ] **Step 4: 렌더 분기를 detailStep 단일 소스로 교체**

`DetailMakerClient.tsx` 렌더 부분의 우측 패널(`{/* 우측 — DetailPageEditor 또는 EmptyState */}` 아래)을 전체 교체:

```tsx
{/* 우측 — step 기반 렌더 (단일 소스) */}
<div style={{ flex: 1, minWidth: 0, overflowY: 'auto', position: 'relative', display: 'flex', flexDirection: 'column' }}>
  {generatedThumbnails.length > 0 && (
    <DetailMakerThumbnailGallery
      thumbnails={generatedThumbnails}
      editingUrl={editingThumbnailUrl}
      onDownload={handleDownloadThumbnail}
      onRemove={handleRemoveThumbnail}
      onEdit={handleEditThumbnail}
    />
  )}

  {detailStep === 'editing' ? (
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
          position: 'absolute',
          bottom: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(124,58,237,0.92)',
          color: '#fff',
          padding: '8px 18px',
          borderRadius: '24px',
          fontSize: '13px',
          fontWeight: 600,
          backdropFilter: 'blur(4px)',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          zIndex: 10,
        }}>
          ✨ AI 씬 이미지 생성 중...
        </div>
      )}
    </>
  ) : detailStep === 'planning' ? (
    <>
      {storyboardError && (
        <div style={{ padding: '12px 16px', background: '#450a0a', color: '#fca5a5', fontSize: '13px' }}>
          {storyboardError}
        </div>
      )}
      <DetailPlanReview
        sections={sections}
        storyboard={storyboard ?? []}
        uploadedUrls={uploadedUrls}
        isHtmlReady={!isGenerating && generatedHtml !== ''}
        isGeneratingScenes={isGeneratingScenes}
        onSectionsChange={handleSectionsChange}
        onScenesChange={scenes => setStoryboard(scenes)}
        onGenerate={handleGenerateScenesFromStoryboard}
      />
    </>
  ) : (
    /* idle | generating */
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      color: C.textSub,
      gap: '12px',
    }}>
      {detailStep === 'generating' ? (
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
            기획 생성 버튼을 눌러보세요
          </div>
        </>
      )}
    </div>
  )}
</div>
```

- [ ] **Step 5: 기존 isGenerating/isGeneratingStoryboard 로직 정리**

`DetailMakerInputPanel`에 전달하는 `isGenerating` prop에서 step 기반으로는 별도 처리하지 않음 — 기존 `isGenerating || isGeneratingScenes` 유지.

- [ ] **Step 6: TypeScript 에러 확인**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: 0 errors (또는 sectionId 관련 에러가 있으면 Task 5에서 처리)

- [ ] **Step 7: Commit**

```bash
git add src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "feat(detail-maker): add detailStep state machine, replace render branching with single source"
```

---

## Task 5: generateSceneImages & handleRegenerateScene — ID 기반 전환

**Files:**
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx`

- [ ] **Step 1: generateSceneImages 내 storyboard 매핑 수정**

`generateSceneImages` 함수 내 `storyboardItems?.[idx]` 부분을 ID 기반으로 교체:

```ts
// 기존 (인덱스 기반 — 깨질 수 있음)
const storyboardScene = storyboardItems?.[idx];

// 변경 (ID 기반)
const storyboardScene = storyboardItems?.find(s => s.sectionId === section.id);
```

`generateSceneImages` 함수 시그니처는 그대로 유지. `section.id`가 이제 `sectionId`와 매핑된다.

- [ ] **Step 2: handleRegenerateScene 내 섹션 조회 수정**

기존:
```ts
const targets = sections.filter(s => s.type === 'hero' || s.type === 'point');
const sceneIdx = storyboard.findIndex(s => s.id === sceneId);
const section = targets[sceneIdx];
```

변경:
```ts
const scene = storyboard.find(s => s.id === sceneId);
const section = scene?.sectionId
  ? sections.find(s => s.id === scene.sectionId)
  : undefined;
```

`section`이 `undefined`인 경우 early return 추가:

```ts
if (!scene || !section || uploadedUrls.length === 0) return;
```

- [ ] **Step 3: TypeScript 에러 없는지 확인**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors

- [ ] **Step 4: 기존 storyboard-mapping 테스트 재실행**

```bash
npx vitest run src/__tests__/lib/storyboard-mapping.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "fix(detail-maker): switch storyboard-section mapping from index to ID-based"
```

---

## Task 6: 입력 패널 버튼 레이블 변경 + StoryboardEditor 제거

**Files:**
- Modify: `src/components/listing/detail-maker/DetailMakerInputPanel.tsx`
- Delete: `src/components/listing/detail-maker/StoryboardEditor.tsx`

- [ ] **Step 1: 버튼 레이블 변경**

`src/components/listing/detail-maker/DetailMakerInputPanel.tsx`의 버튼 텍스트(line 427 근처):

```tsx
// 기존
{isGenerating ? '✨ 생성 중...' : '✨ AI 상세페이지 생성'}

// 변경
{isGenerating ? '✨ 기획 생성 중...' : '① 기획 생성'}
```

- [ ] **Step 2: StoryboardEditor import 제거 확인**

`DetailMakerClient.tsx`에서 StoryboardEditor import가 있다면 제거:

```bash
grep -n "StoryboardEditor" /Users/seungminlee/Desktop/projects/smart_seller_studio/src/app/listing/detail-maker/DetailMakerClient.tsx
```

import가 있으면 해당 줄 삭제.

- [ ] **Step 3: StoryboardEditor 파일 삭제**

```bash
rm /Users/seungminlee/Desktop/projects/smart_seller_studio/src/components/listing/detail-maker/StoryboardEditor.tsx
```

- [ ] **Step 4: 전체 테스트 실행**

```bash
npx vitest run src/__tests__/components/detail-maker-input-panel.test.tsx src/__tests__/components/detail-plan-review.test.tsx src/__tests__/lib/storyboard-mapping.test.ts
```

Expected: 모든 테스트 PASS

- [ ] **Step 5: TypeScript 최종 확인**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/components/listing/detail-maker/DetailMakerInputPanel.tsx
git rm src/components/listing/detail-maker/StoryboardEditor.tsx
git commit -m "feat(detail-maker): update button label, remove StoryboardEditor (absorbed into DetailPlanReview)"
```

---

## Task 7: 수동 통합 테스트

- [ ] **Step 1: 개발 서버 시작**

```bash
npm run dev
```

브라우저에서 `/listing/detail-maker` 접속.

- [ ] **Step 2: Happy Path 테스트**

1. 상품명 입력 + 이미지 업로드
2. "① 기획 생성" 클릭 → `generating` 스피너 표시 확인
3. storyboard 도착 → Blueprint 뷰 표시 확인 (위저드 헤더 "① 기획 확인" 강조)
4. 이미지 섹션 카드에 헤드라인 + 이미지 프롬프트 함께 표시 확인
5. 텍스트 전용 섹션 카드에 판매 포인트 등 텍스트 표시 확인
6. 헤드라인 인라인 편집 → blur 후 값 유지 확인
7. "② Gemini로 이미지 생성 →" 클릭 → `editing` 단계 전환 확인
8. 최종 DetailPageEditor 표시 + AI 씬 이미지 생성 배너 확인

- [ ] **Step 3: 엣지 케이스 테스트**

- 이미지 섹션 수(예: 3개)와 storyboard 씬 수(4개) 불일치 → 매핑 없는 씬은 Blueprint에서 "연결 없음" 처리 확인
- storyboard API 실패 시뮬레이션(네트워크 탭에서 block) → 빈 storyboard + 에러 메시지 표시 확인
- "① 기획 생성" 재클릭(editing 상태에서) → 초기화 후 generating으로 복귀 확인

- [ ] **Step 4: 최종 Commit**

```bash
git add -p  # 수동 테스트 중 발생한 수정 사항
git commit -m "chore: fix issues found during integration testing"
```
