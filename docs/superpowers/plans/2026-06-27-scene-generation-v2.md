# Scene Generation v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hero 섹션 2-pass 생성(Cleanup→Gemini 합성), point 씬 레퍼런스 이미지 확대, 텍스트 오버레이 위치 자동화.

**Architecture:** 4개 파일 변경. 타입 확장 → 렌더러 TDD → API 프롬프트 → 클라이언트 파이프라인 순서로 진행. 각 Task는 독립적으로 컴파일·테스트 가능하다.

**Tech Stack:** TypeScript, Next.js App Router, Vitest, React

---

## 파일 변경 목록

| 파일 | 변경 목적 |
|------|-----------|
| `src/types/detail-page.ts` | `SceneStoryboardItem.textPosition`, `PointContent.textPosition` optional 추가 |
| `src/__tests__/lib/detail-page/section-renderer.test.ts` | `renderPoint` textPosition 케이스 테스트 추가 |
| `src/lib/detail-page/section-renderer.ts` | `renderPoint()` 오버레이 위치 동적 처리 |
| `src/app/api/ai/plan-scene-images/route.ts` | SYSTEM_PROMPT에 `textPosition` 추가, scenes 매핑 확장 |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | Hero 2-pass, ref 이미지 확대, textPosition 전파 |

---

## Task 1: 타입 확장 — `textPosition` 필드 추가

**Files:**
- Modify: `src/types/detail-page.ts:90-95` (PointContent)
- Modify: `src/types/detail-page.ts:282-292` (SceneStoryboardItem)

- [ ] **Step 1: PointContent에 `textPosition` 추가**

`src/types/detail-page.ts` 90-95번째 줄 `PointContent` 인터페이스:

```typescript
export interface PointContent {
  type: 'point';
  pointLabel: string | null;
  headline: string;
  subheadline: string;
  textPosition?: 'top' | 'center' | 'bottom'; // 추가
}
```

- [ ] **Step 2: SceneStoryboardItem에 `textPosition` 추가**

`src/types/detail-page.ts` 282-292번째 줄 `SceneStoryboardItem` 인터페이스:

```typescript
export interface SceneStoryboardItem {
  id: string;
  title: string;
  description: string;
  prompt: string;
  promptKo?: string;
  textPosition?: 'top' | 'center' | 'bottom'; // 추가
  sourceImageIndex: number;
  mode: 'ai' | 'cleanup';
  resultUrl?: string;
  sectionId: string | null;
}
```

- [ ] **Step 3: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit
```

Expected: 에러 없음 (optional 필드이므로 기존 코드 영향 없음)

- [ ] **Step 4: 커밋**

```bash
git add src/types/detail-page.ts
git commit -m "feat(types): add textPosition to SceneStoryboardItem and PointContent"
```

---

## Task 2: `renderPoint` — 텍스트 오버레이 위치 동적화 (TDD)

**Files:**
- Test: `src/__tests__/lib/detail-page/section-renderer.test.ts`
- Modify: `src/lib/detail-page/section-renderer.ts:359-387`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/detail-page/section-renderer.test.ts` 파일 끝에 추가 (기존 `baseSection` 헬퍼 재사용):

