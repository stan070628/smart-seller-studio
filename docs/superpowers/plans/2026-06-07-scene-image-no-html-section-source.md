# 씬 이미지 HTML 제거 + 섹션 소스 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 씬 이미지 생성 시 HTML을 재생성하는 버그를 제거하고, 생성된 AI 이미지를 섹션 소스 픽커에서 선택할 수 있도록 한다.

**Architecture:** 세 진입점(`handleConfirmCrops`, `handleGenerate`, `generateDetailPageFromPicked`)에서 `buildAiDetailPageHtml` / `appendPrivacyFooter` 호출을 제거한다. 씬 이미지는 `assetsDraft.aiImageSlots`에만 저장된다. `SectionImageAttachment`의 소스 픽커 모달에 "AI 생성 이미지" 섹션을 추가해 사용자가 섹션별로 직접 선택하도록 한다.

**Tech Stack:** Next.js App Router, React, Zustand, TypeScript

---

## 파일 구조

| 파일 | 변경 내용 |
|------|---------|
| `src/components/listing/assets/AssetsTab.tsx` | HTML 빌드 호출 3곳 제거, 미사용 import 정리 |
| `src/store/useListingStore.ts` | `generateDetailPageFromPicked` HTML 빌드 제거, `assetsDraft.aiImageSlots` 업데이트 추가 |
| `src/components/listing/detail-editor/SectionImageAttachment.tsx` | AI 이미지 소스 섹션 추가, 직접 추가 핸들러 추가 |

---

### Task 1: AssetsTab.tsx — HTML 생성 코드 제거

**Files:**
- Modify: `src/components/listing/assets/AssetsTab.tsx`

- [ ] **Step 1: `handleConfirmCrops`에서 HTML 빌드 블록 제거**

현재 코드 (line 327-333):
```typescript
      let finalHtml = baseHtml;
      const finalContent = detailContent;

      if (aiSlots.length > 0 && detailContent) {
        updateAssetsDraft({ generatingMessage: 'HTML 완성 중...' });
        finalHtml = appendPrivacyFooter(buildAiDetailPageHtml(detailContent, aiSlots));
      }
```

아래로 교체:
```typescript
      const finalContent = detailContent;
```

그리고 이어지는 `updateAssetsDraft` 호출(line 340-348)에서 `generatedDetailHtml: finalHtml` → `generatedDetailHtml: baseHtml`로 변경:

변경 전:
```typescript
      updateAssetsDraft({
        isGenerating: false,
        generatingMessage: null,
        generatedDetailHtml: finalHtml,
        detailPageSections,
        aiImageSlots: aiSlots,
        aiDetailContent: finalContent ?? null,
        confirmedCrops: null,
      });
```

변경 후:
```typescript
      updateAssetsDraft({
        isGenerating: false,
        generatingMessage: null,
        generatedDetailHtml: baseHtml,
        detailPageSections,
        aiImageSlots: aiSlots,
        aiDetailContent: finalContent ?? null,
        confirmedCrops: null,
      });
```

- [ ] **Step 2: `handleGenerate` URL 모드 — 기존 content 재사용 경로 HTML 빌드 제거**

현재 코드 (line 392-400):
```typescript
        if (existingContentUrl && includeAiImages && thumbnails.length > 0) {
          // 기존 "AI와 함께 만들기" content 재사용 — 씬 이미지만 새로 생성
          detailContent = existingContentUrl;
          detailHtml = assetsDraft.generatedDetailHtml;
          aiSlots = await runSceneImageGenerationFromUrl(existingContentUrl, thumbnails[0]);
          if (aiSlots.length > 0) {
            updateAssetsDraft({ generatingMessage: 'HTML 완성 중...' });
            detailHtml = appendPrivacyFooter(buildAiDetailPageHtml(existingContentUrl, aiSlots));
          }
```

아래로 교체 (if 블록 안의 HTML 빌드 4줄 제거):
```typescript
        if (existingContentUrl && includeAiImages && thumbnails.length > 0) {
          // 기존 "AI와 함께 만들기" content 재사용 — 씬 이미지만 새로 생성
          detailContent = existingContentUrl;
          detailHtml = assetsDraft.generatedDetailHtml;
          aiSlots = await runSceneImageGenerationFromUrl(existingContentUrl, thumbnails[0]);
```

