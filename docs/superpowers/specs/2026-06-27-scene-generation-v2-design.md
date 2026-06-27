# Scene Generation v2 — Hero 2-pass · Fidelity 개선 · 텍스트 위치 자동화

## 배경

상세페이지 씬 이미지 생성(2단계 흐름)에서 발견된 4가지 문제:

1. **Hero 원본 고착** — Hero 섹션에 업로드된 원본 이미지가 그대로 표시됨 (AI 생성 미동작)
2. **알약 fidelity 실패** — Gemini 생성 알약 이미지가 원본 제품과 다름
3. **약통 fidelity 실패** — Gemini 생성 병(bottle) 이미지가 원본과 다름
4. **텍스트 하단 고착** — 모든 point 섹션의 텍스트 오버레이가 항상 하단에만 위치 → 단조롭고 가시성 저하

---

## 변경 범위

### 1. Hero: 2-pass Pipeline (Cleanup → Gemini 배경 합성)

**현재:** `generateSceneImages()`에서 Hero도 일반 `generate-scene-image` 단일 호출.
Hero 생성이 실패하면 원본 이미지가 그대로 유지됨.

**변경 후:** Hero 섹션에 대해 2-pass 처리:

```
Step 1: POST /api/ai/cleanup-product-image
  Input:  imageUrl = uploadedUrls[storyboardScene.sourceImageIndex]
  Output: imageBase64 (배경 제거된 제품만)

Step 2: POST /api/ai/generate-scene-image
  Input:
    sectionType: 'hero'
    productImageBase64: Step1 결과
    productImageMimeType: Step1 mimeType
    scenePrompt: storyboardScene.prompt
  Output: 스튜디오 배경이 합성된 히어로 이미지
```

**Why:** 배경이 없는 순수 제품 이미지를 레퍼런스로 넣으면
Gemini가 제품 형태/색상을 더 정확히 파악 → 더 나은 스튜디오 합성.

**실패 처리:** Step 1 또는 Step 2 중 하나라도 실패하면 fallback으로
cleanup 결과(Step 1)를 직접 Hero 이미지로 사용.
Step 1도 실패 시 기존 원본 유지 (현재 동작과 동일).

**파일:** `src/app/listing/detail-maker/DetailMakerClient.tsx`
- `generateSceneImages()` 내부에서 `section.type === 'hero'` 분기 추가

---

### 2. Fidelity 개선: 참조 이미지 확대

**현재:**
```typescript
// storyboard가 있을 때 씬별 소스 1장만 전달
sectionRefUrls = [refUrls[srcIdx]]; // 1장
```

**변경 후:**
```typescript
// 소스 이미지를 첫 번째로, 나머지 업로드 이미지를 뒤에 추가 (최대 3장)
const others = refUrls.filter((_, i) => i !== srcIdx);
sectionRefUrls = [refUrls[srcIdx], ...others].slice(0, 3);
```

**Why:** Gemini에 제품 맥락이 더 많이 전달될수록 fidelity 향상.
한 각도 이미지만 넣으면 Gemini가 제품 형태를 오해할 수 있음.

**파일:** `src/app/listing/detail-maker/DetailMakerClient.tsx`
- `generateSceneImages()` 내 `storyboardScene` 분기

---

### 3. 텍스트 위치 자동화: `textPosition`

#### 3a. 타입 확장

**`src/types/detail-page.ts`**

`SceneStoryboardItem`에 optional 필드 추가:
```typescript
export interface SceneStoryboardItem {
  // 기존 필드 유지
  prompt: string;
  promptKo?: string;
  textPosition?: 'top' | 'center' | 'bottom'; // 신규
  // ...
}
```

`PointContent`에 optional 필드 추가:
```typescript
export interface PointContent {
  // 기존 필드 유지
  headline: string;
  subheadline: string;
  pointLabel?: string;
  textPosition?: 'top' | 'center' | 'bottom'; // 신규
}
```

#### 3b. plan-scene-images 프롬프트 확장

**`src/app/api/ai/plan-scene-images/route.ts`** `SYSTEM_PROMPT`:

`textPosition` 항목 추가:
```
- textPosition: "top" | "center" | "bottom" — where to place text overlay on the scene.
  Choose based on scene composition:
  - "top": product or key subject is in the lower half, leaving upper space clear
  - "bottom": product is in upper half, lower area has negative space or plain surface
  - "center": strong horizontal band of open space in the middle (rare)
  Default to "bottom" if unsure.
```

