# 이미지 영역 선택 한자 제거 기능

**날짜:** 2026-06-27
**상태:** 확정

---

## 목적

1688 상품 이미지에서 한자·워터마크가 있는 영역을 사용자가 드래그로 선택하면, 해당 영역만 Gemini로 정리하고 나머지 원본을 보존한다. Detail Maker 입력 패널과 썸네일 탭 모두에서 사용 가능한 공용 모달로 구현한다.

---

## UX 흐름

```
[이미지 그리드 썸네일]
  → 각 이미지에 "한자 제거" 아이콘 버튼

[ImageCleanupModal — select 단계]
  → 이미지 전체 표시 (max 560px 너비, 종횡비 유지)
  → 마우스 드래그로 점선 사각형 선택
  → 힌트: "한자 주변을 대략 감싸세요. 주변 한자까지 자동 커버됩니다"
  → 선택 완료 후 "제거 실행" 버튼 활성화

[ImageCleanupModal — processing 단계]
  → 로딩 스피너 + "한자 제거 중…"

[ImageCleanupModal — preview 단계]
  → 원본 ↔ 정리된 버전 나란히 표시
  → 경고 힌트: "결과가 어색하면 박스를 한자에 더 밀착시켜 다시 실행해보세요"
  → 버튼 3개: [교체] [새로 추가] [다시 실행]
  → [교체] 클릭 → upload-ai 호출 → uploadedUrls[idx] 교체
  → [새로 추가] 클릭 → upload-ai 호출 → uploadedUrls 끝에 추가 (10장 상한 확인)
  → [다시 실행] → select 단계로 리셋
```

**교체 후 안내:** "원본 이미지가 교체되었습니다. 이미 생성한 씬 이미지는 별도로 다시 생성해야 반영됩니다."

---

## 파일 구조

| 파일 | 종류 | 역할 |
|---|---|---|
| `src/app/api/ai/cleanup-image-region/route.ts` | 신규 | 영역 크롭 → Gemini → 합성 → base64 반환 |
| `src/components/common/ImageCleanupModal.tsx` | 신규 | 드래그 선택 + 미리보기 공용 모달 |
| `src/components/listing/detail-maker/DetailMakerInputPanel.tsx` | 수정 | 이미지 그리드에 "한자 제거" 버튼 추가 |
| `src/components/listing/detail-maker/DetailMakerThumbnailPanel.tsx` | 수정 | 썸네일 참조 이미지에 동일 적용 |
| `src/app/listing/detail-maker/DetailMakerClient.tsx` | 수정 | handleReplaceImage / handleAddImage 콜백 |

---

## API — `POST /api/ai/cleanup-image-region`

### Request

```ts
{
  imageUrl: string,     // Supabase Storage URL만 허용
  region: {
    x: number,          // 정규화 비율 0~1 (이미지 너비 대비)
    y: number,          // 정규화 비율 0~1 (이미지 높이 대비)
    width: number,      // 정규화 비율 0~1
    height: number,     // 정규화 비율 0~1
  }
}
```

**좌표는 픽셀이 아니라 0~1 비율로 전송한다.** 서버에서 EXIF orientation 처리 후 실제 픽셀로 변환하기 때문에 클라이언트가 픽셀을 직접 계산하면 회전된 이미지에서 좌표가 어긋난다.

### Response

```ts
// 성공
{ imageBase64: string, mimeType: string }

// 실패
{ error: string }
```

미리보기 단계에서는 base64를 그대로 반환한다. [교체] / [새로 추가] 확정 시 클라이언트가 `/api/image/upload-ai`를 호출한다. 서버에서 미리 업로드하지 않으므로 "다시 실행" 시 고아 파일이 생기지 않는다.

### 서버 처리 파이프라인

