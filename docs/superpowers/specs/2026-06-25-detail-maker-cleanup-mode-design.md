# Detail Maker 씬 이미지 클린업 모드 (한자 제거)

**날짜:** 2026-06-25
**상태:** 확정

---

## 목적

1688 상품 이미지의 한자·워터마크를 Gemini가 제거하고, 원본 제품은 그대로 보존해 씬 슬롯에 삽입한다. 스토리라인 편집 단계(Spec A)에서 씬별로 "AI 생성" / "클린업" 모드를 선택할 수 있다.

---

## UX 흐름

```
StoryboardEditor (Spec A) 내 씬 카드
  → 우측 상단 뱃지: ⚡ AI (보라) ↔ ✨ 클린업 (초록) 클릭으로 토글

"② 씬 이미지 생성" 실행 시:
  - mode === 'ai'    → 기존 generate-scene-image (Gemini 씬 생성)
  - mode === 'cleanup' → cleanup-product-image (한자 제거 후 원본 이미지 반환)

클린업 완료 씬:
  - 씬 카드에 원본+클린업 이미지 표시
  - "다시 클린업" 버튼 (재실행)
  - "AI로 전환" 버튼 (모드 변경 후 AI 재생성)
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
1. imageUrl fetch → ArrayBuffer → base64 변환
2. Gemini 2.5 Flash (gemini-2.5-flash-image) 에 전송
3. 결과 base64 반환

**Response:**
```ts
{
  imageBase64: string;
  mimeType: string;
}
```

**에러 응답:** `{ error: string }` (HTTP 4xx/5xx)

**Gemini 프롬프트:**
```
Remove all Chinese characters, Chinese text, watermarks, brand logos, price tags, promotional text, and any text overlays from this product image.

CRITICAL CONSTRAINTS:
- Do NOT alter the product itself in any way — preserve the exact shape, color, texture, material, and all visual details of the product
- Fill removed text/watermark areas by blending naturally with the surrounding background
- The output must be a single clean product photograph

Output: one clean product image with all text and overlays removed.
```

**인프라 재활용:** `getGeminiGenAI()` + 기존 `gemini-2.5-flash-image` 모델 사용. `generateFrameImage`와 동일한 클라이언트 패턴.

**Rate limit:** `cleanup-product-image` 별도 키, 분당 6회.

---

### `SceneStoryboardItem.mode` 연계 (Spec A)

`StoryboardEditor.tsx` 씬 카드에 뱃지 추가:

```tsx
// 씬 카드 내
<button
  onClick={() => onModeToggle(scene.id)}
  className={scene.mode === 'ai' ? 'badge-ai' : 'badge-cleanup'}
>
  {scene.mode === 'ai' ? '⚡ AI' : '✨ 클린업'}
</button>
```

뱃지 클릭 → `onScenesChange`로 해당 씬의 `mode` 토글. 클린업 모드 씬은 prompt textarea를 숨기고 "소스 이미지 선택"만 표시.

---

### `generateSceneImages` 분기 (Spec A 수정)

```ts
for (const [i, scene] of storyboard.entries()) {
  if (scene.mode === 'cleanup') {
    const sourceUrl = uploadedUrls[scene.sourceImageIndex] ?? uploadedUrls[0];
    const res = await fetch('/api/ai/cleanup-product-image', {
      method: 'POST',
      body: JSON.stringify({ imageUrl: sourceUrl }),
    });
    const data = await res.json();
    // data.imageBase64 → POST /api/image/upload-ai → 영구 URL
    // sections[i].attachedImages 업데이트
  } else {
    // 기존 generate-scene-image 호출
  }
}
```

---

## 엣지케이스

| 케이스 | 처리 |
|---|---|
| imageUrl fetch 실패 | 명시적 에러 반환, 씬 슬롯에 에러 표시 |
| Gemini가 제품 형태 변경 | 사용자에게 "결과 확인 후 재시도 또는 AI 전환" 안내 (자동 감지 없음) |
| 클린업 결과가 blank 이미지 | 응답 base64 길이 체크 → 너무 짧으면 에러 처리 |
| 소스 이미지 없음 | uploadedUrls가 비어 있으면 클린업 모드 선택 불가 (뱃지 비활성화) |

---

## 테스트

- `cleanup-product-image` route: imageUrl 정상 → base64 반환, imageUrl fetch 실패 → 에러
- `StoryboardEditor`: 모드 뱃지 클릭 → mode 토글, 클린업 모드 씬에서 prompt 숨김
- `generateSceneImages` 통합: cleanup 모드 씬은 cleanup API 호출, ai 모드는 기존 흐름

---

## 변경 파일 요약

| 파일 | 종류 |
|---|---|
| `src/app/api/ai/cleanup-product-image/route.ts` | 신규 |
| `src/components/listing/detail-maker/StoryboardEditor.tsx` | 수정 (뱃지 토글, Spec A 컴포넌트) |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | 수정 (generateSceneImages 분기) |

> **의존:** Spec A (스토리라인 편집) 완료 후 구현. `SceneStoryboardItem` 타입과 `StoryboardEditor` 컴포넌트를 공유한다.
