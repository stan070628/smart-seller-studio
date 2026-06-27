# Image Grid 씬 변환 설계

## 배경

`image_grid` 섹션이 현재 `attachedImages`의 원본 이미지를 그대로 노출해 지재권 문제 소지가 있음.
변환 방향: OCR로 원본 이미지의 핵심 내용 추출 → Gemini 배경 이미지 1장 생성 → 배경 위에 텍스트 오버레이 HTML.

---

## 변환 파이프라인

```
image_grid 씬 생성 트리거
  → POST /api/ai/generate-image-grid-scene
      ① Claude: attachedImages OCR → points: string[] 추출
      ② Gemini: section.title 기반 배경 이미지 1장 생성
  → 응답: { backgroundImageBase64, mimeType, points }
  → 업로드: /api/image/upload-ai → URL
  → section.attachedImages = [{ url, order: 0 }]  (배경 이미지)
  → section.content.points = [...] (OCR 추출 포인트)
  → renderImageGrid(): 배경 위 Point 스타일 오버레이 HTML
```

---

## 렌더링 레이아웃 (Point 스타일)

```
┌──────────────────────────────────┐
│   [Gemini 배경 이미지 fullbleed]  │
│                                  │
│   제품 특징                      │  ← section.content.title
│   • 추출된 포인트 1              │
│   • 추출된 포인트 2              │
│   • 추출된 포인트 3              │
│                                  │
└──────────────────────────────────┘
```

텍스트 영역은 배경 이미지 하단 30%에 반투명 그라디언트 위에 오버레이.

---

## 변경 범위

| 파일 | 작업 |
|------|------|
| `src/app/api/ai/generate-image-grid-scene/route.ts` | 신규 — Claude OCR + Gemini 배경 생성 |
| `src/types/detail-page.ts` | `ImageGridContent`에 `points?: string[]` 추가 |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | `generateSceneImages()` targets에 `image_grid` 추가 |
| `src/lib/detail-page/section-renderer.ts` | `renderImageGrid()` 오버레이 HTML로 교체 |

---

## 상세 설계

### 1. `src/app/api/ai/generate-image-grid-scene/route.ts` (신규)

**요청 스키마:**
```typescript
const RequestSchema = z.object({
  imageUrls: z.array(z.string().url()).min(1).max(6),  // attachedImages URL
  title: z.string(),                                    // section.content.title
});
```

**Step 1 — Claude OCR (각 이미지에서 핵심 포인트 추출):**
```typescript
const ocrRes = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 400,
  system: `You are a product detail page analyst.
Extract the key selling points or product information visible in the image(s).
Return JSON: { "points": ["point1", "point2", ...] }
- Extract 3-6 concise Korean or English bullet points
- Focus on product features, specifications, or benefits visible in the image
- If no readable text: infer key features from the visual content
- Each point: max 25 characters`,
  messages: [{
    role: 'user',
    content: [
      ...imageUrls.map(url => ({
        type: 'image' as const,
        source: { type: 'url' as const, url },
      })),
      { type: 'text', text: `Section title: "${title}". Extract key points.` },
    ],
  }],
});
```

**Step 2 — Gemini 배경 이미지 생성:**
```typescript
// generateFrameImage() 재사용 (referenceImages 없이 — 배경만 생성)
const bgPrompt = `Clean, professional e-commerce product detail background for "${title}". 
Subtle, elegant lifestyle setting — soft gradient, minimal props, neutral tones. 
No text, no products, no people. High-end commercial photography backdrop.
SINGLE FRAME ONLY.`;

const imageResult = await generateFrameImage({ imagePrompt: bgPrompt });
```

**응답:**
```typescript
return NextResponse.json({
  success: true,
  data: {
    imageBase64: imageResult.imageBase64,
    mimeType: imageResult.mimeType,
    points,  // string[]
  },
});
```

**maxDuration:** 60 (Claude + Gemini 직렬 처리)
**Rate limit:** 분당 4회

---

### 2. `src/types/detail-page.ts` — `ImageGridContent` 확장

```typescript
export interface ImageGridContent {
  type: 'image_grid';
  title: string;
  items: Array<{ label: string; swatchColor?: string }>;
  points?: string[];  // 신규: Claude OCR 추출 포인트 (있으면 오버레이 렌더링)
}
```