```typescript
// ---------------------------------------------------------------------------
// renderSection — point (textPosition)
// ---------------------------------------------------------------------------

describe('renderSection — point (textPosition)', () => {
  const pointSection = (textPosition?: 'top' | 'center' | 'bottom') =>
    baseSection({
      type: 'point',
      content: {
        type: 'point',
        pointLabel: 'Point 1',
        headline: '헤드라인',
        subheadline: '서브',
        ...(textPosition !== undefined && { textPosition }),
      },
      attachedImages: [{ url: 'https://example.com/img.jpg', order: 0, processingMode: 'original' }],
    });

  it('textPosition 미지정 시 오버레이가 하단(bottom:0)에 위치한다', () => {
    const html = renderSection(pointSection(), WARM_CREAM_THEME);
    expect(html).toContain('bottom:0');
    expect(html).not.toContain('top:0');
    expect(html).not.toContain('translateY(-50%)');
  });

  it("textPosition: 'bottom' 시 오버레이가 하단(bottom:0)에 위치한다", () => {
    const html = renderSection(pointSection('bottom'), WARM_CREAM_THEME);
    expect(html).toContain('bottom:0');
    expect(html).not.toContain('top:0');
  });

  it("textPosition: 'top' 시 오버레이가 상단(top:0)에 위치하고 bottom:0은 없다", () => {
    const html = renderSection(pointSection('top'), WARM_CREAM_THEME);
    expect(html).toContain('top:0');
    expect(html).not.toContain('bottom:0');
    expect(html).toContain('rgba(0,0,0,0.82) 0%');
  });

  it("textPosition: 'center' 시 오버레이가 중앙(translateY(-50%))에 위치한다", () => {
    const html = renderSection(pointSection('center'), WARM_CREAM_THEME);
    expect(html).toContain('translateY(-50%)');
    expect(html).not.toContain('bottom:0');
    expect(html).not.toContain('top:0');
  });

  it('이미지 없는 point 섹션은 textPosition 무관하게 텍스트만 출력한다', () => {
    const section = baseSection({
      type: 'point',
      content: { type: 'point', pointLabel: null, headline: '헤드라인', subheadline: '서브', textPosition: 'top' },
      attachedImages: [],
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain('헤드라인');
    expect(html).not.toContain('position:absolute');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/section-renderer.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: `textPosition: 'top' 시 오버레이...` 등 새 테스트들이 FAIL (현재 `bottom:0` 하드코딩)

- [ ] **Step 3: `renderPoint` 구현 — 오버레이 위치 동적화**

`src/lib/detail-page/section-renderer.ts` `renderPoint` 함수 (line 359 근처):

```typescript
function renderPoint(content: PointContent, section: DetailSection, colors: PaletteColors, theme: DetailPageTheme): string {
  const headingFont = headingFontStyle(theme.fontStyle);
  const safeUrl = section.attachedImages[0] ? sanitizeUrl(section.attachedImages[0].url) : '';

  if (!safeUrl) {
    const labelHtml = content.pointLabel
      ? `<div style="margin-bottom:12px;"><span style="display:block;font-size:18px;color:${colors.labelColor};margin-bottom:6px;">&#9745;</span><span style="font-family:Georgia,serif;font-style:italic;font-size:26px;color:${colors.labelColor};">${editableText('content.pointLabel', content.pointLabel)}</span></div>`
      : '';
    return `<div ${sectionAttrs(section)} style="background-color:${colors.cardBg};padding:40px 20px 28px;text-align:center;box-sizing:border-box;">
  ${labelHtml}
  <h2 style="margin:0 0 10px;font-size:28px;font-weight:800;color:${colors.text};line-height:1.35;letter-spacing:-0.5px${headingFont};">${editableText('content.headline', content.headline)}</h2>
  <p style="margin:0;font-size:17px;color:${colors.textSub};line-height:1.6;">${editableMarkupText('content.subheadline', content.subheadline, colors.accent)}</p>
</div>`;
  }

  const tp = content.textPosition ?? 'bottom';
  const overlayStyle =
    tp === 'top'
      ? 'position:absolute;top:0;left:0;right:0;background:linear-gradient(rgba(0,0,0,0.82) 0%,rgba(0,0,0,0.60) 65%,transparent 100%);padding:28px 20px 24px;text-align:center;line-height:1.4;box-sizing:border-box;'
      : tp === 'center'
      ? 'position:absolute;top:50%;left:0;right:0;transform:translateY(-50%);background:rgba(0,0,0,0.70);padding:20px;text-align:center;line-height:1.4;box-sizing:border-box;'
      : 'position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent 0%,rgba(0,0,0,0.60) 35%,rgba(0,0,0,0.82) 100%);padding:24px 20px 28px;text-align:center;line-height:1.4;box-sizing:border-box;';

  const labelHtml = content.pointLabel
    ? `<div style="margin-bottom:8px;"><span style="font-family:Georgia,serif;font-style:italic;font-size:20px;color:rgba(255,255,255,0.92);">${editableText('content.pointLabel', content.pointLabel)}</span></div>`
    : '';
  return `<div ${sectionAttrs(section)} style="position:relative;width:100%;overflow:hidden;line-height:0;box-sizing:border-box;">
  <img src="${escapeHtml(safeUrl)}" alt="" style="width:100%;display:block;" />
  <div style="${overlayStyle}">
    ${labelHtml}
    <h2 style="margin:0 0 8px;font-size:26px;font-weight:800;color:#fff;line-height:1.3;letter-spacing:-0.5px;text-shadow:0 2px 8px rgba(0,0,0,0.8),0 0 20px rgba(0,0,0,0.5)${headingFont};">${editableText('content.headline', content.headline)}</h2>
    <p style="margin:0;font-size:16px;color:rgba(255,255,255,0.88);line-height:1.5;">${editableMarkupText('content.subheadline', content.subheadline, 'rgba(255,255,255,0.7)')}</p>
  </div>
</div>`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/section-renderer.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: 모든 테스트 PASS

- [ ] **Step 5: 전체 테스트 회귀 확인**

```bash
npx vitest run src/__tests__/lib/detail-page/ --reporter=verbose 2>&1 | tail -10
```

Expected: 모든 테스트 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/__tests__/lib/detail-page/section-renderer.test.ts src/lib/detail-page/section-renderer.ts
git commit -m "feat(renderer): dynamic textPosition overlay for point sections"
```

---

## Task 3: `plan-scene-images` — `textPosition` AI 자동 제안

**Files:**
- Modify: `src/app/api/ai/plan-scene-images/route.ts:27-40` (SYSTEM_PROMPT)
- Modify: `src/app/api/ai/plan-scene-images/route.ts:90-101` (scenes 매핑)

- [ ] **Step 1: SYSTEM_PROMPT에 `textPosition` 항목 추가**

`src/app/api/ai/plan-scene-images/route.ts` 27-40번째 줄 `SYSTEM_PROMPT` 교체:

```typescript
const SYSTEM_PROMPT = `You are a Korean e-commerce product photographer and content strategist.
Create a scene image storyboard for a product detail page.
Return ONLY valid JSON (no markdown, no code block): {"scenes": [...]}

Each scene object must have:
- title: Korean string, max 15 chars (e.g. "제품 전면 클로즈업")
- description: one-line Korean marketing purpose, max 50 chars
- prompt: detailed English Gemini image generation prompt, 80-150 words
- promptKo: 씬 연출 방향을 사용자에게 설명하는 한국어 1-2문장 요약. 예: "흰 배경 스튜디오에서 정면 조명으로 제품을 단정하게 담은 히어로 컷입니다."
- suggestedImageIndex: integer 0-based, which uploaded image index to use
- textPosition: "top" | "center" | "bottom" — where to place the text overlay on the generated scene image.
  Choose based on the scene composition described in the prompt:
  - "top": product or key subject occupies the lower half, leaving the upper area clear for text
  - "bottom": product is in the upper half, lower area has negative space or plain surface
  - "center": a strong horizontal band of open space runs through the middle (rare)
  Default to "bottom" if unsure.

Prompt format: [Setting/environment]. [Product placement]. [Lighting quality]. [Camera angle and framing]. [Mood and color palette]. No text, logos, or watermarks in the scene. The product must appear exactly as-is — do not alter its shape, color, or material.

Make each scene serve a distinct purpose: studio hero shot, lifestyle in-use scene, texture/detail macro, benefit visualization.`;
```

- [ ] **Step 2: scenes 매핑에 `textPosition` 검증 추가**

`src/app/api/ai/plan-scene-images/route.ts` 90-101번째 줄 `scenes` 매핑 교체:

```typescript
const VALID_TEXT_POSITIONS = new Set(['top', 'center', 'bottom']);

const scenes = data.scenes
  .filter(s => typeof s.prompt === 'string' && (s.prompt as string).trim().length > 0)
  .map(s => ({
    ...s,
    promptKo: typeof s.promptKo === 'string' && (s.promptKo as string).trim()
      ? (s.promptKo as string)
      : (typeof s.description === 'string' ? s.description : ''),
    textPosition: VALID_TEXT_POSITIONS.has(s.textPosition as string)
      ? (s.textPosition as 'top' | 'center' | 'bottom')
      : 'bottom' as const,
    suggestedImageIndex: Math.min(
      Math.max(Number(s.suggestedImageIndex) || 0, 0),
      imageCount - 1,
    ),
  }));
```

`VALID_TEXT_POSITIONS` const는 함수 바깥 모듈 레벨에 선언.

- [ ] **Step 3: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/ai/plan-scene-images/route.ts
git commit -m "feat(api): add textPosition to plan-scene-images storyboard output"
```

---

## Task 4: `DetailMakerClient` — Hero 2-pass 파이프라인

**Files:**
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx:309-360` (generateSceneImages 내 분기)

Hero 섹션(`section.type === 'hero'`)을 다음 2-pass로 처리:
1. `cleanup-product-image` → 배경 제거 (Step 1)
2. `generate-scene-image` (productImageBase64 전달) → 배경 합성 (Step 2)
   - Step 2 실패 시 → Step 1 결과(cleanup)로 fallback
   - Step 1 실패 시 → null 반환 (원본 유지)

- [ ] **Step 1: Hero 분기 코드 교체**

`src/app/listing/detail-maker/DetailMakerClient.tsx` 309-360번째 줄의 `if (storyboardScene?.mode === 'cleanup') { ... } else { ... }` 블록 전체를 아래로 교체:

```typescript
          // ─── 분기: Hero 2-pass / cleanup / AI ───────────────────────────
          if (section.type === 'hero' && storyboardScene?.mode !== 'cleanup') {
            // Hero: Step 1 cleanup → Step 2 Gemini 배경 합성
            const heroSrcIdx = Math.min(
              storyboardScene?.sourceImageIndex ?? 0,
              refUrls.length - 1,
            );
            const heroSourceUrl = refUrls[heroSrcIdx] ?? refUrls[0];

            // Step 1: 배경 제거
            const cleanupRes = await fetch('/api/ai/cleanup-product-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageUrl: heroSourceUrl }),
            });
            if (!cleanupRes.ok) return null;
            const cleanupData = await cleanupRes.json() as {
              imageBase64?: string;
              mimeType?: string;
              error?: string;
            };
            if (cleanupData.error || !cleanupData.imageBase64 || !cleanupData.mimeType) return null;

            // Step 2: Gemini 배경 합성 (cleanup 결과를 레퍼런스로)
            const heroSceneRes = await fetch('/api/ai/generate-scene-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sectionType: 'hero' as const,
                productImageBase64: cleanupData.imageBase64,
                productImageMimeType: cleanupData.mimeType,
                ...(storyboardScene
                  ? { scenePrompt: storyboardScene.prompt }
                  : { sceneHint: combinedHint }),
              }),
            });

            if (!heroSceneRes.ok) {
              // Step 2 실패 → cleanup 결과로 fallback
              imageBase64 = cleanupData.imageBase64;
              mimeType = cleanupData.mimeType;
            } else {
              const heroSceneData = await heroSceneRes.json() as {
                success: boolean;
                data?: { imageBase64: string; mimeType: string };
              };
              if (!heroSceneData.success || !heroSceneData.data) {
                imageBase64 = cleanupData.imageBase64;
                mimeType = cleanupData.mimeType;
              } else {
                imageBase64 = heroSceneData.data.imageBase64;
                mimeType = heroSceneData.data.mimeType;
              }
            }
          } else if (storyboardScene?.mode === 'cleanup') {
            // 기존 cleanup 단일 패스 (hero가 아닌 섹션의 cleanup 모드)
            const srcIdx = Math.min(storyboardScene.sourceImageIndex, refUrls.length - 1);
            const sourceUrl = refUrls[srcIdx] ?? refUrls[0];
            const cleanupRes = await fetch('/api/ai/cleanup-product-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageUrl: sourceUrl }),
            });
            if (!cleanupRes.ok) return null;
            const cleanupData = await cleanupRes.json() as {
              imageBase64?: string;
              mimeType?: string;
              error?: string;
            };
            if (cleanupData.error || !cleanupData.imageBase64 || !cleanupData.mimeType) return null;
            imageBase64 = cleanupData.imageBase64;
            mimeType = cleanupData.mimeType;
          } else {
            // 기존 AI 단일 패스 (point 섹션 AI 모드)
            const sceneBody = storyboardScene
              ? {
                  sectionType,
                  productImageUrls: sectionRefUrls,
                  productInfo: headline ? { headline } : undefined,
                  scenePrompt: storyboardScene.prompt,
                }
              : {
                  sectionType,
                  productImageUrls: sectionRefUrls,
                  productInfo: headline ? { headline } : undefined,
                  sceneHint: combinedHint,
                };

            const sceneRes = await fetch('/api/ai/generate-scene-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(sceneBody),
            });
            if (!sceneRes.ok) return null;

            const sceneData = await sceneRes.json() as {
              success: boolean;
              data?: { imageBase64: string; mimeType: string };
            };
            if (!sceneData.success || !sceneData.data) return null;
            imageBase64 = sceneData.data.imageBase64;
            mimeType = sceneData.data.mimeType;
          }
