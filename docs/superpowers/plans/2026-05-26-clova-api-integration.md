# CLOVA API 연동 (OCR + STT) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CLOVA OCR로 상품 이미지 내 텍스트를 자동 추출해 카피 생성 품질을 높이고, CLOVA STT로 셀러의 리뷰 음성 입력을 지원한다.

**Architecture:** `analyze-image` route에서 Claude Vision + CLOVA OCR을 `Promise.all`로 병렬 호출하고, 응답의 `ocrText`를 클라이언트 Zustand에 저장해 `generate-frames` 호출 시 프롬프트에 자동 주입한다. STT는 별도 `/api/ai/speech-to-text` endpoint와 `VoiceInputButton` 컴포넌트로 분리한다.

**Tech Stack:** Next.js App Router, fetch (CLOVA OCR/Speech REST API), MediaRecorder Web API, Zustand, Vitest, Zod

---

## 파일 맵

| 상태 | 파일 | 역할 |
|------|------|------|
| 신규 | `src/lib/ai/clova-ocr.ts` | CLOVA OCR API 래퍼 |
| 신규 | `src/__tests__/lib/ai/clova-ocr.test.ts` | OCR 래퍼 단위 테스트 |
| 신규 | `src/lib/ai/clova-speech.ts` | CLOVA STT API 래퍼 |
| 신규 | `src/__tests__/lib/ai/clova-speech.test.ts` | STT 래퍼 단위 테스트 |
| 신규 | `src/app/api/ai/speech-to-text/route.ts` | POST /api/ai/speech-to-text |
| 신규 | `src/components/editor/VoiceInputButton.tsx` | 마이크 버튼 + 녹음 상태 UI |
| 수정 | `src/types/editor.ts` | `ImageAnalysisResult`에 `ocrText: string[]` 추가 |
| 수정 | `src/lib/ai/schemas.ts` | `ImageAnalysisSchema`에 `ocrText` 필드 추가 |
| 수정 | `src/__tests__/lib/schemas.test.ts` | 기존 테스트 픽스처에 `ocrText` 추가 |
| 수정 | `src/app/api/ai/analyze-image/route.ts` | Promise.all로 OCR 병렬 호출 |
| 수정 | `src/lib/ai/prompts/frame-generation.ts` | `imageAnalysis.ocrText`를 프롬프트 섹션으로 주입 |
| 수정 | `src/store/useEditorStore.ts` | `isRecording: boolean` + `setIsRecording` 추가 |
| 수정 | `src/components/editor/Sidebar.tsx` | OCR 결과 UI + VoiceInputButton 마운트 |

---

## Task 1: CLOVA OCR 래퍼 + 단위 테스트

**Files:**
- Create: `src/lib/ai/clova-ocr.ts`
- Create: `src/__tests__/lib/ai/clova-ocr.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

```typescript
// src/__tests__/lib/ai/clova-ocr.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractTextFromImage } from '@/lib/ai/clova-ocr';

