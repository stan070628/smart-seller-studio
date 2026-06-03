# Gemini 워터마크 자동 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상세페이지용 이미지 업로드 시 우측 하단 Gemini 워터마크를 자동으로 제거하여 깨끗한 이미지로 상세페이지를 생성한다.

**Architecture:** `src/lib/image/watermark-removal.ts`에 `removeGeminiWatermark()` 순수 함수를 구현한다. 이 함수는 Sharp로 워터마크 바로 위 픽셀 패치를 추출·블러 처리 후 워터마크 위치에 덮어씌운다. `/api/listing/upload-image` 라우트에서 `usageContext === 'listing_detail'`일 때만 해당 함수를 호출한다.

**Tech Stack:** Sharp (이미 사용 중), Vitest

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| `src/lib/image/watermark-removal.ts` | 신규 — `removeGeminiWatermark(buffer)` 함수 |
| `src/__tests__/lib/watermark-removal.test.ts` | 신규 — 위 함수 단위 테스트 |
| `src/app/api/listing/upload-image/route.ts` | 수정 — `listing_detail` 컨텍스트일 때 제거 함수 호출 |

---

## Task 1: `removeGeminiWatermark` 유틸 함수 구현 (TDD)

**Files:**
- Create: `src/lib/image/watermark-removal.ts`
- Test: `src/__tests__/lib/watermark-removal.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/lib/watermark-removal.test.ts` 파일을 새로 만든다:

```typescript
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { removeGeminiWatermark } from '@/lib/image/watermark-removal';

// 테스트용 고정 크기 JPEG 이미지 버퍼 생성 헬퍼
async function makeTestImage(options: {
  width: number;
  height: number;
  bg?: { r: number; g: number; b: number };
}): Promise<Buffer> {
  const { width, height, bg = { r: 255, g: 255, b: 255 } } = options;
  return sharp({
    create: { width, height, channels: 3, background: bg },
  })
    .jpeg({ quality: 95 })
    .toBuffer();
}

describe('removeGeminiWatermark', () => {
  it('우측 하단 워터마크 영역이 위 영역 픽셀로 덮어씌워진다', async () => {
    // 100×100 흰 이미지에 우측 하단 28×5 구간만 검게 칠함 (워터마크 시뮬레이션)
    const width = 100;
    const height = 100;
    const wmWidth = Math.floor(width * 0.28);  // 28px
    const wmHeight = Math.floor(height * 0.05); // 5px

    const whiteBg = await makeTestImage({ width, height });
    const blackPatch = await sharp({
      create: { width: wmWidth, height: wmHeight, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();

    const withWatermark = await sharp(whiteBg)
      .composite([{ input: blackPatch, left: width - wmWidth, top: height - wmHeight }])
      .jpeg({ quality: 95 })
      .toBuffer();

    const result = await removeGeminiWatermark(withWatermark);

    // 우측 하단 중심 픽셀(워터마크 영역 내)을 샘플링
    const { data } = await sharp(result)
      .extract({ left: width - 10, top: height - 3, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // 원본 흰 이미지(255) 근처여야 함 — JPEG 압축 손실 감안해 > 180
    expect(data[0]).toBeGreaterThan(180);
  });

  it('높이가 40px 미만인 이미지는 원본 버퍼를 그대로 반환한다', async () => {
    const tinyBuffer = await makeTestImage({ width: 100, height: 30 });
    const result = await removeGeminiWatermark(tinyBuffer);
    expect(result).toBe(tinyBuffer);
  });

  it('손상된 버퍼를 입력하면 예외 없이 원본 버퍼를 반환한다', async () => {
    const invalidBuffer = Buffer.from('not-an-image-at-all');
    const result = await removeGeminiWatermark(invalidBuffer);
    expect(result).toBe(invalidBuffer);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/__tests__/lib/watermark-removal.test.ts
```

예상 출력: `FAIL` — `Cannot find module '@/lib/image/watermark-removal'`

- [ ] **Step 3: 함수 구현**

`src/lib/image/watermark-removal.ts` 파일을 새로 만든다:

```typescript
import sharp from 'sharp';

const WATERMARK_WIDTH_RATIO = 0.28;
const WATERMARK_HEIGHT_RATIO = 0.05;
const MIN_HEIGHT_PX = 40;
const BLUR_SIGMA = 3;

/**
 * 이미지 우측 하단의 Gemini 워터마크를 인접 픽셀로 덮어 제거합니다.
 * 실패 시 원본 버퍼를 그대로 반환합니다 (non-fatal).
 */
export async function removeGeminiWatermark(buffer: Buffer): Promise<Buffer> {
  try {
    const { width, height } = await sharp(buffer).metadata();
    if (!width || !height || height < MIN_HEIGHT_PX) return buffer;

    const wmWidth = Math.floor(width * WATERMARK_WIDTH_RATIO);
    const wmHeight = Math.floor(height * WATERMARK_HEIGHT_RATIO);
    const wmLeft = width - wmWidth;
    const wmTop = height - wmHeight;

    // 워터마크 바로 위 동일 크기 구간을 추출하여 블렌딩 소스로 사용
    const patchBuffer = await sharp(buffer)
      .extract({ left: wmLeft, top: wmTop - wmHeight, width: wmWidth, height: wmHeight })
      .blur(BLUR_SIGMA)
      .toBuffer();

    return sharp(buffer)
      .composite([{ input: patchBuffer, left: wmLeft, top: wmTop }])
      .toBuffer();
  } catch {
    return buffer;
  }
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

```bash
npx vitest run src/__tests__/lib/watermark-removal.test.ts
```

예상 출력: `PASS` — 3개 테스트 모두 통과

- [ ] **Step 5: 커밋**

```bash
git add src/lib/image/watermark-removal.ts src/__tests__/lib/watermark-removal.test.ts
git commit -m "feat: Gemini 워터마크 제거 유틸 함수 추가 (Sharp 패치 복사 방식)"
```

---

## Task 2: 업로드 라우트에 워터마크 제거 통합

**Files:**
- Modify: `src/app/api/listing/upload-image/route.ts` (line 275–292, Sharp 처리 후 블록)

- [ ] **Step 1: 기존 파일 읽기**

`src/app/api/listing/upload-image/route.ts`의 275–300번 줄을 확인한다. `processImage()` 호출 후 `processedBuffer`가 반환되는 블록을 찾는다.

```typescript
// 현재 코드 (약 275–292번 줄):
let processedBuffer: Buffer
let processedSize: number
try {
  const result = await processImage(Buffer.from(arrayBuffer))
  processedBuffer = result.buffer
  processedSize = result.fileSize
} catch (err) {
  ...
}
```

- [ ] **Step 2: import 추가**

파일 상단 import 목록에 아래 줄을 추가한다. Sharp import 바로 아래에 위치시킨다:

```typescript
import { removeGeminiWatermark } from "@/lib/image/watermark-removal"
```

- [ ] **Step 3: 워터마크 제거 호출 추가**

`processImage()` 블록 바로 뒤, 스토리지 경로 생성 블록(`// 8. 스토리지 경로 생성`) 앞에 아래 코드를 삽입한다:

```typescript
    // listing_detail 컨텍스트: Gemini 워터마크 자동 제거
    if (usageContext === 'listing_detail') {
      try {
        processedBuffer = await removeGeminiWatermark(processedBuffer)
        processedSize = processedBuffer.length
      } catch {
        // non-fatal — 원본 processedBuffer 유지
      }
    }
```

변경 후 해당 구간 전체가 이렇게 되어야 한다:

```typescript
    // 7. Sharp 이미지 처리 (리사이즈 + JPEG 변환)
    let processedBuffer: Buffer
    let processedSize: number
    try {
      const result = await processImage(Buffer.from(arrayBuffer))
      processedBuffer = result.buffer
      processedSize = result.fileSize
    } catch (err) {
      console.error("[POST /api/listing/upload-image] Sharp 처리 오류:", err)
      return Response.json(
        {
          success: false,
          error: "이미지 처리 중 오류가 발생했습니다.",
          code: "UPLOAD_FAILED",
        } satisfies ApiErrorResponse,
        { status: 500 }
      )
    }

    // listing_detail 컨텍스트: Gemini 워터마크 자동 제거
    if (usageContext === 'listing_detail') {
      try {
        processedBuffer = await removeGeminiWatermark(processedBuffer)
        processedSize = processedBuffer.length
      } catch {
        // non-fatal — 원본 processedBuffer 유지
      }
    }

    // 8. 스토리지 경로 생성
```

- [ ] **Step 4: 빌드 타입 오류 확인**

```bash
npx tsc --noEmit
```

예상 출력: 오류 없음

- [ ] **Step 5: 전체 테스트 실행**

```bash
npx vitest run
```

예상 출력: 기존 테스트 전부 통과, 새로 추가한 3개도 포함하여 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/listing/upload-image/route.ts
git commit -m "feat: listing_detail 업로드 시 Gemini 워터마크 자동 제거 적용"
```

---

## 수동 검증

- [ ] 제미나이로 생성한 워터마크 있는 이미지를 준비한다
- [ ] 로컬 dev 서버 실행: `npm run dev`
- [ ] "AI 상품 등록" → 상세이미지 슬롯에 해당 이미지 업로드
- [ ] 반환된 이미지 URL을 브라우저에서 열어 우측 하단 워터마크가 사라졌는지 확인
- [ ] "썸네일·상세만 만들기" → 상세 이미지 슬롯에 업로드 후 동일하게 확인
- [ ] 썸네일 슬롯(listing_thumbnail)에 업로드한 이미지는 워터마크가 그대로인지 확인