```

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "feat(client): hero 2-pass pipeline — cleanup then Gemini composite"
```

---

## Task 5: `DetailMakerClient` — Fidelity 개선 + `textPosition` 전파

**Files:**
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx:14` (import 확장)
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx:291-307` (ref 이미지 확대)
- Modify: `src/app/listing/detail-maker/DetailMakerClient.tsx:393-413` (setSections textPosition 전파)

- [ ] **Step 1: `isPointContent` import 추가**

`src/app/listing/detail-maker/DetailMakerClient.tsx` 14번째 줄:

현재:
```typescript
import type { DetailSection, DetailPageTheme, CreativeBrief, SceneStoryboardItem } from '@/types/detail-page';
```

변경 후:
```typescript
import { isPointContent, type DetailSection, type DetailPageTheme, type CreativeBrief, type SceneStoryboardItem } from '@/types/detail-page';
```

- [ ] **Step 2: ref 이미지 확대 (storyboard 분기, 1장 → 최대 3장)**

`src/app/listing/detail-maker/DetailMakerClient.tsx` 295-297번째 줄 (storyboardScene 분기 내):

현재:
```typescript
          if (storyboardScene) {
            const srcIdx = Math.min(storyboardScene.sourceImageIndex, refUrls.length - 1);
            sectionRefUrls = [refUrls[srcIdx]];
```