- [ ] **Step 3: `handleGenerate` URL 모드 — Gemini 이미지 생성 후 HTML 빌드 제거**

현재 코드 (line 406-413):
```typescript
          if (includeAiImages && result.imagePrompts) {
            aiSlots = await runGeminiImageGeneration(result.imagePrompts, thumbnails[0], (done, total) => {
              updateAssetsDraft({ generatingMessage: `Gemini 이미지 생성 중 (${done}/${total})...` });
            });
            if (aiSlots.length > 0 && detailContent) {
              updateAssetsDraft({ generatingMessage: 'HTML 완성 중...' });
              detailHtml = appendPrivacyFooter(buildAiDetailPageHtml(detailContent, aiSlots));
            }
```

아래로 교체 (HTML 빌드 3줄 제거):
```typescript
          if (includeAiImages && result.imagePrompts) {
            aiSlots = await runGeminiImageGeneration(result.imagePrompts, thumbnails[0], (done, total) => {
              updateAssetsDraft({ generatingMessage: `Gemini 이미지 생성 중 (${done}/${total})...` });
            });
```

- [ ] **Step 4: `handleGenerate` 업로드 모드 — 기존 content 재사용 경로 HTML 빌드 제거**

현재 코드 (line 442-450):
```typescript
      if (existingContentUpload && includeAiImages && detailSources.length > 0) {
        // 기존 "AI와 함께 만들기" content 재사용 — 씬 이미지만 새로 생성
        detailContent = existingContentUpload;
        detailHtml = assetsDraft.generatedDetailHtml;
        aiSlots = await runSceneImageGenerationFromUrl(existingContentUpload, detailSources[0]);
        if (aiSlots.length > 0) {
          updateAssetsDraft({ generatingMessage: 'HTML 완성 중...' });
          detailHtml = appendPrivacyFooter(buildAiDetailPageHtml(existingContentUpload, aiSlots));
        }
```

아래로 교체:
```typescript
      if (existingContentUpload && includeAiImages && detailSources.length > 0) {
        // 기존 "AI와 함께 만들기" content 재사용 — 씬 이미지만 새로 생성
        detailContent = existingContentUpload;
        detailHtml = assetsDraft.generatedDetailHtml;
        aiSlots = await runSceneImageGenerationFromUrl(existingContentUpload, detailSources[0]);
```

- [ ] **Step 5: `handleGenerate` 업로드 모드 — Gemini 이미지 생성 후 HTML 빌드 제거**

현재 코드 (line 457-464):
```typescript
        if (includeAiImages && result.imagePrompts) {
          aiSlots = await runGeminiImageGeneration(result.imagePrompts, detailSources[0], (done, total) => {
            updateAssetsDraft({ generatingMessage: `Gemini 이미지 생성 중 (${done}/${total})...` });
          });
          if (aiSlots.length > 0 && detailContent) {
            updateAssetsDraft({ generatingMessage: 'HTML 완성 중...' });
            detailHtml = appendPrivacyFooter(buildAiDetailPageHtml(detailContent, aiSlots));
          }
```

아래로 교체:
```typescript
        if (includeAiImages && result.imagePrompts) {
          aiSlots = await runGeminiImageGeneration(result.imagePrompts, detailSources[0], (done, total) => {
            updateAssetsDraft({ generatingMessage: `Gemini 이미지 생성 중 (${done}/${total})...` });
          });
```

- [ ] **Step 6: 미사용 import 제거**

현재 import (line 10-13):
```typescript
import { buildAiDetailPageHtml } from '@/lib/detail-page/ai-html-builder';
import type { AiImageSlot } from '@/lib/detail-page/ai-html-builder';
import type { ImagePromptsResponse, SectionImagePrompt } from '@/lib/ai/prompts/detail-image-prompts';
import { appendPrivacyFooter } from '@/lib/detail-page-privacy';
```