describe('extractTextFromImage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('환경변수 미설정 시 빈 배열 반환', async () => {
    vi.stubEnv('NAVER_CLOVA_OCR_API_KEY_ID', '');
    vi.stubEnv('NAVER_CLOVA_OCR_API_KEY', '');
    const result = await extractTextFromImage('base64data', 'image/jpeg');
    expect(result).toEqual([]);
  });

  it('SUCCESS 응답에서 고신뢰 텍스트만 추출', async () => {
    vi.stubEnv('NAVER_CLOVA_OCR_API_KEY_ID', 'test-id');
    vi.stubEnv('NAVER_CLOVA_OCR_API_KEY', 'test-key');
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          images: [
            {
              inferResult: 'SUCCESS',
              fields: [
                { inferText: '500ml', inferConfidence: 0.99 },
                { inferText: 'BPA-FREE', inferConfidence: 0.95 },
                { inferText: '', inferConfidence: 0.99 },      // 빈 텍스트 — 제거 대상
                { inferText: '저신뢰', inferConfidence: 0.5 }, // 0.7 미만 — 제거 대상
              ],
            },
          ],
        }),
    } as Response);

    const result = await extractTextFromImage('base64data', 'image/jpeg');
    expect(result).toEqual(['500ml', 'BPA-FREE']);
  });

  it('inferResult가 EMPTY면 빈 배열 반환', async () => {
    vi.stubEnv('NAVER_CLOVA_OCR_API_KEY_ID', 'test-id');
    vi.stubEnv('NAVER_CLOVA_OCR_API_KEY', 'test-key');
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ images: [{ inferResult: 'EMPTY' }] }),
    } as Response);

    const result = await extractTextFromImage('base64data', 'image/jpeg');
    expect(result).toEqual([]);
  });

  it('API 오류 시 Error throw', async () => {
    vi.stubEnv('NAVER_CLOVA_OCR_API_KEY_ID', 'test-id');
    vi.stubEnv('NAVER_CLOVA_OCR_API_KEY', 'test-key');
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(extractTextFromImage('base64data', 'image/jpeg')).rejects.toThrow(
      'CLOVA OCR API 오류: 500'
    );
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/lib/ai/clova-ocr.test.ts
```
Expected: FAIL with "Cannot find module '@/lib/ai/clova-ocr'"

- [ ] **Step 3: 구현 파일 작성**

```typescript
// src/lib/ai/clova-ocr.ts

interface ClovaOcrField {
  inferText: string;
  inferConfidence: number;
}

interface ClovaOcrImage {
  inferResult: 'SUCCESS' | 'ERROR' | 'EMPTY';
  fields?: ClovaOcrField[];
}

interface ClovaOcrResponse {
  images: ClovaOcrImage[];
}

const MIN_CONFIDENCE = 0.7;

export async function extractTextFromImage(
  imageBase64: string,
  mimeType: string
): Promise<string[]> {
  const keyId = process.env.NAVER_CLOVA_OCR_API_KEY_ID;
  const apiKey = process.env.NAVER_CLOVA_OCR_API_KEY;

  if (!keyId || !apiKey) return [];

  const format = mimeType === 'image/png' ? 'png' : 'jpg';

  const response = await fetch('https://naveropenapi.apigw.ntruss.com/ocr/v1/infer', {
    method: 'POST',
    headers: {
      'X-NCP-APIGW-API-KEY-ID': keyId,
      'X-NCP-APIGW-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: 'V2',
      requestId: `ocr-${Date.now()}`,
      timestamp: Date.now(),
      lang: 'ko',
      images: [{ format, name: 'product', data: imageBase64 }],
      enableTableDetect: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`CLOVA OCR API 오류: ${response.status}`);
  }

  const data = (await response.json()) as ClovaOcrResponse;
  const image = data.images[0];

  if (!image || image.inferResult !== 'SUCCESS' || !image.fields) return [];

  return image.fields
    .filter((f) => f.inferConfidence >= MIN_CONFIDENCE)
    .map((f) => f.inferText.trim())
    .filter(Boolean);
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/lib/ai/clova-ocr.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/ai/clova-ocr.ts src/__tests__/lib/ai/clova-ocr.test.ts
git commit -m "feat: CLOVA OCR API 래퍼 + 단위 테스트"
```

---

## Task 2: ocrText 타입 + 스키마 확장

**Files:**
- Modify: `src/types/editor.ts:33-39`
- Modify: `src/lib/ai/schemas.ts` (ImageAnalysisSchema)
- Modify: `src/__tests__/lib/schemas.test.ts` (기존 픽스처에 ocrText 추가)

- [ ] **Step 1: schemas.test.ts의 기존 픽스처에 ocrText 추가**

`src/__tests__/lib/schemas.test.ts`의 `VALID_IMAGE_OBJECT`에 `ocrText` 필드 추가:

```typescript
// 기존 VALID_IMAGE_OBJECT에 아래 줄 추가 (다른 필드들 사이에)
ocrText: ['500ml', 'BPA-FREE'],
```

- [ ] **Step 2: 테스트 실행 — 현재 상태 확인 (통과해야 정상)**

```bash
npx vitest run src/__tests__/lib/schemas.test.ts
```
Expected: 스키마가 아직 변경 전이므로 `ocrText`는 unknown 필드로 strip됨. 기존 테스트는 통과.

- [ ] **Step 3: types/editor.ts — ImageAnalysisResult에 ocrText 추가**

`src/types/editor.ts` 33-39번째 줄의 `ImageAnalysisResult` 인터페이스를 아래로 교체:

```typescript
export interface ImageAnalysisResult {
  material: string;
  shape: string;
  colors: string[];
  keyComponents: string[];
  visualPrompt: string;
  ocrText: string[];
}
```

- [ ] **Step 4: schemas.ts — ImageAnalysisSchema에 ocrText 필드 추가**

`src/lib/ai/schemas.ts`의 `ImageAnalysisSchema` 안에 다음 필드 추가 (`visualPrompt` 정의 바로 뒤):

```typescript
ocrText: z
  .array(z.string())
  .default([])
  .describe('CLOVA OCR 인식 텍스트 목록'),
```

- [ ] **Step 5: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/lib/schemas.test.ts
```
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/types/editor.ts src/lib/ai/schemas.ts src/__tests__/lib/schemas.test.ts
git commit -m "feat: ImageAnalysisResult + ImageAnalysisSchema에 ocrText 필드 추가"
```

---

## Task 3: analyze-image route — OCR 병렬 호출

**Files:**
- Modify: `src/app/api/ai/analyze-image/route.ts`

- [ ] **Step 1: import 추가**

`src/app/api/ai/analyze-image/route.ts` 파일 상단 import 블록에 추가:

```typescript
import { extractTextFromImage } from "@/lib/ai/clova-ocr";
```

- [ ] **Step 2: Route Handler의 Claude 호출 부분을 Promise.all로 교체**

현재 코드 (약 196-233번째 줄):
```typescript
    // Claude Vision API 호출 (모든 이미지를 content 배열에 포함)
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            ...input.images.map((img) => ({
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: img.mimeType as "image/jpeg" | "image/png" | "image/webp",
                data: img.imageBase64,
              },
            })),
            {
              type: "text" as const,
              text: input.productDescription
                ? `${IMAGE_ANALYSIS_PROMPT}\n\n[판매자 제품 설명]\n${input.productDescription}`
                : IMAGE_ANALYSIS_PROMPT,
            },
          ],
        },
      ],
    });

    const rawText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    const result = parseImageResponse(rawText);

    return NextResponse.json(
      { success: true, data: result },
      { status: 200 }
    );