변경 후:
```typescript
          if (storyboardScene) {
            const srcIdx = Math.min(storyboardScene.sourceImageIndex, refUrls.length - 1);
            const others = refUrls.filter((_, i) => i !== srcIdx);
            sectionRefUrls = [refUrls[srcIdx], ...others].slice(0, 3);
```

- [ ] **Step 3: setSections에 textPosition 전파 추가**

`src/app/listing/detail-maker/DetailMakerClient.tsx` 392-413번째 줄 `setSections` 콜백:

현재:
```typescript
    if (urlUpdates.length > 0) {
      setSections(prev => {
        const updated = prev.map(s => {
          const hit = urlUpdates.find(u => u.sectionId === s.id);
          if (!hit) return s;
          return { ...s, attachedImages: [{ url: hit.url, order: 0, processingMode: 'original' as const }] };
        });
        void refreshRenderedHtml(updated, currentTheme);
        return updated;
      });
```

변경 후:
```typescript
    if (urlUpdates.length > 0) {
      setSections(prev => {
        const updated = prev.map(s => {
          const hit = urlUpdates.find(u => u.sectionId === s.id);
          if (!hit) return s;
          const matchedScene = storyboardItems?.find(sc => sc.id === hit.sceneId);
          const newContent =
            isPointContent(s.content) && matchedScene?.textPosition
              ? { ...s.content, textPosition: matchedScene.textPosition }
              : s.content;
          return {
            ...s,
            content: newContent,
            attachedImages: [{ url: hit.url, order: 0, processingMode: 'original' as const }],
          };
        });
        void refreshRenderedHtml(updated, currentTheme);
        return updated;
      });
```

