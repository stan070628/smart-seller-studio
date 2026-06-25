# Detail Maker 씬 이미지 클린업 모드 (한자 제거)

**날짜:** 2026-06-25
**상태:** 확정

---

## 목적

1688 상품 이미지의 한자·워터마크를 Gemini가 제거하고, 원본 제품은 그대로 보존해 씬 슬롯에 삽입한다. 스토리라인 편집 단계(Spec A)에서 씬별로 "AI 생성" / "클린업" 모드를 선택할 수 있다.

**구현 전제:** Spec A(스토리라인 편집) 완료 후 구현. `SceneStoryboardItem` 타입과 `StoryboardEditor`를 공유한다.

---

## 리스크 — Gemini inpainting 실험 선행 필수

`gemini-2.5-flash-image`는 이미지 생성 특화 모델로, 참조 이미지를 완전히 새로 그리는 방식이다. 한자 제거는 원본 픽셀을 유지하면서 특정 영역만 수정하는 inpainting 작업이므로 **결과 품질은 실험으로 먼저 확인해야 한다.**

MVP 권장 순서:
1. `cleanup-product-image` API 구현 후 실제 1688 이미지로 테스트
2. 제품 왜곡 없이 한자만 제거되는지 확인
3. 품질 미달 시 대안 검토:
   - Claude Vision OCR → Sharp inpainting (텍스트 BBox만 blur)
   - Remove.bg 등 배경 제거 후 흰 배경에 재합성

---

## UX 흐름

```
StoryboardEditor (Spec A) 내 씬 카드
  → 우측 상단 뱃지: ⚡ AI (보라) ↔ ✨ 클린업 (초록) 클릭으로 토글
  → 클린업 모드: prompt textarea 숨김, 소스 이미지 선택만 표시

"② 씬 이미지 생성" 실행 시 (generateSceneImages 내부):
  - mode === 'ai'      → 기존 generate-scene-image (Gemini 씬 생성)
  - mode === 'cleanup' → cleanup-product-image (한자 제거 후 원본 이미지 반환)
  두 모드 모두 Promise.allSettled로 병렬 실행

클린업 완료 씬:
  - 씬 카드에 결과 이미지 표시 (기존 ai 씬 카드와 동일 구조)
  - "다시 클린업" 버튼 (재실행)
  - "AI로 전환" 버튼 (mode='ai'로 전환 후 재생성)
```

---

## 아키텍처

### 신규 API — `POST /api/ai/cleanup-product-image`

**Request:**
```ts
{
  imageUrl: string;    // 클린업할 소스 이미지 URL
}
```

**Process:**
1. `imageUrl` allowlist 검증 (Supabase Storage 도메인만 허용 — 기존 `generate-scene-image` route의 URL 검증 패턴 동일하게 적용, SSRF 방어)
2. imageUrl fetch → ArrayBuffer → base64 변환
3. Gemini 2.5 Flash image 모델에 전송 (아래 프롬프트)
4. 결과 base64 반환

**Response:**
```ts
{ imageBase64: string; mimeType: string; }
// 에러: { error: string }
```

**Gemini 호출:** `generateFrameImage`를 재사용하지 않고 직접 호출.
이유: `generateFrameImage`는 내부에서 `singleFrameConstraint` suffix를 자동으로 추가하는데, 클린업 프롬프트에 "SINGLE FRAME ONLY" 중복 지시가 붙어 모델 혼란 가능. 별도 경량 래퍼로 구현:

```ts
async function callGeminiForCleanup(imageBase64: string, mimeType: string): Promise<{ imageBase64: string; mimeType: string }> {
  const ai = getGeminiGenAI();
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    config: { responseModalities: ['IMAGE', 'TEXT'] },
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { data: imageBase64, mimeType } },
        { text: CLEANUP_PROMPT },
      ],
    }],
  });
  // base64 추출 (기존 generateFrameImage 패턴 동일)
}
```