```
1. 검증
   - SSRF: Supabase Storage URL 패턴 확인
   - region: 모든 값 0~1 범위, width/height > 0.01 (서버에서 재검증)

2. 이미지 로드 + EXIF 회전
   const img = sharp(await fetch(imageUrl).then(r => r.arrayBuffer()))
   const rotated = img.rotate()        // EXIF orientation 자동 적용
   const { width: W, height: H } = await rotated.metadata()

3. 정규화 좌표 → 픽셀 변환 + 패딩 추가
   const px = { x: region.x * W, y: region.y * H,
                 w: region.width * W, h: region.height * H }
   const pad = Math.max(40, Math.round(Math.min(px.w, px.h) * 0.35))

   // 이미지 경계 clamp (패딩이 비대칭으로 잘릴 수 있음)
   const cx = Math.max(0, Math.floor(px.x - pad))
   const cy = Math.max(0, Math.floor(px.y - pad))
   const cw = Math.min(W - cx, Math.ceil(px.w + pad * 2))
   const ch = Math.min(H - cy, Math.ceil(px.h + pad * 2))

   // clamp 후 실제 좌상단 좌표를 합성 시 재사용
   const compositeLeft = cx
   const compositeTop  = cy

4. Gemini 호출
   model: 'gemini-2.5-flash-preview-05-20'
   responseModalities: ['Image', 'Text']
   프롬프트:
     "Remove all Chinese text, watermarks, and price tags in the CENTRAL area
      of this image crop. DO NOT modify the outer border region — keep its
      colors and textures identical to the input. Fill removed areas by
      blending with the surrounding background."

   - Gemini AbortSignal: 70초 (maxDuration 90초보다 먼저 끊어 깔끔한 에러 반환)
   - Gemini 출력을 크롭 크기(cw × ch)로 resize (모델이 해상도를 바꿔 반환할 수 있음)

5. 톤매칭 (채널별 밝기 보정)
   - 비교 대상: 크롭 경계 링(ring) 영역만 (중앙 제외)
     - "경계 링" = 크롭 전체 stats - 내부(pad 안쪽) stats
     - 간이 근사: 원본 크롭 평균과 Gemini 크롭 평균의 차이를 offset으로 보정
   - Sharp linear([1,1,1], [offsetR, offsetG, offsetB])로 Gemini 출력에 적용
   - DPR 보정 없음 (stats는 실제 픽셀 기준)

6. 알파 페더링 합성
   // (a) Gemini 출력에 알파 채널 추가 (JPEG는 알파 없음)
   const patch = await sharp(geminiResized).ensureAlpha().toBuffer()

   // (b) 페더링 마스크 생성
   //     마스크 사각형은 패딩 안쪽에 그림 → blur가 패딩 영역에서 흡수됨
   const innerX = pad / 2, innerY = pad / 2
   const innerW = cw - pad, innerH = ch - pad
   const maskSvg = `<svg width="${cw}" height="${ch}">
     <rect x="${innerX}" y="${innerY}"
           width="${innerW}" height="${innerH}" fill="white"/>
   </svg>`
   const mask = await sharp({ create: { width: cw, height: ch,
                                         channels: 4,
                                         background: { r:0,g:0,b:0,alpha:0 } }})
     .composite([{ input: Buffer.from(maskSvg), blend: 'over' }])
     .blur(12)
     .toBuffer()

   // (c) 패치에 마스크 적용 (dest-in = 패치의 알파 = 마스크)
   const maskedPatch = await sharp(patch)
     .composite([{ input: mask, blend: 'dest-in' }])
     .png().toBuffer()

   // (d) 원본 이미지에 합성
   //     compositeLeft/Top은 clamp 후 실제 크롭 좌표를 사용
   const result = await rotated.clone()
     .composite([{ input: maskedPatch, left: compositeLeft, top: compositeTop }])
     .jpeg({ quality: 92 })
     .toBuffer()

7. base64 반환
   { imageBase64: result.toString('base64'), mimeType: 'image/jpeg' }
```

### 제약 사항

- `maxDuration: 90`
- Rate limit: 분당 4회 (IP 기반, 기존 패턴 동일)
- 입력 이미지 최장 변 > 4000px 시 처리 전 2000px로 다운스케일 (메모리 압박 방지)
- 업로드 경로: `/api/image/upload-ai` 경유, `role: 'cleanup'` 전달 (기존 라우트 재사용)

---

## `ImageCleanupModal` 컴포넌트

```tsx
interface ImageCleanupModalProps {
  imageUrl: string
  onReplace: (newUrl: string) => void   // 확정 후 업로드된 URL 전달
  onAdd: (newUrl: string) => void
  onClose: () => void
  canAdd: boolean                        // uploadedUrls.length < 10
}

type Phase = 'select' | 'processing' | 'preview'

interface Selection {
  x: number; y: number       // 0~1 정규화 비율
  width: number; height: number
}
```

### 좌표 계산

이미지를 컨테이너에 종횡비 맞게 표시한다 (letterbox 없이 딱 맞춤). 드래그 이벤트에서 정규화 비율 계산:

```ts
// <img> 엘리먼트의 렌더 박스 기준
const rect = imgRef.current.getBoundingClientRect()
const normX = (e.clientX - rect.left) / rect.width
const normY = (e.clientY - rect.top) / rect.height
```

- `devicePixelRatio`는 곱하지 않는다 (`getBoundingClientRect`는 CSS px, `naturalWidth`와 함께 쓰면 DPR 상쇄됨. DPR 곱하면 오히려 버그)
- x/y/width/height 모두 [0, 1] 범위로 clamp