- [ ] **Step 4: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit
```

Expected: 에러 없음

- [ ] **Step 5: 전체 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/ --reporter=verbose 2>&1 | tail -15
```

Expected: 모든 테스트 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/app/listing/detail-maker/DetailMakerClient.tsx
git commit -m "feat(client): expand ref images to 3, propagate textPosition to sections"
```

---

## 검증 시나리오 (수동)

1. **Hero 2-pass 확인**: 기획 생성 → "이미지 생성" 클릭 → Hero 섹션에 Gemini 합성 이미지 표시 (원본 아님). Network 탭에서 `/api/ai/cleanup-product-image` 호출 후 `/api/ai/generate-scene-image` 순서로 2번 호출되는지 확인.

2. **텍스트 위치 다양화**: plan-scene-images 응답 JSON에 `textPosition` 필드가 씬마다 다르게 나오는지 확인. HTML 미리보기에서 오버레이가 상단/하단/중앙 중 씬별로 다른 위치에 나오는지 확인.

3. **Fidelity**: 덴프스NMN 제품으로 Point 씬 생성 → 이전 결과 대비 알약/약통 형태가 더 원본에 가까운지 비교.

4. **Fallback**: 네트워크 탭 등으로 cleanup API를 차단하면 Hero 섹션이 에러 없이 원본 유지되는지 확인.
