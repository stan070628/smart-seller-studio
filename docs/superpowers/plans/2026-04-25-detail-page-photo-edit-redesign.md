# 상세페이지 AI 편집 재설계 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 상세페이지 편집을 Case1(사진없음=원본유지)/Case2-1(사진추가AI편집)/Case2-2(사진만으로AI편집) 세 케이스로 재설계하고, AI 편집 지시문 텍스트박스를 제거한다.

**Architecture:**
- Case 1: URL HTML 자동 채움 → 그대로 사용 (현재 동작 유지)
- Case 2-1 "사진추가AI편집": 사진 분석 → 특장점 추출 → 원본 HTML에 이미지·특장점 보충 삽입
- Case 2-2 "사진만으로AI편집": 사진 분석 → 스튜디오 컨셉으로 새 HTML 생성

**Tech Stack:** Next.js App Router, Claude Sonnet, TypeScript, Zod v4, TailwindCSS

**현재 파일 위치:**
- `src/app/listing/auto-register/page.tsx` — 메인 UI
- `src/app/api/ai/generate-detail-html/route.ts` — 이미지→HTML 생성 API
- `src/lib/ai/prompts/detail-page.ts` — 상세페이지 프롬프트/타입

---

## Task 1: API + 프롬프트 업그레이드

**Files:**
- Modify: `src/lib/ai/prompts/detail-page.ts`
- Modify: `src/app/api/ai/generate-detail-html/route.ts`

### 변경 사항

#### `src/lib/ai/prompts/detail-page.ts`

기존 `DETAIL_PAGE_SYSTEM_PROMPT` 옆에 `STUDIO_DETAIL_PAGE_SYSTEM_PROMPT` 추가:

```typescript
export const STUDIO_DETAIL_PAGE_SYSTEM_PROMPT = `당신은 프리미엄 스튜디오 촬영 제품 상세페이지 전문가입니다.
깔끔한 화이트 스튜디오 컨셉으로 제품을 프리미엄하게 소개하는 상세페이지를 제작합니다.
이미지 분석 결과를 바탕으로 제품의 질감·형태·색상미·핵심 기능을 감성적으로 표현합니다.

## 출력 규칙
- 반드시 아래 JSON 구조만 출력합니다.
- 코드 블록(\`\`\`), 마크다운, 설명 텍스트를 절대 포함하지 않습니다.
- 모든 문자열은 한국어로 작성합니다.
- 글자 수 제한은 반드시 준수합니다.
- 과대광고 표현(최초, 1위, 유일, 혁명적, 기적, 압도적, 역대급) 사용 금지.
- 스튜디오 감성: 절제되고 우아한 어조, 제품 자체의 품질·미감 강조.

## JSON 스키마
{
  "headline": "string (20자 이내, 제품의 품질과 감성을 담은 문구)",
  "subheadline": "string (40자 이내, 스튜디오 촬영처럼 제품의 본질을 설명)",
  "sellingPoints": [
    {
      "icon": "string (이모지 1개)",
      "title": "string (15자 이내)",
      "description": "string (40자 이내)"
    }
  ],
  "features": [
    {
      "title": "string (상품 특징 제목)",
      "description": "string (소재·질감·구조 중심의 구체적 설명)"
    }
  ],
  "specs": [
    { "label": "string", "value": "string" }
  ],
  "usageSteps": ["string"],
  "warnings": ["string"],
  "ctaText": "string (20자 이내)"
}

## 수량 제약
- sellingPoints: 정확히 3개
- features: 3개 이상 5개 이하
- specs: 2개 이상 6개 이하
- usageSteps: 2개 이상 4개 이하
- warnings: 2개 이상 3개 이하`;
```

#### `src/app/api/ai/generate-detail-html/route.ts`

**1) RequestSchema에 `studioMode` 추가:**
```typescript
studioMode: z.boolean().optional(),
```

**2) 구조분해에 추가:**
```typescript
const { images: rawImages, imageUrls, productName, existingHtml, studioMode } = parseResult.data;
```

**3) 보충 모드(existingHtml 있을 때) 개선 — 이미지 분석 추가:**

현재 보충 모드는 이미지 분석 없이 바로 삽입 프롬프트를 만든다.
이미지 업로드 직후, 보충 모드에서 `analyzeImages(images)`를 먼저 호출하고 특장점을 프롬프트에 포함시킨다.

```typescript
if (existingHtml) {
  // 1. 이미지 분석 (analyzeImages 재사용)
  let imageAnalysis: ProductImageAnalysis | null = null;
  try {
    imageAnalysis = await analyzeImages(images);
  } catch {
    // 분석 실패 시 이미지만 삽입 (graceful degradation)
  }

  const publicUrls = imagesWithUrls
    .map((img) => ('publicUrl' in img ? img.publicUrl : undefined))
    .filter((u): u is string => Boolean(u));

  const imgTagList = publicUrls
    .map((u) => `<div style="width:100%;padding:4px 0;"><img src="${u}" alt="상품 이미지" style="width:100%;display:block;" /></div>`)
    .join('\n');

  const featuresText = imageAnalysis
    ? `\n[AI 분석 특장점]\n소재: ${imageAnalysis.material}\n형태: ${imageAnalysis.shape}\n색상: ${imageAnalysis.colors.join(', ')}\n핵심 구성: ${imageAnalysis.keyComponents.join(', ')}`
    : '';

  const supplementUserPrompt =
    `아래 기존 상세페이지 HTML에 다음 이미지들과 추출된 특장점을 적절한 위치에 삽입하여 보충해주세요.\n` +
    `기존 텍스트·이미지·구조는 절대 삭제하거나 변경하지 마세요.\n` +
    (productName ? `상품명: ${productName}\n` : '') +
    featuresText +
    `\n\n[삽입할 이미지 태그]\n${imgTagList}\n\n` +
    `[기존 HTML]\n${existingHtml.slice(0, 30_000)}`;

  // ... Claude 호출 (기존 코드와 동일)
}
```

**4) 신규 생성 모드(existingHtml 없을 때) — studioMode 분기:**

```typescript
// 기존:
const copyResponse = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 2048,
  system: DETAIL_PAGE_SYSTEM_PROMPT,
  ...
});