```

위 코드를 아래로 교체:

```typescript
    // Claude Vision + CLOVA OCR 병렬 호출
    const client = getAnthropicClient();
    const firstImage = input.images[0];

    const [visionResponse, ocrText] = await Promise.all([
      client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              ...input.images.map((img) => ({
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: img.mimeType as "image/jpeg" | "image/png" | "image/webp",
                  data: img.imageBase64,
                },
              })),
              {
                type: "text" as const,
                text: input.productDescription
                  ? `${IMAGE_ANALYSIS_PROMPT}\n\n[판매자 제품 설명]\n${input.productDescription}`
                  : IMAGE_ANALYSIS_PROMPT,
              },
            ],
          },
        ],
      }),
      // OCR은 첫 번째 이미지만 사용. 실패해도 빈 배열로 graceful degradation.
      extractTextFromImage(firstImage.imageBase64, firstImage.mimeType).catch(() => []),
    ]);

    const rawText = visionResponse.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    const result = { ...parseImageResponse(rawText), ocrText };

    return NextResponse.json(
      { success: true, data: result },
      { status: 200 }
    );
```

- [ ] **Step 3: TypeScript 타입 체크**

```bash
npx tsc --noEmit
```
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/ai/analyze-image/route.ts
git commit -m "feat: analyze-image에 CLOVA OCR 병렬 호출 추가"
```

---

## Task 4: frame-generation 프롬프트 — ocrText 섹션

**Files:**
- Modify: `src/lib/ai/prompts/frame-generation.ts:152-175` (FrameUserPromptParams)
- Modify: `src/lib/ai/prompts/frame-generation.ts:177-226` (buildFrameUserPrompt)

- [ ] **Step 1: FrameUserPromptParams의 imageAnalysis 타입에 ocrText 추가**

`src/lib/ai/prompts/frame-generation.ts`에서 `FrameUserPromptParams` 인터페이스의 `imageAnalysis` 타입 수정 (152-175번째 줄):

```typescript
export interface FrameUserPromptParams {
  reviews: string[];
  productName?: string;
  productDescription?: string;
  imageAnalysis?: {
    material?: string;
    shape?: string;
    colors?: string[];
    keyComponents?: string[];
    visualPrompt?: string;
    ocrText?: string[];
  };
  productExtract?: {
    productName?: string | null;
    brand?: string | null;
    category?: string | null;
    keyFeatures?: string[];
    ingredients?: string[];
    specs?: { label: string; value: string }[];
    cautions?: string[];
    certifications?: string[];
    targetAudience?: string | null;
    summary?: string;
  };
}
```