**CLEANUP_PROMPT:**
```
Remove all Chinese characters, Chinese text, watermarks, brand logos, price tags, promotional text, and any text overlays from this product image.

CRITICAL CONSTRAINTS:
- Do NOT alter the product itself in any way — preserve the exact shape, color, texture, material, and all visual details of the product
- Fill removed text/watermark areas by blending naturally with the surrounding background
- Output a single clean product photograph with all text and overlays removed
```

**Rate limit:** `cleanup-product-image` 별도 키, 분당 6회.

---

### `generateSceneImages` 분기 (Spec A 연계)

```ts
// generateSceneImages 내부 — 기존 Promise.allSettled 패턴 유지
const scenePromises = sectionsSnapshot.map((section, i) => {
  const scene = storyboard?.[i];
  if (scene?.mode === 'cleanup') {
    const sourceUrl = uploadedUrls[scene.sourceImageIndex] ?? uploadedUrls[0];
    return fetch('/api/ai/cleanup-product-image', {
      method: 'POST',
      body: JSON.stringify({ imageUrl: sourceUrl }),
    })
      .then(r => r.json())
      .then(async (data) => {
        if (data.error) throw new Error(data.error);
        // imageBase64 → POST /api/image/upload-ai → 영구 URL
        // section.attachedImages 업데이트 (기존 ai 씬 결과 처리와 동일 패턴)
        // genId 체크로 stale 응답 폐기 (sceneGenIdRef 패턴 유지)
      });
  }
  // 기존 generate-scene-image 호출
  return generateSingleSceneImage(section, scene, uploadedUrls, genId, currentTheme);
});

await Promise.allSettled(scenePromises);
```

---

### `StoryboardEditor.tsx` 뱃지 추가 (Spec A 컴포넌트 수정)

```tsx
<button
  onClick={() => {
    const updated = scenes.map(s =>
      s.id === scene.id
        ? { ...s, mode: s.mode === 'ai' ? 'cleanup' : 'ai' as const }
        : s
    );
    onScenesChange(updated);
  }}
  disabled={uploadedUrls.length === 0}  // 소스 이미지 없으면 클린업 불가
  className={scene.mode === 'ai' ? 'badge-ai' : 'badge-cleanup'}
>
  {scene.mode === 'ai' ? '⚡ AI' : '✨ 클린업'}
</button>

{/* 클린업 모드: prompt textarea 숨김 */}
{scene.mode === 'ai' && (
  <textarea value={scene.prompt} onChange={...} />
)}
```

---

## 엣지케이스

| 케이스 | 처리 |
|---|---|
| SSRF — 외부 URL | allowlist 검증 → 403 에러 |
| imageUrl fetch 실패 | 명시적 에러 반환, 씬 슬롯에 에러 표시 |
| Gemini가 제품 형태 변경 | 사용자에게 결과 확인 후 "다시 클린업" 또는 "AI로 전환" 안내 (자동 품질 감지 없음) |
| 응답 base64가 비어 있음 | 길이 체크 → 에러 처리 |
| 소스 이미지 없음 | 뱃지 비활성화 (uploadedUrls.length === 0) |
| 클린업·AI 씬 혼합 | 모두 Promise.allSettled 병렬 처리 — 순서 무관 |

---

## 테스트

- `cleanup-product-image` route: 정상 imageUrl → base64 반환, SSRF URL → 403, fetch 실패 → 에러
- `StoryboardEditor`: 뱃지 클릭 → mode 토글, 클린업 모드에서 prompt textarea 숨김, uploadedUrls=[] → 뱃지 disabled
- `generateSceneImages` 통합: cleanup 씬 → cleanup API, ai 씬 → generate-scene-image, 혼합 병렬 처리

---

## 변경 파일 요약

| 파일 | 종류 |
|---|---|
| `src/app/api/ai/cleanup-product-image/route.ts` | 신규 |
| `src/components/listing/detail-maker/StoryboardEditor.tsx` | 수정 (Spec A 컴포넌트에 뱃지 추가) |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | 수정 (generateSceneImages 분기) |