// 변경 후:
const copyResponse = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 2048,
  system: studioMode ? STUDIO_DETAIL_PAGE_SYSTEM_PROMPT : DETAIL_PAGE_SYSTEM_PROMPT,
  ...
});
```

**import 추가:**
```typescript
import {
  DETAIL_PAGE_SYSTEM_PROMPT,
  STUDIO_DETAIL_PAGE_SYSTEM_PROMPT,  // 추가
  buildDetailPageUserPrompt,
  parseDetailPageResponse,
  type ProductImageAnalysis,
} from "@/lib/ai/prompts/detail-page";
```

- [ ] `STUDIO_DETAIL_PAGE_SYSTEM_PROMPT` 추가 (`detail-page.ts`)
- [ ] `RequestSchema`에 `studioMode?: boolean` 추가
- [ ] 구조분해에 `studioMode` 추가
- [ ] 보충 모드에서 `analyzeImages` 호출 후 특장점 포함
- [ ] 신규 생성 모드에서 `studioMode`에 따라 프롬프트 분기
- [ ] TypeScript 오류 없는지 확인

---

## Task 2: page.tsx UI 재설계

**Files:**
- Modify: `src/app/listing/auto-register/page.tsx`

### 제거할 상태 (useState)
- `detailEditInstruction` (line 118)
- `isEditingDetailImg` (line 119)
- `detailEditingSlot` (line 120)
- `detailImgEditError` (line 121)
- `isEditingDetailHtml` (line 122)
- `detailSuggestedPrompts` (line 125)
- `isGeneratingDetailPrompts` (line 126)

### 유지할 상태
- `detailImages`, `detailHtmlEditError`, `isGeneratingHtmlFromImages`

### 추가할 상태
- `isSupplementingWithPhotos` (boolean) — Case 2-1 로딩 구분용

### 제거할 함수
- `handleDetailImgAiEditAll` (line 707~735)
- `handleGenerateDetailPrompts` (line 737~765)
- `handleDetailHtmlEdit` (line 767~793)
- `handleDetailHtmlRegenerate` (line 795~799)
- `handleDetailImgAiEdit` (line 849~...)

### 변경할 함수
기존 `handleGenerateHtmlFromImages`를 두 함수로 분리:

```typescript
// Case 2-1: 사진추가AI편집
async function handleSupplementWithPhotos() {
  if (detailImages.length === 0 || !detailHtml) return;
  setIsSupplementingWithPhotos(true);
  setDetailHtmlEditError('');
  const { images, imageUrls } = buildImagePayload(detailImages);
  try {
    const res = await fetch('/api/ai/generate-detail-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(images.length > 0 ? { images } : {}),
        ...(imageUrls.length > 0 ? { imageUrls } : {}),
        productName: name,
        existingHtml: detailHtml,
      }),
    });
    const data = (await res.json()) as { success: boolean; html?: string; error?: string };
    if (res.ok && data.success && data.html) {
      setDetailHtml(data.html);
    } else {
      setDetailHtmlEditError(data.error ?? `서버 오류 (HTTP ${res.status})`);
    }
  } catch {
    setDetailHtmlEditError('HTML 보충 중 오류가 발생했습니다.');
  } finally {
    setIsSupplementingWithPhotos(false);
  }
}

// Case 2-2: 사진만으로AI편집
async function handleGenerateFromPhotos() {
  if (detailImages.length === 0) return;
  setIsGeneratingHtmlFromImages(true);
  setDetailHtmlEditError('');
  const { images, imageUrls } = buildImagePayload(detailImages);
  try {
    const res = await fetch('/api/ai/generate-detail-html', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(images.length > 0 ? { images } : {}),
        ...(imageUrls.length > 0 ? { imageUrls } : {}),
        productName: name,
        studioMode: true,
      }),
    });
    const data = (await res.json()) as { success: boolean; html?: string; error?: string };
    if (res.ok && data.success && data.html) {
      setDetailHtml(data.html);
    } else {
      setDetailHtmlEditError(data.error ?? `서버 오류 (HTTP ${res.status})`);
    }
  } catch {
    setDetailHtmlEditError('HTML 생성 중 오류가 발생했습니다.');
  } finally {
    setIsGeneratingHtmlFromImages(false);
  }
}