아래로 교체 (`buildAiDetailPageHtml`과 `appendPrivacyFooter` 제거, `AiImageSlot` 유지):
```typescript
import type { AiImageSlot } from '@/lib/detail-page/ai-html-builder';
import type { ImagePromptsResponse, SectionImagePrompt } from '@/lib/ai/prompts/detail-image-prompts';
```

- [ ] **Step 7: TypeScript 컴파일 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio && npx tsc --noEmit 2>&1 | head -30
```

Expected: 에러 없음 (또는 기존에 있던 에러만)

- [ ] **Step 8: 커밋**

```bash
git add src/components/listing/assets/AssetsTab.tsx
git commit -m "refactor: 씬 이미지 생성 시 HTML 재빌드 제거 — aiImageSlots만 저장"
```

---

### Task 2: useListingStore.ts — `generateDetailPageFromPicked` HTML 제거

**Files:**
- Modify: `src/store/useListingStore.ts`

- [ ] **Step 1: `generateDetailPageFromPicked` 씬-전용 경로에서 HTML 빌드 제거**

현재 코드 (line 1327-1340):
```typescript
            const aiSlots = results
              .filter((r): r is PromiseFulfilledResult<AiImageSlot> => r.status === 'fulfilled')
              .map((r) => r.value);

            const finalHtml = aiSlots.length > 0
              ? appendPrivacyFooter(buildAiDetailPageHtml(aiDetailContent, aiSlots))
              : get().sharedDraft.detailPageFullHtml ?? '';

            set(
              (s) => ({ sharedDraft: { ...s.sharedDraft, detailPageFullHtml: finalHtml, detailPageStatus: 'done' } }),
              false,
              'listing/generateDetailPageFromPicked/sceneOnlyDone',
            );
            return;
```

아래로 교체:
```typescript
            const aiSlots = results
              .filter((r): r is PromiseFulfilledResult<AiImageSlot> => r.status === 'fulfilled')
              .map((r) => r.value);

            set(
              (s) => ({
                sharedDraft: { ...s.sharedDraft, detailPageStatus: 'done' },
                assetsDraft: { ...s.assetsDraft, aiImageSlots: aiSlots },
              }),
              false,
              'listing/generateDetailPageFromPicked/sceneOnlyDone',
            );
            return;
```

- [ ] **Step 2: 미사용 import 정리**

현재 import (line 17-18):
```typescript
import { buildAiDetailPageHtml, type AiImageSlot } from '@/lib/detail-page/ai-html-builder';
import { appendPrivacyFooter } from '@/lib/detail-page-privacy';
```

아래로 교체 (`buildAiDetailPageHtml`, `appendPrivacyFooter` 제거):
```typescript
import type { AiImageSlot } from '@/lib/detail-page/ai-html-builder';
```

- [ ] **Step 3: TypeScript 컴파일 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio && npx tsc --noEmit 2>&1 | head -30
```

Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/store/useListingStore.ts
git commit -m "refactor: generateDetailPageFromPicked 씬-전용 경로 HTML 빌드 제거"
```

---

### Task 3: SectionImageAttachment.tsx — AI 이미지 소스 추가

**Files:**
- Modify: `src/components/listing/detail-editor/SectionImageAttachment.tsx`

- [ ] **Step 1: `AiImageSlot` 타입 import 추가**

현재 import (line 12):
```typescript
import type { AttachedImage, ImageProcessingMode, PaletteName } from '@/types/detail-page';
```

아래로 교체:
```typescript
import type { AttachedImage, ImageProcessingMode, PaletteName } from '@/types/detail-page';
import type { AiImageSlot } from '@/lib/detail-page/ai-html-builder';
```

- [ ] **Step 2: store에서 `aiImageSlots` 읽기**

현재 코드 (line 79-87):
```typescript
  const { sharedDraft, assetsDraft } = useListingStore();
  const sourceImages = [
    ...sharedDraft.thumbnailImages,
    ...sharedDraft.detailImages,
    ...sharedDraft.pickedDetailImages,
    ...assetsDraft.thumbnailFiles,
    ...assetsDraft.detailFiles,
    ...assetsDraft.generatedThumbnails,
  ].filter((url, idx, arr) => url && arr.indexOf(url) === idx);
