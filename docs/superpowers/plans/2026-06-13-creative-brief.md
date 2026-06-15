# 크리에이티브 브리프 (Creative Brief) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** detail-maker에 "무드 프리셋 + AI 추천" 브리프 단계를 추가해, 선택한 브리프가 AI 씬 이미지 톤과 페이지 테마를 통일되게 만들고(①), 생성 후 섹션별로 씬을 재생성해 보정한다(③).

**Architecture:** 정적 무드 카탈로그(`mood-presets.ts`)를 만들고, AI 추천 API(`suggest-mood`)는 카탈로그 id만 골라 반환한다. 선택한 무드의 `sceneHint`를 기존 `generate-scene-image` 파이프라인에 한 필드로 주입하고, `palette`로 페이지 테마를 통일한다. ③은 `DetailPageEditor`→`SectionCard`에 섹션별 재생성 콜백을 추가해 그 섹션 씬 1장만 브리프 톤으로 다시 만든다.

**Tech Stack:** Next.js App Router, TypeScript, Zod, Anthropic Claude (Vision, `getAnthropicClient`), `loadReferenceImages`, Vitest + React Testing Library, Zustand 미사용(detail-maker는 로컬 `useState`)

**설계 문서:** `docs/superpowers/specs/2026-06-13-creative-brief-design.md`

---

## 파일 구조

| 파일 | 신규/수정 | 역할 |
|------|-----------|------|
| `src/types/detail-page.ts` | 수정 | `MoodPreset`, `CreativeBrief` 타입 추가 |
| `src/lib/detail-page/mood-presets.ts` | 신규 | `MOOD_PRESETS` 카탈로그(8종) + `getMoodPreset` + `parseSuggestedMoodIds` |
| `src/app/api/ai/generate-scene-image/prompt.ts` | 신규 | `buildSceneUserPrompt` 추출(순수 함수) — `sceneHint` 주입 |
| `src/app/api/ai/generate-scene-image/route.ts` | 수정 | 스키마에 `sceneHint?` 추가, `prompt.ts` 사용 |
| `src/app/api/ai/suggest-mood/route.ts` | 신규 | 상품 이미지 → Vision → 카탈로그 `moodId` 2~3개 반환 |
| `src/components/listing/detail-maker/CreativeBriefPanel.tsx` | 신규 | ① UI — AI 추천 + 프리셋 갤러리 |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | 수정 | 브리프 state·suggest 호출·sceneHint 전달·팔레트 통일·③ 재생성 핸들러 |
| `src/components/listing/detail-maker/DetailMakerInputPanel.tsx` | 수정 | `CreativeBriefPanel` 끼워넣기 |
| `src/components/listing/detail-editor/SectionCard.tsx` | 수정 | hero/point 섹션에 "🎨 재생성" 버튼 + `onSceneRegenerate` prop |
| `src/components/listing/detail-editor/DetailPageEditor.tsx` | 수정 | `onSceneRegenerate` prop 추가·`SectionCard`에 전달 |

**테스트:**
- `src/__tests__/lib/detail-page/mood-presets.test.ts` (신규)
- `src/__tests__/api/ai/generate-scene-image-prompt.test.ts` (신규)
- `src/__tests__/components/creative-brief-panel.test.tsx` (신규)

> **범위 메모 (이 플랜에서 의도적으로 제외):** 설계 §4의 ③ 보조 기능 중 "섹션별 무드 임시 변경 드롭다운"과 "섹션별 레퍼런스 1장 첨부"는 새 팝오버 UI가 필요해 별도 후속 작업으로 분리한다. 본 플랜의 ③(Task 8·9)은 핵심 동작인 **"브리프 톤으로 이 섹션 씬 재생성"**까지 구현한다. 서버(`generate-scene-image`)는 이미 `referenceImages`를 받으므로 후속 추가 시 클라이언트 UI만 확장하면 된다.

---

# Phase A — ① 크리에이티브 브리프

## Task 1: 타입 추가 (`MoodPreset`, `CreativeBrief`)

**Files:**
- Modify: `src/types/detail-page.ts` (파일 끝에 추가)

- [ ] **Step 1: 타입 추가**

`src/types/detail-page.ts` 파일 맨 끝에 아래를 추가한다. (`PaletteName`은 같은 파일 상단에 이미 정의돼 있음)

```ts
/** 무드 프리셋 — 정적 카탈로그 항목. AI 추천과 갤러리가 모두 이 id를 가리킨다. */
export interface MoodPreset {
  id: string;            // 'nordic_minimal' 등
  label: string;         // '북유럽 미니멀'
  emoji: string;         // 🌿 (썸네일 대용)
  keywords: string[];    // ['밝은 우드','린넨','자연광']
  palette: PaletteName;  // 선택 시 페이지 테마로 세팅
  sceneHint: string;     // 영문 — 씬 프롬프트 art direction
}

/** 크리에이티브 브리프 — 무드 선택 결과. 비어 있으면 기존 동작과 동일. */
export interface CreativeBrief {
  moodId: string | null;
  sceneHint: string;
  paletteOverride?: PaletteName;
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (신규 타입은 아직 미사용이라 통과)

- [ ] **Step 3: 커밋**

```bash
git add src/types/detail-page.ts
git commit -m "feat: MoodPreset/CreativeBrief 타입 추가"
```

---

## Task 2: 무드 카탈로그 + 헬퍼 (`mood-presets.ts`)

**Files:**
- Create: `src/lib/detail-page/mood-presets.ts`
- Test: `src/__tests__/lib/detail-page/mood-presets.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/__tests__/lib/detail-page/mood-presets.test.ts
import { describe, it, expect } from 'vitest';
import { MOOD_PRESETS, getMoodPreset, parseSuggestedMoodIds } from '@/lib/detail-page/mood-presets';
import { PALETTES } from '@/lib/detail-page/palette-config';