- [ ] **Step 2: buildFrameUserPrompt에 OCR 섹션 추가**

`src/lib/ai/prompts/frame-generation.ts`의 `buildFrameUserPrompt` 함수에서 이미지 분석 섹션 블록(198-207번째 줄) 바로 뒤에 OCR 섹션 추가:

```typescript
  // 이미지 텍스트 (CLOVA OCR) 섹션
  if (imageAnalysis?.ocrText && imageAnalysis.ocrText.length > 0) {
    sections.push(`[이미지 내 텍스트 (OCR)]\n${imageAnalysis.ocrText.join(', ')}`);
  }
```

- [ ] **Step 3: TypeScript 타입 체크**

```bash
npx tsc --noEmit
```
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/lib/ai/prompts/frame-generation.ts
git commit -m "feat: generate-frames 프롬프트에 OCR 텍스트 섹션 주입"
```

---

## Task 5: Sidebar — OCR 결과 UI

**Files:**
- Modify: `src/components/editor/Sidebar.tsx`

- [ ] **Step 1: OCR chip 섹션 추가 (이미지 업로드 목록 바로 아래)**

`src/components/editor/Sidebar.tsx`의 `imageAnalysis && (...)` 블록(601-606번째 줄)을 아래로 교체:

```tsx
            {imageAnalysis && (
              <div className="mt-1">
                <p style={{ fontSize: 11, color: '#059669' }}>분석 완료 ✓</p>
                {imageAnalysis.ocrText.length > 0 && (
                  <div className="mt-1.5">
                    <p style={{ fontSize: 10, color: '#6b7280' }} className="mb-1">
                      텍스트 인식
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {imageAnalysis.ocrText.map((text, i) => (
                        <span
                          key={i}
                          className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600"
                        >
                          {text}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
```

- [ ] **Step 2: TypeScript 타입 체크**

```bash
npx tsc --noEmit
```
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/editor/Sidebar.tsx
git commit -m "feat: Sidebar에 OCR 텍스트 인식 결과 chip 표시"
```

---

## Task 6: CLOVA STT 래퍼 + 단위 테스트

**Files:**
- Create: `src/lib/ai/clova-speech.ts`
- Create: `src/__tests__/lib/ai/clova-speech.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

```typescript
// src/__tests__/lib/ai/clova-speech.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { transcribeAudio } from '@/lib/ai/clova-speech';

describe('transcribeAudio', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('환경변수 미설정 시 Error throw', async () => {
    vi.stubEnv('NAVER_CLOVA_SPEECH_API_KEY_ID', '');
    vi.stubEnv('NAVER_CLOVA_SPEECH_API_KEY', '');
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await expect(transcribeAudio(blob)).rejects.toThrow('환경변수');
  });

  it('API 성공 응답에서 텍스트 반환', async () => {
    vi.stubEnv('NAVER_CLOVA_SPEECH_API_KEY_ID', 'test-id');
    vi.stubEnv('NAVER_CLOVA_SPEECH_API_KEY', 'test-key');
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: '안녕하세요 테스트입니다' }),
    } as Response);

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    const result = await transcribeAudio(blob);
    expect(result).toBe('안녕하세요 테스트입니다');
  });

  it('API 오류 시 Error throw', async () => {
    vi.stubEnv('NAVER_CLOVA_SPEECH_API_KEY_ID', 'test-id');
    vi.stubEnv('NAVER_CLOVA_SPEECH_API_KEY', 'test-key');
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 400 } as Response);

    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await expect(transcribeAudio(blob)).rejects.toThrow('CLOVA Speech API 오류: 400');
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
npx vitest run src/__tests__/lib/ai/clova-speech.test.ts
```
Expected: FAIL with "Cannot find module '@/lib/ai/clova-speech'"

- [ ] **Step 3: 구현 파일 작성**

```typescript
// src/lib/ai/clova-speech.ts

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const keyId = process.env.NAVER_CLOVA_SPEECH_API_KEY_ID;
  const apiKey = process.env.NAVER_CLOVA_SPEECH_API_KEY;

  if (!keyId || !apiKey) {
    throw new Error('[CLOVA Speech] 환경변수가 설정되지 않았습니다.');
  }

  const arrayBuffer = await audioBlob.arrayBuffer();

  const response = await fetch(
    'https://naveropenapi.apigw.ntruss.com/recog/v1/stt?lang=Kor',
    {
      method: 'POST',
      headers: {
        'X-NCP-APIGW-API-KEY-ID': keyId,
        'X-NCP-APIGW-API-KEY': apiKey,
        'Content-Type': 'application/octet-stream',
      },
      body: arrayBuffer,
    }
  );

  if (!response.ok) {
    throw new Error(`CLOVA Speech API 오류: ${response.status}`);
  }

  const data = (await response.json()) as { text: string };
  return data.text ?? '';
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
npx vitest run src/__tests__/lib/ai/clova-speech.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/ai/clova-speech.ts src/__tests__/lib/ai/clova-speech.test.ts
git commit -m "feat: CLOVA STT API 래퍼 + 단위 테스트"
```

---

## Task 7: speech-to-text route

**Files:**
- Create: `src/app/api/ai/speech-to-text/route.ts`

- [ ] **Step 1: route 파일 작성**

```typescript
// src/app/api/ai/speech-to-text/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudio } from '@/lib/ai/clova-speech';

interface ApiSuccessResponse {
  success: true;
  text: string;
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiSuccessResponse | ApiErrorResponse>> {
  try {
    const arrayBuffer = await request.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      return NextResponse.json(
        { success: false, error: '오디오 데이터가 비어있습니다.' },
        { status: 400 }
      );
    }

    const blob = new Blob([arrayBuffer]);
    const text = await transcribeAudio(blob);

    return NextResponse.json({ success: true, text }, { status: 200 });
  } catch (error) {
    console.error('[/api/ai/speech-to-text] 오류:', error);

    if (error instanceof Error && error.message.includes('환경변수')) {
      return NextResponse.json(
        { success: false, error: '서버 설정 오류: STT API 키가 구성되지 않았습니다.' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { success: false, error: '음성 인식 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: TypeScript 타입 체크**

```bash
npx tsc --noEmit
```
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/ai/speech-to-text/route.ts
git commit -m "feat: POST /api/ai/speech-to-text endpoint"
```

---

## Task 8: useEditorStore — isRecording 상태 추가

**Files:**
- Modify: `src/store/useEditorStore.ts`

- [ ] **Step 1: EditorStore 인터페이스에 isRecording 추가**

`src/store/useEditorStore.ts`의 `EditorStore` 인터페이스(18번째 줄 이후)에서 `isExtracting` 바로 아래에 추가:

```typescript
  isRecording: boolean;
```

그리고 메서드 목록에서 `setIsExtracting` 바로 아래에 추가:

```typescript
  setIsRecording: (value: boolean) => void;
```

- [ ] **Step 2: 초기값 + setter 구현 추가**

`create()(...)` 블록에서 `isExtracting: false` 바로 아래에 초기값 추가:

```typescript
      isRecording: false,
```

그리고 `setIsExtracting` 구현 바로 아래에 setter 추가:

```typescript
      setIsRecording: (value) => set({ isRecording: value }, false, 'setIsRecording'),
```

- [ ] **Step 3: TypeScript 타입 체크**

```bash
npx tsc --noEmit
```
Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/store/useEditorStore.ts
git commit -m "feat: useEditorStore에 isRecording 상태 추가"
```

---

## Task 9: VoiceInputButton 컴포넌트

**Files:**
- Create: `src/components/editor/VoiceInputButton.tsx`

- [ ] **Step 1: 컴포넌트 파일 작성**

```typescript
// src/components/editor/VoiceInputButton.tsx
'use client';

import React, { useRef, useCallback, useState } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import useEditorStore from '@/store/useEditorStore';

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
}

const MAX_RECORDING_MS = 60_000;

export const VoiceInputButton: React.FC<VoiceInputButtonProps> = ({ onTranscript }) => {
  const isRecording = useEditorStore((s) => s.isRecording);
  const setIsRecording = useEditorStore((s) => s.setIsRecording);
  const [isLoading, setIsLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (text: string, isError: boolean) => {
    setToastMessage({ text, isError });
    setTimeout(() => setToastMessage(null), 3000);
  };

  const stopAndTranscribe = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    if (timerRef.current) clearTimeout(timerRef.current);
    recorder.stop();
    setIsRecording(false);
  }, [setIsRecording]);

  const handleClick = useCallback(async () => {
    if (isLoading) return;

    if (isRecording) {
      stopAndTranscribe();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });

        setIsLoading(true);
        try {
          const response = await fetch('/api/ai/speech-to-text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: blob,
          });
          const data = (await response.json()) as { success: boolean; text?: string; error?: string };
          if (data.success && data.text) {
            onTranscript(data.text);
          } else {
            showToast(data.error ?? '음성 인식에 실패했습니다. 다시 시도해주세요.', true);
          }
        } catch {
          showToast('음성 인식에 실패했습니다. 다시 시도해주세요.', true);
        } finally {
          setIsLoading(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);

      timerRef.current = setTimeout(stopAndTranscribe, MAX_RECORDING_MS);
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        showToast('마이크 접근 권한이 필요합니다.', true);
      }
    }
  }, [isRecording, isLoading, onTranscript, stopAndTranscribe, setIsRecording]);

  return (
    <div className="relative">
      {isLoading ? (
        <button
          disabled
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-gray-400 bg-gray-100"
        >
          <Loader2 size={12} className="animate-spin" />
          인식 중...
        </button>
      ) : isRecording ? (
        <button
          onClick={handleClick}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-red-600 bg-red-50 hover:bg-red-100"
        >
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          <Square size={11} />
          녹음 중
        </button>
      ) : (
        <button
          onClick={handleClick}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-gray-500 bg-gray-100 hover:bg-gray-200"
        >
          <Mic size={12} />
          음성입력
        </button>
      )}

      {toastMessage && (
        <div
          className="absolute bottom-8 left-0 z-50 rounded-md px-3 py-1.5 text-xs shadow-md"
          style={{
            backgroundColor: toastMessage.isError ? 'rgba(254,242,242,1)' : 'rgba(240,253,244,1)',
            border: `1px solid ${toastMessage.isError ? 'rgba(190,0,20,0.3)' : 'rgba(74,222,128,0.4)'}`,
            color: toastMessage.isError ? '#be0014' : '#166534',
            whiteSpace: 'nowrap',
          }}
        >
          {toastMessage.text}
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: TypeScript 타입 체크**

```bash
npx tsc --noEmit
```
Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add src/components/editor/VoiceInputButton.tsx
git commit -m "feat: VoiceInputButton 컴포넌트 (MediaRecorder + CLOVA STT)"
```

---

## Task 10: Sidebar — VoiceInputButton 마운트

**Files:**
- Modify: `src/components/editor/Sidebar.tsx`

- [ ] **Step 1: VoiceInputButton import 추가**

`src/components/editor/Sidebar.tsx` 상단 import 블록에 추가:

```typescript
import { VoiceInputButton } from '@/components/editor/VoiceInputButton';
```

- [ ] **Step 2: 리뷰 textarea 아래에 VoiceInputButton 추가**

`src/components/editor/Sidebar.tsx`에서 글자 수 표시 `<p>` 태그(806-808번째 줄) 교체:

```tsx
        {/* 글자 수 + 음성입력 */}
        <div className="mt-1 flex items-center justify-between">
          <VoiceInputButton
            onTranscript={(text) =>
              setReviewText(reviewText ? `${reviewText}\n${text}` : text)
            }
          />
          <p className="text-right text-xs text-gray-400">
            {reviewText.length.toLocaleString()}자
          </p>
        </div>
```

- [ ] **Step 3: TypeScript 타입 체크**

```bash
npx tsc --noEmit
```
Expected: 에러 없음

- [ ] **Step 4: 전체 테스트 실행**

```bash
npx vitest run
```
Expected: 기존 테스트 포함 전부 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/components/editor/Sidebar.tsx
git commit -m "feat: Sidebar에 VoiceInputButton 마운트"
```

---

## 수동 검증 체크리스트

**OCR:**
- [ ] `.env.local`에 `NAVER_CLOVA_OCR_API_KEY_ID`, `NAVER_CLOVA_OCR_API_KEY` 설정
- [ ] 텍스트 있는 상품 이미지 업로드 → AI 카피 생성 → 사이드바 "텍스트 인식" chip 표시 확인
- [ ] 텍스트 없는 이미지 → chip 섹션 숨김 확인
- [ ] OCR 키 제거 후 → 앱 정상 동작, 사이드바 chip 없음 확인

**STT:**
- [ ] `.env.local`에 `NAVER_CLOVA_SPEECH_API_KEY_ID`, `NAVER_CLOVA_SPEECH_API_KEY` 설정
- [ ] 마이크 허용 → 음성입력 버튼 → 말하기 → 재클릭 → 리뷰 textarea에 텍스트 추가 확인
- [ ] 마이크 거부 → 토스트 메시지 확인