### 최소 선택 영역

`width < 0.02 || height < 0.02`이면 "한자 영역을 더 크게 선택해주세요"를 인라인으로 표시하고 "제거 실행" 버튼 비활성화. 서버에서도 동일 기준 재검증.

### preview 단계 확정 흐름

```
[교체] 클릭
  → POST /api/image/upload-ai (base64)
  → 응답 URL로 onReplace(url) 호출
  → 모달 닫힘

[새로 추가] 클릭
  → canAdd 확인 (false면 버튼 disabled + "이미지는 최대 10장입니다")
  → POST /api/image/upload-ai
  → onAdd(url) 호출
  → 모달 닫힘
```

---

## `DetailMakerClient.tsx` 수정

```ts
// 이미지 교체 — 기존 uploadedUrls[idx]를 새 URL로 교체
function handleReplaceImage(idx: number, newUrl: string) {
  setUploadedUrls(prev => prev.map((u, i) => i === idx ? newUrl : u))
  // 파생물(씬/썸네일)은 자동 갱신 안 됨 — 교체 직후 토스트 안내
  // "원본 이미지가 교체되었습니다. 씬은 별도로 다시 생성해야 합니다."
}

// 이미지 추가 — 10장 상한 검사
function handleAddImage(newUrl: string) {
  setUploadedUrls(prev => prev.length < 10 ? [...prev, newUrl] : prev)
}
```

`ImageCleanupModal`의 `canAdd` prop에 `uploadedUrls.length < 10`을 전달한다.

---

## 통합 지점

### `DetailMakerInputPanel`

이미지 그리드의 각 썸네일 `<div>`에 "한자 제거" 버튼 추가:

```tsx
<button
  onClick={() => setCleanupTargetIdx(idx)}
  aria-label="한자 제거"
  style={{
    position: 'absolute', bottom: '2px', left: '2px',
    background: 'rgba(0,0,0,0.6)', color: '#fff',
    border: 'none', borderRadius: '4px',
    fontSize: '10px', padding: '2px 4px', cursor: 'pointer',
  }}
>
  한자 제거
</button>

{cleanupTargetIdx === idx && (
  <ImageCleanupModal
    imageUrl={url}
    onReplace={newUrl => { onReplaceImage(idx, newUrl); setCleanupTargetIdx(null) }}
    onAdd={newUrl => { onAddImage(newUrl); setCleanupTargetIdx(null) }}
    onClose={() => setCleanupTargetIdx(null)}
    canAdd={uploadedUrls.length < 10}
  />
)}
```

`cleanupTargetIdx: number | null` state는 `DetailMakerInputPanel` 내부 로컬 state.

### `DetailMakerThumbnailPanel`

동일한 패턴으로 `thumbnailExtraUrls` 이미지 그리드에 적용. 콜백은 `onReplaceThumbnailRef(idx, newUrl)`, `onAddThumbnailRef(newUrl)`.

---

## 에러 처리

| 상황 | 처리 |
|---|---|
| 선택 영역 너무 작음 (< 2%) | 클라이언트 즉시 차단 |
| 외부 URL (SSRF) | 403 |
| 이미지 fetch 실패 | 422 + "이미지를 불러오지 못했습니다" |
| Gemini 70초 초과 | AbortError → 500 + "시간이 초과됐습니다. 다시 실행해주세요" |
| Gemini 빈 결과 | 500 + "결과가 없습니다. 다시 실행해주세요" |
| 결과 어색함 | 자동 감지 없음. preview 단계 힌트 + "다시 실행" |

---

## 테스트

**API (`cleanup-image-region`):**
- 정상 Supabase URL + 유효 region → imageBase64 반환
- 외부 URL → 403
- region width < 0.01 → 400
- Gemini 타임아웃 mock → 500 + 에러 메시지
- 이미지 경계 근처 region (패딩이 clamp되는 케이스) → 정상 처리

**`ImageCleanupModal`:**
- 드래그 → selection 정규화 비율 계산 정확성
- 최소 크기 미달 → "제거 실행" 비활성화
- preview에서 [교체] → upload-ai 호출 후 onReplace 호출
- preview에서 [새로 추가] → canAdd=false 시 버튼 disabled
- [다시 실행] → select 단계로 리셋

---

## 범위 외

- 자동 한자 감지 (AI가 먼저 찾아주는 기능)
- 다중 영역 선택 (한 번에 여러 박스)
- 배치 처리 (여러 이미지 동시 처리)
- 교체 후 씬/썸네일 자동 재생성