describe('MOOD_PRESETS 카탈로그', () => {
  it('8개의 프리셋을 가진다', () => {
    expect(MOOD_PRESETS).toHaveLength(8);
  });

  it('모든 프리셋 id가 유일하다', () => {
    const ids = MOOD_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('모든 프리셋의 palette가 실제 PALETTES에 존재한다', () => {
    for (const preset of MOOD_PRESETS) {
      expect(PALETTES[preset.palette]).toBeDefined();
    }
  });

  it('모든 프리셋이 비어있지 않은 sceneHint를 가진다', () => {
    for (const preset of MOOD_PRESETS) {
      expect(preset.sceneHint.length).toBeGreaterThan(10);
    }
  });
});

describe('getMoodPreset', () => {
  it('존재하는 id로 프리셋을 찾는다', () => {
    expect(getMoodPreset('nordic_minimal')?.label).toBe('북유럽 미니멀');
  });
  it('없는 id면 null', () => {
    expect(getMoodPreset('does_not_exist')).toBeNull();
  });
});

describe('parseSuggestedMoodIds', () => {
  const valid = MOOD_PRESETS.map((p) => p.id);

  it('JSON에서 카탈로그에 존재하는 id만 추린다', () => {
    const raw = '{"moodIds": ["luxury_dark", "hallucinated_id", "nordic_minimal"]}';
    expect(parseSuggestedMoodIds(raw, valid)).toEqual(['luxury_dark', 'nordic_minimal']);
  });

  it('최대 3개로 자른다', () => {
    const raw = JSON.stringify({ moodIds: valid });
    expect(parseSuggestedMoodIds(raw, valid).length).toBeLessThanOrEqual(3);
  });

  it('중복을 제거한다', () => {
    const raw = '{"moodIds": ["luxury_dark", "luxury_dark"]}';
    expect(parseSuggestedMoodIds(raw, valid)).toEqual(['luxury_dark']);
  });

  it('JSON이 없으면 빈 배열', () => {
    expect(parseSuggestedMoodIds('not json at all', valid)).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/mood-presets.test.ts`
Expected: FAIL — `Cannot find module '@/lib/detail-page/mood-presets'`

- [ ] **Step 3: 구현 작성**

```ts
// src/lib/detail-page/mood-presets.ts
import type { MoodPreset } from '@/types/detail-page';

/** 무드 프리셋 카탈로그. AI 추천(suggest-mood)과 갤러리(CreativeBriefPanel)가 공유한다. */
export const MOOD_PRESETS: MoodPreset[] = [
  {
    id: 'nordic_minimal',
    label: '북유럽 미니멀',
    emoji: '🌿',
    keywords: ['밝은 우드', '린넨', '자연광'],
    palette: 'cream_cozy',
    sceneHint:
      'bright Scandinavian minimalist setting, light oak wood surfaces, linen textiles, abundant soft natural daylight, generous negative space, muted warm neutrals',
  },
  {
    id: 'luxury_dark',
    label: '럭셔리 다크',
    emoji: '🥃',
    keywords: ['대리석', '골드', '무드조명'],
    palette: 'deep_dark',
    sceneHint:
      'moody low-key lighting, polished marble and brushed gold surfaces, dark elegant background, dramatic directional shadows, premium editorial feel',
  },
  {
    id: 'vivid_pop',
    label: '비비드 팝',
    emoji: '🍭',
    keywords: ['선명한 색', '그래픽', '활기'],
    palette: 'sunset_warm',
    sceneHint:
      'bright saturated color background, bold graphic color blocking, energetic playful mood, crisp even lighting, contemporary pop aesthetic',
  },
  {
    id: 'clean_tech',
    label: '클린 테크',
    emoji: '💻',
    keywords: ['클린 데스크', '블루톤', '미니멀'],
    palette: 'tech_navy',
    sceneHint:
      'clean modern desk setup, cool blue and slate tones, minimal tech environment, crisp soft lighting, organized uncluttered composition',
  },
  {
    id: 'natural_home',
    label: '내추럴 홈',
    emoji: '🪴',
    keywords: ['식물', '오가닉', '오후 햇살'],
    palette: 'nature_green',
    sceneHint:
      'cozy natural home interior, potted green plants, organic materials, warm afternoon daylight through a window, lived-in authentic feel',
  },
  {
    id: 'soft_romance',
    label: '소프트 로맨스',
    emoji: '🌸',
    keywords: ['파스텔 핑크', '부드러움', '드리미'],
    palette: 'rose_soft',
    sceneHint:
      'soft pastel pink palette, dreamy diffused lighting, delicate feminine styling, gentle gradients, airy romantic mood',
  },
  {
    id: 'fresh_clean',
    label: '프레시 클린',
    emoji: '💧',
    keywords: ['화이트', '청량', '에어리'],
    palette: 'fresh_mint',
    sceneHint:
      'bright airy white setting, fresh clean aesthetic, dewy freshness cues, high-key even lighting, crisp and hygienic feel',
  },
  {
    id: 'warm_cozy',
    label: '웜 코지',
    emoji: '☕',
    keywords: ['베이지', '아늑함', '골든아워'],
    palette: 'warm_cream',
    sceneHint:
      'warm beige and cream tones, cozy homely atmosphere, soft golden-hour lighting, comfortable textured fabrics, inviting relaxed mood',
  },
];

/** id로 프리셋 조회. 없으면 null. */
export function getMoodPreset(id: string | null | undefined): MoodPreset | null {
  if (!id) return null;
  return MOOD_PRESETS.find((p) => p.id === id) ?? null;
}

/**
 * Claude 응답 raw 텍스트에서 moodIds를 파싱하되, validIds에 존재하는 것만(환각 방어)
 * 중복 제거 후 최대 3개 반환한다.
 */
export function parseSuggestedMoodIds(rawText: string, validIds: string[]): string[] {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  const ids = (parsed as { moodIds?: unknown }).moodIds;
  if (!Array.isArray(ids)) return [];
  const validSet = new Set(validIds);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (typeof id === 'string' && validSet.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
      if (result.length >= 3) break;
    }
  }
  return result;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/detail-page/mood-presets.test.ts`
Expected: PASS (모든 테스트)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/detail-page/mood-presets.ts src/__tests__/lib/detail-page/mood-presets.test.ts
git commit -m "feat: 무드 프리셋 카탈로그 + parseSuggestedMoodIds 헬퍼"
```

---

## Task 3: 씬 프롬프트 빌더 추출 + `sceneHint` 주입

**Files:**
- Create: `src/app/api/ai/generate-scene-image/prompt.ts`
- Modify: `src/app/api/ai/generate-scene-image/route.ts`
- Test: `src/__tests__/api/ai/generate-scene-image-prompt.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/__tests__/api/ai/generate-scene-image-prompt.test.ts
import { describe, it, expect } from 'vitest';
import { buildSceneUserPrompt } from '@/app/api/ai/generate-scene-image/prompt';

describe('buildSceneUserPrompt', () => {
  it('sceneHint가 있으면 Art direction 라인을 포함한다', () => {
    const out = buildSceneUserPrompt('hero', { headline: '향수' }, 'moody marble and gold');
    expect(out).toContain('Art direction');
    expect(out).toContain('moody marble and gold');
    expect(out).toContain('Section type: hero');
  });

  it('sceneHint가 없으면 Art direction 라인이 없다 (기존 동작 유지)', () => {
    const out = buildSceneUserPrompt('lifestyle', { headline: '향수' }, undefined);
    expect(out).not.toContain('Art direction');
    expect(out).toContain('Section type: lifestyle');
  });

  it('productInfo가 없어도 동작한다', () => {
    const out = buildSceneUserPrompt('detail', undefined, undefined);
    expect(out).toContain('Section type: detail');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/api/ai/generate-scene-image-prompt.test.ts`
Expected: FAIL — `Cannot find module '.../prompt'`

- [ ] **Step 3: `prompt.ts` 작성 (기존 route.ts의 buildUserPrompt 이전 + sceneHint 추가)**

```ts
// src/app/api/ai/generate-scene-image/prompt.ts
export interface SceneProductInfo {
  headline?: string;
  subheadline?: string;
  sellingPoints?: Array<{ title: string; description: string }>;
  features?: Array<{ title: string }>;
}

/**
 * Claude에 줄 유저 프롬프트를 만든다.
 * sceneHint(브리프 art direction)가 있으면 한 줄로 합류시킨다.
 * 제품 픽셀 보존 등 핵심 규칙은 SYSTEM 프롬프트(route.ts)에 그대로 있다.
 */
export function buildSceneUserPrompt(
  sectionType: string,
  productInfo: SceneProductInfo | undefined,
  sceneHint: string | undefined,
): string {
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

  if (sceneHint && sceneHint.trim()) {
    lines.push('');
    lines.push(`Art direction (apply this mood/style to the scene): ${sceneHint.trim()}`);
  }

  lines.push('');
  lines.push(`Section type: ${sectionType}`);
  lines.push('Generate a detailed Gemini image generation prompt for this section. Return only JSON.');

  return lines.join('\n');
}
```

- [ ] **Step 4: route.ts에서 기존 buildUserPrompt 제거하고 prompt.ts 사용**

`src/app/api/ai/generate-scene-image/route.ts`에서:

(a) import 추가 (파일 상단 import 블록 끝, 7번 줄 아래):

```ts
import { buildSceneUserPrompt } from './prompt';
```

(b) `RequestBodySchema`(13~31번 줄)의 `productInfo` 바로 다음 줄에 `sceneHint` 추가. 즉 `productInfo: z.object({...}).optional(),` 다음에:

```ts
  sceneHint: z.string().max(600).optional(),
```

(c) 기존 `buildUserPrompt` 함수 정의(54~81번 줄) **전체 삭제**.

(d) 구조분해(105번 줄)를 `sceneHint`까지 포함하도록 수정:

```ts
  const { sectionType, productInfo, sceneHint } = parsed.data;
```

(e) userContent에 텍스트를 넣는 호출(133번 줄)을 교체:

```ts
    userContent.push({ type: 'text', text: buildSceneUserPrompt(sectionType, productInfo, sceneHint) });
```

- [ ] **Step 5: 통과 + 회귀 확인**

Run: `npx vitest run src/__tests__/api/ai/generate-scene-image-prompt.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/ai/generate-scene-image/prompt.ts src/app/api/ai/generate-scene-image/route.ts src/__tests__/api/ai/generate-scene-image-prompt.test.ts
git commit -m "feat: generate-scene-image에 sceneHint(art direction) 주입"
```

---

## Task 4: AI 무드 추천 API (`suggest-mood`)

**Files:**
- Create: `src/app/api/ai/suggest-mood/route.ts`

> 이 라우트는 서버 의존성(auth/claude/loadReferenceImages)을 import하므로 단위 테스트 대신, 핵심 로직인 `parseSuggestedMoodIds`(Task 2에서 이미 테스트됨)에 의존한다. 라우트 자체는 수동 검증한다.

- [ ] **Step 1: 라우트 작성**

`generate-scene-image/route.ts`의 인증·레이트리밋·Vision 패턴을 그대로 따른다.

```ts
// src/app/api/ai/suggest-mood/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { getAnthropicClient } from '@/lib/ai/claude';
import { loadReferenceImages } from '@/lib/ai/reference-images';
import { MOOD_PRESETS, parseSuggestedMoodIds } from '@/lib/detail-page/mood-presets';

export const maxDuration = 30;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 15 };

const RequestBodySchema = z.object({
  productImageUrls: z.array(z.string().url()).min(1).max(3),
  productName: z.string().max(300).optional(),
});

function buildSystemPrompt(): string {
  const catalog = MOOD_PRESETS.map(
    (p) => `- ${p.id}: ${p.label} (${p.keywords.join(', ')})`,
  ).join('\n');

  return `You are an e-commerce art director. Given product image(s) and an optional product name, pick the 2-3 mood presets from the catalog below that best fit the product's visual character and target customer.

Mood preset catalog (choose by id only):
${catalog}

Rules:
- Return ONLY ids that exist in the catalog above. Never invent new ids.
- Return 2 or 3 ids, ordered best-fit first.
- Return ONLY valid JSON: {"moodIds": ["id1", "id2"]}`;
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult as NextResponse;

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'suggest-mood'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429, headers: { 'X-RateLimit-Reset': rl.resetAt.toString() } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? '잘못된 요청' },
      { status: 400 },
    );
  }

  try {
    const referenceImages = await loadReferenceImages({
      productImageUrls: parsed.data.productImageUrls,
    });

    const client = getAnthropicClient();

    type ContentBlock =
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
      | { type: 'text'; text: string };

    const userContent: ContentBlock[] = [];
    for (const ref of referenceImages) {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: ref.mimeType, data: ref.base64 },
      });
    }
    userContent.push({
      type: 'text',
      text: parsed.data.productName
        ? `Product name: ${parsed.data.productName}\nPick 2-3 best-fit mood ids. Return only JSON.`
        : 'Pick 2-3 best-fit mood ids. Return only JSON.',
    });

    const claudeRes = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      system: buildSystemPrompt(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: userContent as any }],
    });

    const rawText = claudeRes.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    const moodIds = parseSuggestedMoodIds(rawText, MOOD_PRESETS.map((p) => p.id));

    // 추천이 비면 카탈로그 앞 2개로 폴백 (UI가 항상 뭔가 보여주도록)
    const finalIds = moodIds.length > 0 ? moodIds : MOOD_PRESETS.slice(0, 2).map((p) => p.id);

    return NextResponse.json({ success: true, data: { moodIds: finalIds } });
  } catch (error) {
    console.error('[/api/ai/suggest-mood] 오류:', error);
    if (error instanceof Error && error.message.includes('ANTHROPIC_API_KEY')) {
      return NextResponse.json({ success: false, error: 'Claude API 키가 설정되지 않았습니다.' }, { status: 503 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '무드 추천에 실패했습니다.' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/ai/suggest-mood/route.ts
git commit -m "feat: suggest-mood API — 상품 이미지로 무드 프리셋 2~3개 추천"
```

---

## Task 5: 브리프 패널 컴포넌트 (`CreativeBriefPanel`)

**Files:**
- Create: `src/components/listing/detail-maker/CreativeBriefPanel.tsx`
- Test: `src/__tests__/components/creative-brief-panel.test.tsx`

- [ ] **Step 1: 실패 테스트 작성**

```tsx
// src/__tests__/components/creative-brief-panel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CreativeBriefPanel from '@/components/listing/detail-maker/CreativeBriefPanel';

describe('CreativeBriefPanel', () => {
  it('추천 무드 라벨을 보여준다', () => {
    render(
      <CreativeBriefPanel
        suggestedMoodIds={['luxury_dark']}
        selectedMoodId={null}
        isSuggesting={false}
        onSelectMood={vi.fn()}
      />,
    );
    expect(screen.getByText('럭셔리 다크')).toBeInTheDocument();
  });

  it('무드 클릭 시 onSelectMood(id) 호출', () => {
    const onSelect = vi.fn();
    render(
      <CreativeBriefPanel
        suggestedMoodIds={['luxury_dark']}
        selectedMoodId={null}
        isSuggesting={false}
        onSelectMood={onSelect}
      />,
    );
    fireEvent.click(screen.getByText('럭셔리 다크'));
    expect(onSelect).toHaveBeenCalledWith('luxury_dark');
  });

  it('"프리셋 더보기" 클릭 시 전체 카탈로그(8개)를 펼친다', () => {
    render(
      <CreativeBriefPanel
        suggestedMoodIds={['luxury_dark']}
        selectedMoodId={null}
        isSuggesting={false}
        onSelectMood={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText(/프리셋 더보기/));
    // 카탈로그의 다른 무드가 노출됨
    expect(screen.getByText('북유럽 미니멀')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/components/creative-brief-panel.test.tsx`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 컴포넌트 작성**

```tsx
// src/components/listing/detail-maker/CreativeBriefPanel.tsx
'use client';

import React, { useState } from 'react';
import { C } from '@/lib/design-tokens';
import { MOOD_PRESETS, getMoodPreset } from '@/lib/detail-page/mood-presets';
import { PALETTES } from '@/lib/detail-page/palette-config';
import type { MoodPreset } from '@/types/detail-page';

const BRAND_PURPLE = '#7c3aed';

interface Props {
  /** AI 추천 무드 id 목록 (suggest-mood 결과) */
  suggestedMoodIds: string[];
  /** 현재 선택된 무드 id */
  selectedMoodId: string | null;
  /** 추천 로딩 중 여부 */
  isSuggesting: boolean;
  /** 무드 선택 콜백 */
  onSelectMood: (id: string) => void;
}

function MoodTile({
  preset,
  selected,
  onClick,
}: {
  preset: MoodPreset;
  selected: boolean;
  onClick: () => void;
}) {
  const pal = PALETTES[preset.palette];
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '8px 10px',
        borderRadius: 8,
        border: selected ? `1.5px solid ${BRAND_PURPLE}` : `1px solid ${C.border}`,
        background: selected ? '#f5f3ff' : '#fff',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ fontSize: 18 }}>{preset.emoji}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.text }}>
          {preset.label}
        </span>
        <span style={{ display: 'block', fontSize: 10, color: C.textSub, marginTop: 1 }}>
          {preset.keywords.join(' · ')}
        </span>
      </span>
      {/* 팔레트 칩 */}
      <span style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
        {[pal.bg, pal.accent, pal.text].map((c, i) => (
          <span
            key={i}
            style={{ width: 10, height: 10, borderRadius: 2, background: c, border: '1px solid #00000010' }}
          />
        ))}
      </span>
    </button>
  );
}

export default function CreativeBriefPanel({
  suggestedMoodIds,
  selectedMoodId,
  isSuggesting,
  onSelectMood,
}: Props) {
  const [showAll, setShowAll] = useState(false);

  const suggested = suggestedMoodIds
    .map((id) => getMoodPreset(id))
    .filter((p): p is MoodPreset => p !== null);

  // 더보기에서는 추천에 없는 나머지만 노출 (중복 방지)
  const rest = MOOD_PRESETS.filter((p) => !suggestedMoodIds.includes(p.id));

  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: C.text, display: 'block', marginBottom: 6 }}>
        🎨 무드 브리프{' '}
        <span style={{ fontSize: 11, color: C.textSub, fontWeight: 400 }}>
          (씬 이미지 + 페이지 톤 통일)
        </span>
      </label>

      {isSuggesting && (
        <div style={{ fontSize: 12, color: C.textSub, marginBottom: 8 }}>AI가 어울리는 무드를 찾는 중...</div>
      )}

      {!isSuggesting && suggested.length === 0 && (
        <div style={{ fontSize: 12, color: C.textSub, marginBottom: 8 }}>
          이미지를 올리면 어울리는 무드를 추천해드려요.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {suggested.map((p) => (
          <MoodTile
            key={p.id}
            preset={p}
            selected={selectedMoodId === p.id}
            onClick={() => onSelectMood(p.id)}
          />
        ))}
      </div>

      <button
        onClick={() => setShowAll((v) => !v)}
        style={{
          marginTop: 8,
          fontSize: 12,
          color: BRAND_PURPLE,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        {showAll ? '접기 ▲' : '프리셋 더보기 ▼'}
      </button>

      {showAll && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {rest.map((p) => (
            <MoodTile
              key={p.id}
              preset={p}
              selected={selectedMoodId === p.id}
              onClick={() => onSelectMood(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/components/creative-brief-panel.test.tsx`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/components/listing/detail-maker/CreativeBriefPanel.tsx src/__tests__/components/creative-brief-panel.test.tsx
git commit -m "feat: CreativeBriefPanel — AI 추천 + 프리셋 갤러리 UI"
```

---

## Task 6: DetailMakerClient 배선 (state·추천·sceneHint·팔레트 통일)

**Files:**
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx`

- [ ] **Step 1: import 추가**

상단 import 블록에 추가:

```ts
import { getMoodPreset } from '@/lib/detail-page/mood-presets';
import type { CreativeBrief } from '@/types/detail-page';
```

- [ ] **Step 2: state 추가**

`const sceneGenIdRef = useRef(0);`(34번 줄 근처) 바로 아래에 추가:

```ts
  // 크리에이티브 브리프
  const [creativeBrief, setCreativeBrief] = useState<CreativeBrief | null>(null);
  const [suggestedMoodIds, setSuggestedMoodIds] = useState<string[]>([]);
  const [isSuggestingMood, setIsSuggestingMood] = useState(false);
```

- [ ] **Step 3: 무드 추천 요청 함수 추가 + 업로드 성공 후 호출**

`handleUploadFiles` 함수의 `setUploadedUrls(...)` 직후, 새 전체 URL로 추천을 요청한다. 함수를 아래로 교체:

```ts
  async function handleUploadFiles(files: FileList | File[]) {
    setUploading(true);
    setError(null);
    try {
      const arr = Array.from(files).slice(0, 6 - uploadedUrls.length);
      const urls = await Promise.all(arr.map(uploadOne));
      const nextUrls = [...uploadedUrls, ...urls].slice(0, 6);
      setUploadedUrls(nextUrls);
      void suggestMood(nextUrls);
    } catch (e) {
      setError(e instanceof Error ? e.message : '이미지 업로드 실패');
    } finally {
      setUploading(false);
    }
  }

  // 무드 추천 (논블로킹) — 실패해도 조용히 무시
  async function suggestMood(urls: string[]) {
    if (urls.length === 0) return;
    setIsSuggestingMood(true);
    try {
      const res = await fetch('/api/ai/suggest-mood', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productImageUrls: urls.slice(0, 3), productName: productName.trim() || undefined }),
      });
      const json = await res.json() as { success: boolean; data?: { moodIds: string[] } };
      if (json.success && json.data) setSuggestedMoodIds(json.data.moodIds);
    } catch {
      // 무시
    } finally {
      setIsSuggestingMood(false);
    }
  }

  // 무드 선택 — 브리프 확정 + 페이지 팔레트 통일
  function handleSelectMood(id: string) {
    const preset = getMoodPreset(id);
    if (!preset) return;
    setCreativeBrief({ moodId: preset.id, sceneHint: preset.sceneHint });
    setTheme(prev => ({ ...prev, palette: preset.palette }));
  }
```

> 참고: `handleUploadFiles`가 `suggestMood`보다 위에 정의되지만, 함수 선언(hoisting)이라 호출 순서는 문제없다.

- [ ] **Step 4: `generateSceneImages`에 sceneHint 전달**

`generateSceneImages` 시그니처에 `sceneHint` 파라미터를 추가하고, fetch body에 포함한다.

시그니처(93~98번 줄) 교체:

```ts
  async function generateSceneImages(
    sectionsSnapshot: DetailSection[],
    refUrls: string[],
    genId: number,
    currentTheme: DetailPageTheme,
    sceneHint?: string,
  ) {
```

fetch body(112~117번 줄 부근)에 `sceneHint` 추가:

```ts
            body: JSON.stringify({
              sectionType,
              productImageUrls: refUrls.slice(0, 3),
              productInfo: headline ? { headline } : undefined,
              sceneHint,
            }),
```

- [ ] **Step 5: `handleGenerate`의 호출부에 brief sceneHint 주입**

`handleGenerate` 안의 `void generateSceneImages(parsed, uploadedUrls, currentGenId, theme)` 호출(223번 줄 부근)을 교체:

```ts
        void generateSceneImages(parsed, uploadedUrls, currentGenId, theme, creativeBrief?.sceneHint).finally(() => {
```

- [ ] **Step 6: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "feat: DetailMakerClient에 무드 브리프 배선 (추천·sceneHint·팔레트 통일)"
```

---

## Task 7: InputPanel에 브리프 패널 끼우기

**Files:**
- Modify: `src/components/listing/detail-maker/DetailMakerInputPanel.tsx`
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx` (props 전달)

- [ ] **Step 1: InputPanel import + props 추가**

`DetailMakerInputPanel.tsx` 상단에 import 추가:

```ts
import CreativeBriefPanel from './CreativeBriefPanel';
```

`Props` 인터페이스(17~31번 줄)에 추가:

```ts
  suggestedMoodIds: string[];
  selectedMoodId: string | null;
  isSuggestingMood: boolean;
  onSelectMood: (id: string) => void;
```

함수 구조분해(33~47번 줄)에도 동일하게 추가:

```ts
  suggestedMoodIds,
  selectedMoodId,
  isSuggestingMood,
  onSelectMood,
```

- [ ] **Step 2: 참고 이미지 섹션 아래에 패널 렌더**

`DetailMakerInputPanel.tsx`에서 "참고 이미지" 블록을 닫는 `</div>` 다음(업로드 썸네일 영역이 끝나는 지점)에 브리프 패널을 추가한다. 위치는 `<div style={{ padding: '16px', ... }}>` 컨테이너 안, 참고 이미지 블록 바로 뒤:

```tsx
        {/* 무드 브리프 */}
        <CreativeBriefPanel
          suggestedMoodIds={suggestedMoodIds}
          selectedMoodId={selectedMoodId}
          isSuggesting={isSuggestingMood}
          onSelectMood={onSelectMood}
        />
```

> 정확한 삽입 지점: 참고 이미지 `<div>` 블록의 닫는 태그 직후, 생성 버튼(있다면) 앞. 참고 이미지 블록은 `{/* 참고 이미지 */}` 주석으로 시작하는 `<div>`이다.

- [ ] **Step 3: Client에서 props 전달**

`DetailMakerClient.tsx`의 `<DetailMakerInputPanel ... />`(291번 줄 부근)에 props 추가:

```tsx
        suggestedMoodIds={suggestedMoodIds}
        selectedMoodId={creativeBrief?.moodId ?? null}
        isSuggestingMood={isSuggestingMood}
        onSelectMood={handleSelectMood}
```

- [ ] **Step 4: 타입 체크 + 빌드 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 5: 개발 서버에서 수동 확인**

Run: `npm run dev` 후 `/listing/detail-maker` 접속 → 상품명 입력 + 이미지 업로드 → 잠시 후 무드 추천 2~3개 표시 → 무드 클릭 시 보라 테두리 선택 + (생성 후) 페이지 팔레트가 바뀌는지 확인.

- [ ] **Step 6: 커밋**

```bash
git add src/components/listing/detail-maker/DetailMakerInputPanel.tsx src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "feat: detail-maker 입력 패널에 무드 브리프 패널 연결"
```

---

# Phase B — ③ 섹션별 씬 재생성

## Task 8: SectionCard에 "🎨 재생성" 버튼 + DetailPageEditor 콜백

**Files:**
- Modify: `src/components/listing/detail-editor/SectionCard.tsx`
- Modify: `src/components/listing/detail-editor/DetailPageEditor.tsx`

- [ ] **Step 1: SectionCard에 prop 추가**

`SectionCardProps`(24~36번 줄)에 추가:

```ts
  /** 섹션 씬 이미지 재생성 콜백 (hero/point에서만 노출) */
  onSceneRegenerate?: (section: DetailSection) => Promise<void>;
```

함수 구조분해(93~96번 줄 부근, `onAiEdit,` 다음)에 추가:

```ts
  onSceneRegenerate,
```

- [ ] **Step 2: 재생성 로컬 상태 + 핸들러 추가**

`handleAiSubmit` 등 핸들러가 모인 곳(150번 줄 부근)에 추가:

```ts
  const [isRegenerating, setIsRegenerating] = React.useState(false);
  const canRegenerate =
    !!onSceneRegenerate && (section.type === 'hero' || section.type === 'point');

  async function handleRegenerateClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onSceneRegenerate || isRegenerating) return;
    setIsRegenerating(true);
    try {
      await onSceneRegenerate(section);
    } finally {
      setIsRegenerating(false);
    }
  }
```

> `React`는 SectionCard 상단에서 이미 import되어 있다. 아니라면 `import React from 'react';` 추가.

- [ ] **Step 3: "AI 수정" 버튼 앞에 "재생성" 버튼 추가**

`{/* AI 수정 버튼 */}` 주석(223번 줄) **바로 앞**에 추가:

```tsx
          {/* 씬 재생성 버튼 (hero/point) */}
          {canRegenerate && (
            <button
              onClick={handleRegenerateClick}
              disabled={isRegenerating}
              title="브리프 톤으로 이 씬 이미지 재생성"
              style={{
                padding: '4px 8px',
                borderRadius: 5,
                border: `1px solid #dddddd`,
                background: 'transparent',
                color: isRegenerating ? '#bbbbbb' : C.textSub,
                cursor: isRegenerating ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
                flexShrink: 0,
              }}
            >
              <span>{isRegenerating ? '⏳' : '🎨'}</span>
              <span>재생성</span>
            </button>
          )}
```

- [ ] **Step 4: DetailPageEditor에 prop 추가 + 전달**

`DetailPageEditorProps`(134번 줄 부근, `onSectionAiEdit` 다음)에 추가:

```ts
  /** 섹션 씬 이미지 재생성 콜백 */
  onSceneRegenerate?: (section: DetailSection) => Promise<void>;
```

함수 구조분해(175~178번 줄 부근, `onSectionAiEdit,` 다음)에 추가:

```ts
  onSceneRegenerate,
```

`<SectionCard ... />` 렌더(498~503번 줄 부근, `onAiEdit={onSectionAiEdit}` 다음)에 추가:

```tsx
                      onSceneRegenerate={onSceneRegenerate}
```

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (콜백이 옵셔널이라 다른 사용처는 영향 없음)

- [ ] **Step 6: 커밋**

```bash
git add src/components/listing/detail-editor/SectionCard.tsx src/components/listing/detail-editor/DetailPageEditor.tsx
git commit -m "feat: SectionCard에 씬 재생성 버튼 + onSceneRegenerate 콜백"
```

---

## Task 9: DetailMakerClient에 재생성 핸들러 연결

**Files:**
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx`

- [ ] **Step 1: 단일 섹션 재생성 핸들러 추가**

`generateSceneImages` 함수 아래에 단일 섹션용 핸들러를 추가한다. 기존 씬 생성/업로드 흐름을 1장에 맞춰 재사용한다.

```ts
  // ─── ③ 단일 섹션 씬 재생성 ──────────────────────────────────────────────────
  async function handleSceneRegenerate(section: DetailSection) {
    if (uploadedUrls.length === 0) return;
    const sectionType = section.type === 'hero' ? 'hero' : 'lifestyle';
    const headline =
      (section.content.type === 'hero' || section.content.type === 'point')
        ? section.content.headline
        : undefined;

    try {
      const sceneRes = await fetch('/api/ai/generate-scene-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionType,
          productImageUrls: uploadedUrls.slice(0, 3),
          productInfo: headline ? { headline } : undefined,
          sceneHint: creativeBrief?.sceneHint,
        }),
      });
      if (!sceneRes.ok) return;
      const sceneData = await sceneRes.json() as {
        success: boolean; data?: { imageBase64: string; mimeType: string };
      };
      if (!sceneData.success || !sceneData.data) return;

      const uploadRes = await fetch('/api/image/upload-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: sceneData.data.imageBase64,
          mimeType: sceneData.data.mimeType,
          role: sectionType,
        }),
      });
      if (!uploadRes.ok) return;
      const uploadData = await uploadRes.json() as { success: boolean; url?: string };
      if (!uploadData.success || !uploadData.url) return;

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
    } catch {
      // 무시 — 버튼이 다시 활성화됨
    }
  }
```

- [ ] **Step 2: DetailPageEditor에 콜백 전달**

`<DetailPageEditor ... />`(311번 줄 부근, `onSectionAiEdit={handleSectionAiEdit}` 다음)에 추가:

```tsx
              onSceneRegenerate={handleSceneRegenerate}
```

- [ ] **Step 3: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: 개발 서버에서 수동 확인**

Run: `npm run dev` → 상세페이지 생성 후, hero/point 섹션 카드의 "🎨 재생성" 클릭 → ⏳로 바뀌고 잠시 후 해당 섹션 이미지가 브리프 톤으로 교체되는지 확인.

- [ ] **Step 5: 커밋**

```bash
git add src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "feat: detail-maker 섹션별 씬 재생성(브리프 톤) 연결"
```

---

## Task 10: 전체 회귀 + 마무리

**Files:** (없음 — 검증 전용)

- [ ] **Step 1: 전체 테스트**

Run: `npx vitest run`
Expected: 전부 PASS (신규 3개 스위트 포함, 기존 회귀 없음)

- [ ] **Step 2: 타입 + 린트**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 없음

- [ ] **Step 3: 빌드**

Run: `npm run build`
Expected: 성공

- [ ] **Step 4: 최종 커밋 (필요 시)**

```bash
git add -A
git commit -m "chore: 크리에이티브 브리프 회귀 검증"
```

---

## Self-Review 결과 (작성자 체크)

- **Spec §1 흐름:** Task 6(추천·선택), Task 7(패널 노출), Task 3/6(sceneHint 일괄 주입), Task 8/9(③ 재생성) — 커버됨.
- **Spec §2 데이터 모델:** Task 1(타입), Task 2(카탈로그·parseSuggestedMoodIds) — 커버됨.
- **Spec §3 컴포넌트/API:** mood-presets(Task 2), suggest-mood(Task 4), CreativeBriefPanel(Task 5), generate-scene-image sceneHint(Task 3), Client/InputPanel(Task 6/7) — 커버됨. `generate-frame-image`는 detail-maker 경로 밖(assets 탭)이라 **의도적 제외**(YAGNI).
- **Spec §4 ③ 보정:** 핵심 "브리프 톤 재생성"은 Task 8/9로 커버. "무드 임시 변경 드롭다운"·"섹션 레퍼런스 첨부"는 상단 **범위 메모**대로 후속 작업으로 분리(서버는 이미 지원).
- **Spec §5 YAGNI / §6 테스트:** 와이어프레임·업로드(B)·커스텀 팔레트·셀러 프리셋 생성 제외 준수. 테스트는 mood-presets·scene-prompt·CreativeBriefPanel 3스위트.
- **타입 일관성:** `CreativeBrief.sceneHint`(string) ↔ `generateSceneImages(..., sceneHint?: string)` ↔ 라우트 `sceneHint: z.string().max(600).optional()` 일치. `onSceneRegenerate(section: DetailSection)` 시그니처 SectionCard/DetailPageEditor/Client 3곳 일치.