scenes 매핑에 `textPosition` 포함:
```typescript
const scenes = data.scenes.map(s => ({
  ...s,
  textPosition: ['top', 'center', 'bottom'].includes(s.textPosition as string)
    ? (s.textPosition as 'top' | 'center' | 'bottom')
    : 'bottom',
  // 나머지 기존 필드
}));
```

#### 3c. DetailMakerClient: textPosition → PointContent 전파

**`src/app/listing/detail-maker/DetailMakerClient.tsx`**

`generateSceneImages()` 결과 처리 부분에서 `textPosition`도 함께 업데이트:
```typescript
setSections(prev => {
  const updated = prev.map(s => {
    const hit = urlUpdates.find(u => u.sectionId === s.id);
    if (!hit) return s;

    // textPosition을 storyboard에서 가져와 PointContent에 적용
    const storyboardScene = storyboardItems?.find(sc => sc.id === hit.sceneId);
    const newContent =
      s.type === 'point' && storyboardScene?.textPosition
        ? { ...s.content, textPosition: storyboardScene.textPosition }
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

`urlUpdates`에 `sceneId`가 이미 포함되어 있어 참조 가능.

#### 3d. section-renderer: 위치별 오버레이 렌더링

**`src/lib/detail-page/section-renderer.ts`** `renderPoint()`:

현재 하드코딩:
```typescript
<div style="position:absolute;bottom:0;left:0;right:0;
  background:linear-gradient(transparent 0%,rgba(0,0,0,0.60) 35%,rgba(0,0,0,0.82) 100%);
  padding:24px 20px 28px;...">
```

변경 후 — `textPosition`에 따라 분기:

| position | CSS position | gradient |
|----------|-------------|----------|
| `bottom` (기본) | `bottom:0;left:0;right:0` | `transparent→black` (하향) |
| `top` | `top:0;left:0;right:0` | `black→transparent` (상향) |
| `center` | `top:50%;left:0;right:0;transform:translateY(-50%)` | 단색 `rgba(0,0,0,0.70)` |

```typescript
function renderPoint(content: PointContent, section: DetailSection, ...) {
  const tp = content.textPosition ?? 'bottom';
  const overlayStyle = tp === 'top'
    ? 'position:absolute;top:0;left:0;right:0;background:linear-gradient(rgba(0,0,0,0.82) 0%,rgba(0,0,0,0.60) 65%,transparent 100%);padding:28px 20px 24px;'
    : tp === 'center'
    ? 'position:absolute;top:50%;left:0;right:0;transform:translateY(-50%);background:rgba(0,0,0,0.70);padding:20px;'
    : 'position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent 0%,rgba(0,0,0,0.60) 35%,rgba(0,0,0,0.82) 100%);padding:24px 20px 28px;';
  
  return `<div ... style="position:relative;...">
    <img ... />
    <div style="${overlayStyle}text-align:center;line-height:1.4;box-sizing:border-box;">
      ...
    </div>
  </div>`;
}
```

---

## 파일 변경 목록

| 파일 | 변경 내용 |
|------|-----------|
| `src/types/detail-page.ts` | `SceneStoryboardItem.textPosition`, `PointContent.textPosition` 추가 |
| `src/app/api/ai/plan-scene-images/route.ts` | SYSTEM_PROMPT에 `textPosition` 추가, scenes 매핑 확장 |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | Hero 2-pass 분기, ref 이미지 확대, textPosition 전파 |
| `src/lib/detail-page/section-renderer.ts` | `renderPoint()` 오버레이 위치 동적 처리 |

---

## 검증 시나리오

1. **Hero 생성 확인** — 기획 생성 후 "이미지 생성" 클릭 → Hero 섹션에 Gemini 합성 이미지 표시 (원본 아님)
2. **Fidelity** — 덴프스NMN 제품으로 Point 씬 생성 → 알약/약통 형태가 이전보다 원본에 가까운지 확인
3. **텍스트 위치 다양화** — plan-scene-images 결과에 `textPosition`이 씬마다 다르게 나오는지 확인, HTML 미리보기에서 상단/중앙/하단 오버레이 레이아웃 확인
4. **Fallback** — Hero Step 1 실패 시 에러 없이 원본 유지되는지 확인

---

## 범위 외

- `handleRegenerateScene()` 단일 재생성 시 textPosition 업데이트 (차기 개선)
- 텍스트 위치 사용자 수동 수정 UI (차기 개선)
- Hero cleanup 품질 튜닝 (현재 cleanup-product-image API 그대로 사용)