```

아래로 교체:
```typescript
  const { sharedDraft, assetsDraft } = useListingStore();
  const aiImageSlots: AiImageSlot[] = assetsDraft.aiImageSlots ?? [];
  const sourceImages = [
    ...sharedDraft.thumbnailImages,
    ...sharedDraft.detailImages,
    ...sharedDraft.pickedDetailImages,
    ...assetsDraft.thumbnailFiles,
    ...assetsDraft.detailFiles,
    ...assetsDraft.generatedThumbnails,
  ].filter((url, idx, arr) => url && arr.indexOf(url) === idx);
```

- [ ] **Step 3: AI 이미지 직접 추가 핸들러 추가**

`handleRemove` 함수(line 163) 아래에 추가:

```typescript
  // AI 생성 이미지 직접 추가 — process-image 없이 원본 URL 그대로 추가
  const handleAiImageDirectAdd = (slot: AiImageSlot) => {
    setShowPicker(false);
    if (images.length >= MAX_IMAGES) return;
    onChange([...images, { url: slot.url, order: images.length, processingMode: 'original' }]);
  };
```

- [ ] **Step 4: "소스" 버튼 표시 조건 확장**

현재 코드 (line 451):
```typescript
            {sourceImages.length > 0 && (
```

아래로 교체:
```typescript
            {(sourceImages.length > 0 || aiImageSlots.length > 0) && (
```

- [ ] **Step 5: 픽커 모달에 AI 이미지 섹션 추가**

현재 이미지 그리드 영역 (line 557-591):
```typescript
            {/* 이미지 그리드 */}
            <div style={{ padding: 12, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {sourceImages.map((url) => (
```

아래로 교체 (AI 이미지 섹션을 상단에 추가):
```typescript
            {/* 이미지 그리드 */}
            <div style={{ padding: 12, overflowY: 'auto' }}>
              {/* AI 생성 이미지 섹션 */}
              {aiImageSlots.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: '#7c3aed', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                    AI 생성 이미지
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {aiImageSlots.map((slot) => (
                      <button
                        key={slot.url}
                        onClick={() => handleAiImageDirectAdd(slot)}
                        title={slot.role}
                        style={{
                          padding: 0,
                          border: '2px solid #ede9fe',
                          borderRadius: 8,
                          overflow: 'hidden',
                          cursor: 'pointer',
                          aspectRatio: '1',
                          background: '#faf5ff',
                          position: 'relative',
                          transition: 'border-color 0.15s',
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.borderColor = '#7c3aed';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.borderColor = '#ede9fe';
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={slot.url}
                          alt={slot.role}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        <div style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          background: 'rgba(124,58,237,0.75)',
                          fontSize: 9,
                          color: '#fff',
                          textAlign: 'center',
                          padding: '2px 0',
                          fontFamily: 'system-ui, sans-serif',
                          fontWeight: 600,
                        }}>
                          {slot.role === 'hero' ? '히어로' : slot.role === 'lifestyle' ? '라이프' : slot.role === 'detail' ? '디테일' : '특징'}
                        </div>
                      </button>
                    ))}
                  </div>
                  {sourceImages.length > 0 && (
                    <hr style={{ margin: '12px 0 0', border: 'none', borderTop: '1px solid #eeeeee' }} />
                  )}
                </div>
              )}

              {/* 일반 소스 이미지 그리드 */}
              {sourceImages.length > 0 && (
                <div>
                  {aiImageSlots.length > 0 && (
                    <p style={{ margin: '8px 0 6px', fontSize: 11, fontWeight: 700, color: '#888888', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
                      업로드 이미지
                    </p>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {sourceImages.map((url) => (
```

그리고 기존 `sourceImages.map` 블록의 닫는 태그들 (`</div>` 2개)을 아래와 같이 마무리:
```typescript
                    ))}
                  </div>
                </div>
              )}
            </div>
```

- [ ] **Step 6: TypeScript 컴파일 확인**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio && npx tsc --noEmit 2>&1 | head -30
```

Expected: 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add src/components/listing/detail-editor/SectionImageAttachment.tsx
git commit -m "feat: 섹션 소스 픽커에 AI 생성 이미지 섹션 추가"
```
