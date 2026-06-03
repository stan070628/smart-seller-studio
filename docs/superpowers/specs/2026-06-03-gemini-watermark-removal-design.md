# Gemini 워터마크 자동 제거 — 디자인 스펙

**날짜**: 2026-06-03  
**상태**: 승인됨

---

## 배경 및 목표

AI 상품 등록과 썸네일·상세만 만들기 두 플로우에서 상세페이지용 이미지를 첨부할 때, Gemini로 생성된 이미지에 우측 하단 고정 위치 워터마크가 찍혀 있다. 이 워터마크를 업로드 시점에 자동으로 제거하여 사용자가 별도 조작 없이 깨끗한 이미지로 상세페이지를 만들 수 있게 한다.

---

## 요구사항

- 워터마크 위치: 우측 하단 고정
- 제거 트리거: 업로드 시 자동 (사용자 조작 없음)
- 적용 범위: `usageContext === 'listing_detail'` 업로드에만 적용 (썸네일 이미지 불포함)
- 빈 공간 처리: 워터마크 바로 위 영역의 픽셀 텍스처를 활용해 자연스럽게 채움
- 외부 API 불필요: Sharp만 사용

---

## 아키텍처

### 데이터 흐름

```
클라이언트 파일 선택
      ↓
prepareUpload() [client] — 2000px JPEG 사전 리사이즈
      ↓
POST /api/listing/upload-image
      ↓
processImage() — 최대 2000px 리사이즈 + JPEG 변환
      ↓  [listing_detail 컨텍스트만]
removeGeminiWatermark() — 우측 하단 패치 복사 + 블렌딩  ← 신규
      ↓
Supabase Storage 저장
      ↓
assets 테이블 INSERT
```

두 플로우(AI 상품 등록, 썸네일·상세만 만들기) 모두 동일한 업로드 엔드포인트를 사용하므로 한 지점에서 처리된다.

---

## 워터마크 제거 기법

### 영역 정의

| 항목 | 값 |
|---|---|
| 워터마크 너비 | 이미지 너비의 28% |
| 워터마크 높이 | 이미지 높이의 5% |
| 워터마크 위치 | 우측 하단 (`x = width * 0.72`, `y = height * 0.95`) |

### 블렌딩 방식

```
┌─────────────────────────────────────────┐
│                                         │
│          [원본 이미지]                    │
│                                         │
│                        ┌───────────────┤  ← 1. 패치 원본 영역 추출
│                        │  patch source │     (워터마크 바로 위, 동일 크기)
│                        │               │
│                        ├───────────────┤  ← 2. blur(3px) 적용 후 composite
│                        │  watermark    │
└────────────────────────┴───────────────┘
```

1. 워터마크 영역 바로 위의 동일 크기 구간을 Sharp `extract()`로 추출
2. `blur(3)` 적용 (픽셀 경계 부드럽게)
3. 원본 버퍼에 추출한 패치를 워터마크 좌표에 `composite()`

---

## 파일 변경 목록

| 파일 | 변경 | 비고 |
|---|---|---|
| `src/lib/image/watermark-removal.ts` | 신규 | `removeGeminiWatermark(buffer: Buffer): Promise<Buffer>` |
| `src/app/api/listing/upload-image/route.ts` | 수정 | `listing_detail` 컨텍스트일 때 워터마크 제거 호출 |

---

## 함수 시그니처

```typescript
// src/lib/image/watermark-removal.ts

/**
 * 이미지 우측 하단의 Gemini 워터마크를 인접 픽셀로 덮어 제거합니다.
 * 실패 시 원본 버퍼를 그대로 반환합니다 (non-fatal).
 */
export async function removeGeminiWatermark(buffer: Buffer): Promise<Buffer>
```

---

## 에러 처리

- 워터마크 제거 중 예외 발생 시 → 원본 버퍼 그대로 반환 (업로드 흐름 중단 없음)
- 이미지가 너무 작아서 패치 추출이 불가한 경우(높이 < 40px) → 스킵
- 콘솔에 `warn` 로그만 남김

---

## 테스트 전략

- 단위 테스트: `removeGeminiWatermark()` 함수에 고정 픽셀 이미지 입력 → 우측 하단 영역이 위 영역과 동일 텍스처인지 검증
- 수동 검증: Gemini 생성 이미지를 listing_detail로 업로드 후 반환된 URL에서 워터마크 유무 확인