// 공통 헬퍼
function buildImagePayload(detailImages: string[]) {
  const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
  const images: { imageBase64: string; mimeType: string }[] = [];
  const imageUrls: string[] = [];
  for (const img of detailImages) {
    if (img.startsWith('data:')) {
      const commaIdx = img.indexOf(',');
      const rawMime = img.slice(5, commaIdx).split(';')[0] ?? 'image/jpeg';
      const mimeType = (ALLOWED_MIME as readonly string[]).includes(rawMime) ? rawMime : 'image/jpeg';
      images.push({ imageBase64: img.slice(commaIdx + 1), mimeType });
    } else {
      imageUrls.push(img);
    }
  }
  return { images, imageUrls };
}
```

### 새 UI 구조 (섹션 4: 상세페이지)

**Case 구분을 `detailHtml` 여부가 아닌 단일 블록으로 통합:**

```jsx
{/* 섹션 4: 상세페이지 */}
<div className={SECTION}>
  <h3 className="font-semibold text-gray-900">상세페이지</h3>

  {/* HTML 에디터 — detailHtml 있을 때만 표시 */}
  {detailHtml && (
    <>
      <div className="flex items-center justify-between">
        <div className="flex rounded-lg overflow-hidden border border-gray-200 text-xs">
          <button onClick={() => setIsPreview(true)} ...>미리보기</button>
          <button onClick={() => setIsPreview(false)} ...>HTML 편집</button>
        </div>
        <button onClick={() => { setDetailHtml(''); setDetailImages([]); }} className="text-xs text-gray-400 hover:text-gray-600">
          초기화
        </button>
      </div>
      {isPreview ? (
        <div dangerouslySetInnerHTML={{ __html: safeHtml }} ... />
      ) : (
        <textarea value={detailHtml} onChange={(e) => setDetailHtml(e.target.value)} ... />
      )}
    </>
  )}

  {/* 사진 첨부 영역 — 항상 표시 */}
  <div className="flex items-center justify-between">
    <span className="text-sm font-medium text-gray-700">상세 이미지 첨부</span>
    <button onClick={() => triggerDetailFileUpload(detailImages.length)} ...>+ 추가</button>
  </div>

  {detailImages.length > 0 ? (
    /* 이미지 썸네일 목록 */
    <div ...>
      {detailImages.map((url, idx) => (
        <div key={idx} ...>
          <img src={url} ... onClick={() => triggerDetailFileUpload(idx)} />
          <span>이미지 {idx + 1}</span>
          <button onClick={() => removeDetailImage(idx)}>✕</button>
        </div>
      ))}

      {/* 액션 버튼 — 사진 있을 때만 */}
      <div className="flex flex-col gap-2 pt-2">
        {/* Case 2-1: detailHtml 있을 때만 */}
        {detailHtml && (
          <button
            onClick={handleSupplementWithPhotos}
            disabled={isSupplementingWithPhotos || isGeneratingHtmlFromImages}
            className="w-full py-2.5 bg-purple-600 text-white rounded-lg text-sm ..."
          >
            {isSupplementingWithPhotos ? '보충 중...' : '사진추가AI편집'}
          </button>
        )}
        {/* Case 2-2: 항상 */}
        <button
          onClick={handleGenerateFromPhotos}
          disabled={isGeneratingHtmlFromImages || isSupplementingWithPhotos}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm ..."
        >
          {isGeneratingHtmlFromImages ? 'AI 편집 중...' : '사진만으로AI편집'}
        </button>
      </div>
    </div>
  ) : (
    /* 드래그앤드롭 업로드 영역 */
    <div onClick={() => triggerDetailFileUpload(0)} onDrop={...} ...>
      <p>클릭하거나 드래그해서 상세 이미지 추가 (최대 5장)</p>
    </div>
  )}

  {detailHtmlEditError && <p className="text-xs text-red-500">{detailHtmlEditError}</p>}

  <input ref={detailFileInputRef} type="file" accept="image/*" className="hidden" onChange={handleDetailFileChange} />
</div>
```

### 초기화 버튼 onClick 수정
기존: `setDetailSuggestedPrompts([]); setDetailEditInstruction('');` 포함
변경: 제거된 상태 참조 삭제

- [ ] 제거할 상태 7개 삭제
- [ ] `isSupplementingWithPhotos` 상태 추가
- [ ] 제거할 함수 5개 삭제
- [ ] `buildImagePayload` 헬퍼 추가
- [ ] `handleSupplementWithPhotos` 추가 (Case 2-1)
- [ ] `handleGenerateFromPhotos` 추가 (Case 2-2)
- [ ] 기존 `handleGenerateHtmlFromImages` 삭제
- [ ] 섹션 4 UI 전체 교체 (두 케이스 → 단일 통합 블록)
- [ ] 삭제된 상태 참조 정리 (초기화 버튼, save draft 등)
- [ ] TypeScript 오류 없는지 확인