---

### 3. `DetailMakerClient.tsx` — `generateSceneImages()` 확장

**targets 변경 (line 278):**
```typescript
// 변경 전
const targets = sectionsSnapshot.filter(s => s.type === 'hero' || s.type === 'point');

// 변경 후
const targets = sectionsSnapshot.filter(
  s => s.type === 'hero' || s.type === 'point' || s.type === 'image_grid'
);
```

**image_grid 분기 추가 (line 310 이후, hero/cleanup/AI 분기 전에 삽입):**
```typescript
if (section.type === 'image_grid') {
  // attachedImages에서 URL 추출
  const gridImageUrls = section.attachedImages.map(img => img.url).filter(Boolean);
  if (gridImageUrls.length === 0) return null;

  const title = (section.content as ImageGridContent).title;
  const gridRes = await fetch('/api/ai/generate-image-grid-scene', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrls: gridImageUrls, title }),
  });
  if (!gridRes.ok) return null;

  const gridData = await gridRes.json() as {
    success: boolean;
    data?: { imageBase64: string; mimeType: string; points: string[] };
  };
  if (!gridData.success || !gridData.data) return null;

  imageBase64 = gridData.data.imageBase64;
  mimeType = gridData.data.mimeType;

  // points를 content에 반영 (setSections에서 처리)
  extractedPoints = gridData.data.points;
}
```

**setSections 결과 반영 수정:**
```typescript
// urlUpdates 타입 확장
type UrlUpdate = {
  sectionId: string;
  url: string;
  sceneId: string | undefined;
  points?: string[];  // image_grid용
};

// content 업데이트 시 points 반영
const newContent =
  isImageGridContent(s.content) && hit.points
    ? { ...s.content, points: hit.points }
    : isPointContent(s.content) && matchedScene?.textPosition
      ? { ...s.content, textPosition: matchedScene.textPosition }
      : s.content;
```

---

### 4. `section-renderer.ts` — `renderImageGrid()` 오버레이 HTML

**변경 전:** `attachedImages[i]`를 그리드로 나열
**변경 후:** `attachedImages[0]` 배경 + `content.points` 오버레이 (points 없으면 기존 렌더링 유지)

```typescript
function renderImageGrid(content: ImageGridContent, section: DetailSection, colors: PaletteColors): string {
  // points가 있으면 새 오버레이 렌더링
  if (content.points && content.points.length > 0) {
    const bgUrl = section.attachedImages[0]?.url ?? '';
    const safeUrl = bgUrl ? sanitizeUrl(bgUrl) : '';
    const title = content.title;
    const bullets = content.points
      .map(p => `<li style="margin-bottom:6px;font-size:14px;line-height:1.4;">${p}</li>`)
      .join('');

    return `
<div style="position:relative;width:100%;aspect-ratio:3/4;overflow:hidden;">
  ${safeUrl ? `<img src="${safeUrl}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" />` : ''}
  <div style="
    position:absolute;bottom:0;left:0;right:0;
    background:linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%);
    padding:24px 20px 20px;
    color:#fff;
  ">
    ${title ? `<p style="margin:0 0 10px;font-size:18px;font-weight:700;letter-spacing:-0.3px;">${title}</p>` : ''}
    <ul style="margin:0;padding-left:16px;">
      ${bullets}
    </ul>
  </div>
</div>`;
  }

  // fallback: 기존 그리드 렌더링 (points 없는 경우)
  // ... 기존 코드 유지
}
```

---

## 실패 시나리오

| 시나리오 | 처리 |
|----------|------|
| `imageUrls` 비어있음 | 400 반환, 클라이언트 skip |
| Claude OCR 실패 | `points: []` — 배경 이미지만 생성, 오버레이 텍스트 없음 |
| Gemini 배경 생성 실패 | 500 반환, 클라이언트 skip (원본 유지) |
| `points` 없는 경우 | `renderImageGrid()` 기존 그리드 렌더링 fallback |

---

## 범위 외

- image_grid 스토리보드 지원 (현재 image_grid는 storyboard 대상이 아님)
- OCR 캐싱 (동일 이미지 재처리 시)
- 오버레이 색상/위치 사용자 커스터마이징
