# 1688 이미지 중국어→한국어 자동 번역 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1688에서 가져온 상품 이미지에 박힌 중국어 텍스트를 OCR로 추출 → Claude로 한국어 번역 → Sharp로 흰 박스+한국어 오버레이 합성하여 자동으로 한국어 이미지를 생성한다. 셀러는 미리보기에서 이미지별로 원본/번역을 토글할 수 있다.

**Architecture:** classify 라우트와 generate 라우트 사이에 `translate-images` 라우트를 신설한다. 이미지마다 `image_translations` 테이블에서 `sha256(원본URL)` 기반 캐시를 먼저 조회하고, 미스 시에만 GCV OCR → Claude 번역 → Sharp 합성 → Supabase Storage 업로드 파이프라인을 돈다. 라우트 내부에서는 `p-limit`으로 동시 5개까지 병렬 처리한다.

**Tech Stack:** Next.js 16 App Router, Vitest, Sharp, `@google-cloud/vision`, `@anthropic-ai/sdk` (Claude Sonnet 4.6), `opentype.js` (폰트 메트릭), `p-limit` (동시성 제어), Supabase Storage + Postgres.

**관련 디자인 문서:** `docs/superpowers/specs/2026-05-08-1688-image-translation-design.md`

---

## File Structure

### 신규 파일

| 경로 | 책임 |
|---|---|
| `supabase/migrations/056_create_image_translations.sql` | 캐시 테이블 + RLS |
| `src/lib/listing/fonts/PretendardVariable.ttf` | 한국어 폰트 (서버 번들) |
| `src/lib/listing/google-vision-client.ts` | Google Vision OCR 클라이언트 싱글톤 + `extractTextBlocks()` |
| `src/lib/ai/prompts/translate-overlay.ts` | Claude 배치 번역 프롬프트 + zod 파서 |
| `src/lib/listing/sharp-overlay.ts` | bbox 흰 박스 + Pretendard 한국어 SVG 합성, 글자 자동 축소 |
| `src/lib/listing/translation-cache.ts` | `image_translations` 테이블 조회/저장 헬퍼 |
| `src/lib/listing/image-translator.ts` | 메인 파이프라인 (캐시 → OCR → 번역 → 합성 → 업로드) |
| `src/app/api/listing/import-1688/translate-images/route.ts` | 새 API 라우트 |

### 변경 파일

| 경로 | 변경 내용 |
|---|---|
| `src/lib/listing/import-1688-types.ts` | `translatedUrl?: string` 필드, `TranslateImagesRequest/Response` 타입 추가 |
| `src/lib/detail-page/html-builder.ts` | `<img>` 디폴트 `src`는 `translatedUrl ?? originalUrl`, `data-original-src` 속성 추가 |
| `src/components/listing/import1688/ResultPreview.tsx` | 이미지별 [한국어 ⇄ 원본] 토글 배지 |
| `src/app/listing/import-1688/page.tsx` | classify 후 translate-images 호출 단계 추가 |
| `next.config.ts` | `outputFileTracingIncludes`로 폰트 파일을 Function 번들에 포함 |
| `package.json` | 의존성 추가: `@google-cloud/vision`, `opentype.js`, `p-limit` |

---

## Task 1: 의존성 설치 및 폰트 파일 추가

**Files:**
- Modify: `package.json`
- Create: `src/lib/listing/fonts/PretendardVariable.ttf`
- Modify: `next.config.ts`

- [ ] **Step 1: 의존성 설치**

```bash
npm install @google-cloud/vision opentype.js p-limit
npm install -D @types/opentype.js
```

- [ ] **Step 2: Pretendard 폰트 다운로드**

```bash
mkdir -p src/lib/listing/fonts
curl -L -o src/lib/listing/fonts/PretendardVariable.ttf \
  https://github.com/orioncactus/pretendard/raw/main/packages/pretendard/dist/public/variable/PretendardVariable.ttf
```

확인: `ls -lh src/lib/listing/fonts/PretendardVariable.ttf` (약 1~2MB 파일이어야 함)

- [ ] **Step 3: Function 번들에 폰트 포함되도록 next.config.ts 수정**

`next.config.ts`에 다음 추가 (기존 config 객체에 병합):

```ts
outputFileTracingIncludes: {
  '/api/listing/import-1688/translate-images': [
    './src/lib/listing/fonts/**',
  ],
},
```

- [ ] **Step 4: 빌드 통과 확인**

Run: `npm run build`
Expected: 빌드 성공, 에러 없음

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json next.config.ts src/lib/listing/fonts/
git commit -m "deps: 1688 이미지 번역용 의존성 + Pretendard 폰트 추가"
```

---

## Task 2: 환경변수 및 DB 마이그레이션

**Files:**
- Create: `supabase/migrations/056_create_image_translations.sql`

- [ ] **Step 1: 마이그레이션 SQL 작성**

`supabase/migrations/056_create_image_translations.sql`:

```sql
-- 1688 이미지 번역 캐시 테이블
-- 같은 1688 이미지 URL이 여러 셀러에 의해 import되어도 한 번만 처리하기 위함

create table image_translations (
  image_url_hash text primary key,
  original_url   text not null,
  translated_url text,
  ocr_blocks     jsonb,
  status         text not null check (status in ('ok', 'no_text', 'failed')),
  error_message  text,
  created_at     timestamptz default now()
);

create index image_translations_status_idx on image_translations(status);
create index image_translations_created_at_idx on image_translations(created_at desc);

-- RLS: service_role만 접근. 일반 사용자는 라우트를 통해서만 접근 가능
alter table image_translations enable row level security;

comment on table image_translations is
  '1688 이미지 OCR + 번역 + 합성 결과 캐시. 키는 sha256(original_url)';
comment on column image_translations.ocr_blocks is
  '[{ text_zh, text_ko, bbox: { x, y, w, h } }, ...] 형태. status=ok일 때만 의미 있음';
```

- [ ] **Step 2: 로컬 Supabase에 마이그레이션 적용 (해당 환경이 있다면)**

Run: `supabase db push` 또는 프로젝트 컨벤션에 맞는 명령
Expected: 에러 없이 적용

- [ ] **Step 3: 환경변수 추가 안내 (`.env.local` 직접 수정 권장)**

`.env.local`에 추가:

```
GOOGLE_APPLICATION_CREDENTIALS_JSON=<base64 인코딩된 서비스 계정 JSON>
```

생성 방법(개발자 노트):
1. GCP Console → APIs & Services → "Cloud Vision API" 활성화
2. IAM → 서비스 계정 생성 → "Cloud Vision API User" 역할 부여
3. JSON 키 발급 → `base64 -i key.json | tr -d '\n' > key.b64`
4. `.env.local`과 Vercel 환경변수(`vercel env add GOOGLE_APPLICATION_CREDENTIALS_JSON`)에 동일 base64 값 추가

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/056_create_image_translations.sql
git commit -m "db: image_translations 캐시 테이블 추가"
```

---

## Task 3: Google Vision OCR 클라이언트

**Files:**
- Create: `src/lib/listing/google-vision-client.ts`
- Test: `src/lib/listing/__tests__/google-vision-client.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/listing/__tests__/google-vision-client.test.ts`:

```ts
// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractTextBlocks } from '@/lib/listing/google-vision-client';

vi.mock('@google-cloud/vision', () => {
  const documentTextDetection = vi.fn();
  return {
    ImageAnnotatorClient: vi.fn().mockImplementation(() => ({ documentTextDetection })),
    __mockDetect: documentTextDetection,
  };
});

const visionMock = await import('@google-cloud/vision');

describe('extractTextBlocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = Buffer.from(
      JSON.stringify({ type: 'service_account', project_id: 'test' })
    ).toString('base64');
  });

  it('GCV 응답을 { text, bbox } 배열로 정규화한다', async () => {
    // @ts-expect-error mock helper
    visionMock.__mockDetect.mockResolvedValueOnce([
      {
        fullTextAnnotation: {
          pages: [
            {
              blocks: [
                {
                  paragraphs: [
                    {
                      words: [
                        {
                          symbols: [{ text: '产' }, { text: '品' }],
                          boundingBox: {
                            vertices: [
                              { x: 10, y: 20 },
                              { x: 50, y: 20 },
                              { x: 50, y: 60 },
                              { x: 10, y: 60 },
                            ],
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ]);

    const blocks = await extractTextBlocks(Buffer.from([0, 1, 2]));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('产品');
    expect(blocks[0].bbox).toEqual({ x: 10, y: 20, w: 40, h: 40 });
  });

  it('텍스트가 없으면 빈 배열을 반환한다', async () => {
    // @ts-expect-error mock helper
    visionMock.__mockDetect.mockResolvedValueOnce([{ fullTextAnnotation: null }]);
    const blocks = await extractTextBlocks(Buffer.from([0]));
    expect(blocks).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/listing/__tests__/google-vision-client.test.ts`
Expected: FAIL — `extractTextBlocks`가 정의되지 않음

- [ ] **Step 3: 구현**

`src/lib/listing/google-vision-client.ts`:

```ts
import { ImageAnnotatorClient } from '@google-cloud/vision';

export interface TextBlock {
  text: string;
  bbox: { x: number; y: number; w: number; h: number };
}

let _client: ImageAnnotatorClient | null = null;

function getClient(): ImageAnnotatorClient {
  if (_client) return _client;
  const credsB64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!credsB64) {
    throw new Error('[GCV] GOOGLE_APPLICATION_CREDENTIALS_JSON 환경변수가 없습니다.');
  }
  const credentials = JSON.parse(Buffer.from(credsB64, 'base64').toString('utf-8'));
  _client = new ImageAnnotatorClient({ credentials });
  return _client;
}

/**
 * 이미지 버퍼에서 텍스트 블록을 추출합니다.
 * 단어 단위(word)로 묶고, 빈 텍스트나 공백만 있는 것은 제외합니다.
 */
export async function extractTextBlocks(imageBuffer: Buffer): Promise<TextBlock[]> {
  const client = getClient();
  const [result] = await client.documentTextDetection({
    image: { content: imageBuffer },
  });

  const annotation = result.fullTextAnnotation;
  if (!annotation || !annotation.pages) return [];

  const blocks: TextBlock[] = [];
  for (const page of annotation.pages) {
    for (const block of page.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const word of paragraph.words ?? []) {
          const text = (word.symbols ?? []).map((s) => s.text ?? '').join('');
          if (!text.trim()) continue;
          const verts = word.boundingBox?.vertices ?? [];
          if (verts.length < 4) continue;
          const xs = verts.map((v) => v.x ?? 0);
          const ys = verts.map((v) => v.y ?? 0);
          const x = Math.min(...xs);
          const y = Math.min(...ys);
          const w = Math.max(...xs) - x;
          const h = Math.max(...ys) - y;
          blocks.push({ text, bbox: { x, y, w, h } });
        }
      }
    }
  }
  return blocks;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/listing/__tests__/google-vision-client.test.ts`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/lib/listing/google-vision-client.ts src/lib/listing/__tests__/google-vision-client.test.ts
git commit -m "feat: Google Vision OCR 클라이언트 래퍼 (extractTextBlocks)"
```

---

## Task 4: Claude 번역 프롬프트 + 파서

**Files:**
- Create: `src/lib/ai/prompts/translate-overlay.ts`
- Test: `src/lib/listing/__tests__/translate-overlay-prompt.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/listing/__tests__/translate-overlay-prompt.test.ts`:

```ts
// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  buildTranslateOverlayUserPrompt,
  parseTranslateOverlayResponse,
} from '@/lib/ai/prompts/translate-overlay';

describe('buildTranslateOverlayUserPrompt', () => {
  it('인덱스가 부여된 중국어 텍스트 목록을 포함한다', () => {
    const prompt = buildTranslateOverlayUserPrompt(['产品', '尺寸表']);
    expect(prompt).toContain('0: 产品');
    expect(prompt).toContain('1: 尺寸表');
  });
});

describe('parseTranslateOverlayResponse', () => {
  it('JSON 응답을 인덱스 순서대로 파싱한다', () => {
    const raw = '{"translations":[{"index":0,"ko":"제품"},{"index":1,"ko":"사이즈표"}]}';
    expect(parseTranslateOverlayResponse(raw, 2)).toEqual(['제품', '사이즈표']);
  });

  it('코드펜스로 감싼 응답도 파싱한다', () => {
    const raw = '```json\n{"translations":[{"index":0,"ko":"제품"}]}\n```';
    expect(parseTranslateOverlayResponse(raw, 1)).toEqual(['제품']);
  });

  it('응답 길이가 입력과 다르면 에러를 던진다', () => {
    const raw = '{"translations":[{"index":0,"ko":"제품"}]}';
    expect(() => parseTranslateOverlayResponse(raw, 2)).toThrow(/길이/);
  });

  it('번역 누락 인덱스는 빈 문자열로 채운다', () => {
    const raw = '{"translations":[{"index":1,"ko":"사이즈표"}]}';
    expect(() => parseTranslateOverlayResponse(raw, 2)).toThrow(/길이/);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/listing/__tests__/translate-overlay-prompt.test.ts`
Expected: FAIL — 모듈을 찾을 수 없음

- [ ] **Step 3: 구현**

`src/lib/ai/prompts/translate-overlay.ts`:

```ts
import { z } from 'zod';
import { jsonrepair } from 'jsonrepair';

export const TRANSLATE_OVERLAY_SYSTEM_PROMPT = `당신은 중국 1688 상품 이미지의 텍스트를 한국 쿠팡 셀러용으로 번역하는 전문가입니다.

규칙:
1. 자연스러운 한국어 구어체로. 번역투(예: "본 제품은", "해당 제품의", "~이 됩니다") 금지.
2. 길이는 가능한 한 원문과 비슷하게 — 이미지 위 박스에 들어가야 함.
3. 단위·숫자·치수는 그대로(예: cm, kg, M, L, XL).
4. 의미가 불분명하거나 단순 장식 글자면 가장 그럴듯한 한국어 한 단어로.
5. 출력은 JSON 한 객체. 다른 설명 절대 추가 금지.

출력 형식:
{ "translations": [ { "index": 0, "ko": "..." }, { "index": 1, "ko": "..." }, ... ] }`;

export function buildTranslateOverlayUserPrompt(texts: string[]): string {
  const list = texts.map((t, i) => `${i}: ${t}`).join('\n');
  return `다음 중국어 텍스트를 한국어로 번역하세요. 각 항목은 1688 상품 이미지에서 추출된 별개의 단어/구절입니다.

${list}

규칙대로 JSON으로만 출력하세요.`;
}

const responseSchema = z.object({
  translations: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      ko: z.string(),
    })
  ),
});

function stripCodeFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

export function parseTranslateOverlayResponse(rawText: string, expectedLength: number): string[] {
  const cleaned = stripCodeFences(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = JSON.parse(jsonrepair(cleaned));
  }
  const validated = responseSchema.parse(parsed);
  if (validated.translations.length !== expectedLength) {
    throw new Error(
      `[translate-overlay] 응답 길이 불일치: 기대 ${expectedLength}, 실제 ${validated.translations.length}`
    );
  }
  const ordered = new Array<string>(expectedLength).fill('');
  for (const item of validated.translations) {
    if (item.index >= 0 && item.index < expectedLength) {
      ordered[item.index] = item.ko;
    }
  }
  return ordered;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/listing/__tests__/translate-overlay-prompt.test.ts`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/prompts/translate-overlay.ts src/lib/listing/__tests__/translate-overlay-prompt.test.ts
git commit -m "feat: Claude 배치 번역 프롬프트 + JSON 파서"
```

---

## Task 5: Sharp 합성 — 글자 폭 측정 헬퍼

**Files:**
- Create: `src/lib/listing/sharp-overlay.ts` (1차: 폭 계산 함수만)
- Test: `src/lib/listing/__tests__/sharp-overlay.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/listing/__tests__/sharp-overlay.test.ts`:

```ts
// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { measureTextWidth, fitFontSize } from '@/lib/listing/sharp-overlay';

describe('measureTextWidth', () => {
  it('한국어 문자열의 픽셀 폭을 양수로 반환한다', () => {
    const w = measureTextWidth('테스트', 16);
    expect(w).toBeGreaterThan(0);
  });

  it('폰트 크기가 커지면 폭도 비례해서 커진다', () => {
    const small = measureTextWidth('테스트', 16);
    const big = measureTextWidth('테스트', 32);
    expect(big).toBeGreaterThan(small);
    expect(big / small).toBeCloseTo(2, 0);
  });

  it('빈 문자열의 폭은 0이다', () => {
    expect(measureTextWidth('', 16)).toBe(0);
  });
});

describe('fitFontSize', () => {
  it('초기 크기에 들어가면 그대로 반환한다', () => {
    const size = fitFontSize('가', { boxWidth: 1000, initialSize: 20, minSize: 8 });
    expect(size).toBe(20);
  });

  it('박스에 안 들어가면 점진적으로 축소한다', () => {
    const size = fitFontSize('가나다라마바사아자차카타파하', {
      boxWidth: 30,
      initialSize: 40,
      minSize: 8,
    });
    expect(size).toBeLessThan(40);
    expect(size).toBeGreaterThanOrEqual(8);
  });

  it('최소 크기 미만으로는 내려가지 않는다', () => {
    const size = fitFontSize('매우매우매우매우매우긴문자열입니다', {
      boxWidth: 5,
      initialSize: 40,
      minSize: 8,
    });
    expect(size).toBe(8);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/listing/__tests__/sharp-overlay.test.ts`
Expected: FAIL — 모듈을 찾을 수 없음

- [ ] **Step 3: 구현 (1차 — 폭 측정 + 폰트 크기 피팅)**

`src/lib/listing/sharp-overlay.ts`:

```ts
import path from 'node:path';
import opentype, { type Font } from 'opentype.js';

const FONT_PATH = path.join(
  process.cwd(),
  'src/lib/listing/fonts/PretendardVariable.ttf'
);

let _font: Font | null = null;

function getFont(): Font {
  if (_font) return _font;
  _font = opentype.loadSync(FONT_PATH);
  return _font;
}

/**
 * 주어진 폰트 크기에서 문자열의 렌더 폭(px)을 반환합니다.
 */
export function measureTextWidth(text: string, fontSize: number): number {
  if (text.length === 0) return 0;
  const font = getFont();
  return font.getAdvanceWidth(text, fontSize);
}

interface FitOptions {
  boxWidth: number;
  initialSize: number;
  minSize: number;
}

/**
 * 주어진 박스 폭에 텍스트가 들어가도록 폰트 크기를 1px씩 줄입니다.
 * 박스 폭의 105%까지 허용하고, 그래도 안 들어가면 minSize까지 축소합니다.
 */
export function fitFontSize(text: string, opts: FitOptions): number {
  const tolerance = opts.boxWidth * 1.05;
  for (let size = opts.initialSize; size >= opts.minSize; size -= 1) {
    if (measureTextWidth(text, size) <= tolerance) return size;
  }
  return opts.minSize;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/listing/__tests__/sharp-overlay.test.ts`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add src/lib/listing/sharp-overlay.ts src/lib/listing/__tests__/sharp-overlay.test.ts
git commit -m "feat: Pretendard 폰트 폭 측정 + 자동 축소 헬퍼"
```

---

## Task 6: Sharp 합성 — composeOverlay 메인 함수

**Files:**
- Modify: `src/lib/listing/sharp-overlay.ts`
- Modify: `src/lib/listing/__tests__/sharp-overlay.test.ts`

- [ ] **Step 1: 실패하는 테스트 추가**

`src/lib/listing/__tests__/sharp-overlay.test.ts` 끝에 추가:

```ts
import sharp from 'sharp';
import { composeOverlay, type OverlayBlock } from '@/lib/listing/sharp-overlay';

describe('composeOverlay', () => {
  async function makeRedSquare(size = 200): Promise<Buffer> {
    return sharp({
      create: {
        width: size,
        height: size,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer();
  }

  it('블록이 0개면 원본과 동일한 크기의 JPEG을 반환한다', async () => {
    const base = await makeRedSquare(200);
    const out = await composeOverlay(base, []);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200);
    expect(meta.format).toBe('jpeg');
  });

  it('흰 박스가 합성되면 해당 픽셀이 흰색에 가까워진다', async () => {
    const base = await makeRedSquare(200);
    const blocks: OverlayBlock[] = [
      { text_ko: '테스트', bbox: { x: 50, y: 50, w: 100, h: 30 } },
    ];
    const out = await composeOverlay(base, blocks);
    // 박스 중앙 (100, 65) 픽셀을 추출 → R/G/B 모두 200 이상
    const center = await sharp(out)
      .extract({ left: 100, top: 65, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(center[0]).toBeGreaterThan(200); // R
    expect(center[1]).toBeGreaterThan(200); // G
    expect(center[2]).toBeGreaterThan(200); // B
  });

  it('블록 텍스트가 길어도 에러 없이 출력한다', async () => {
    const base = await makeRedSquare(400);
    const blocks: OverlayBlock[] = [
      {
        text_ko: '아주아주아주아주아주아주아주긴 한국어 텍스트입니다',
        bbox: { x: 10, y: 10, w: 80, h: 20 },
      },
    ];
    const out = await composeOverlay(base, blocks);
    expect(out.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/listing/__tests__/sharp-overlay.test.ts`
Expected: FAIL — `composeOverlay`가 export되지 않음

- [ ] **Step 3: composeOverlay 구현**

`src/lib/listing/sharp-overlay.ts` 끝에 추가:

```ts
import sharp from 'sharp';

export interface OverlayBlock {
  text_ko: string;
  bbox: { x: number; y: number; w: number; h: number };
}

const PADDING_PX = 2;
const TEXT_COLOR = '#1a1a1a';
const BOX_COLOR = '#ffffff';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildBlockSvg(width: number, height: number, blocks: OverlayBlock[]): string {
  const rects = blocks
    .map((b) => {
      const x = b.bbox.x - PADDING_PX;
      const y = b.bbox.y - PADDING_PX;
      const w = b.bbox.w + PADDING_PX * 2;
      const h = b.bbox.h + PADDING_PX * 2;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${BOX_COLOR}"/>`;
    })
    .join('');

  const texts = blocks
    .map((b) => {
      const initial = Math.max(8, Math.floor(b.bbox.h * 0.7));
      const fontSize = fitFontSize(b.text_ko, {
        boxWidth: b.bbox.w,
        initialSize: initial,
        minSize: 8,
      });
      const cx = b.bbox.x + b.bbox.w / 2;
      const cy = b.bbox.y + b.bbox.h / 2 + fontSize * 0.35;
      return `<text x="${cx}" y="${cy}" font-family="Pretendard" font-size="${fontSize}" fill="${TEXT_COLOR}" text-anchor="middle">${escapeXml(b.text_ko)}</text>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rects}${texts}</svg>`;
}

/**
 * 원본 이미지에 흰 박스 + 한국어 텍스트 오버레이를 합성합니다.
 * 블록이 0개면 원본을 JPEG로 다시 인코딩만 합니다.
 */
export async function composeOverlay(
  baseImage: Buffer,
  blocks: OverlayBlock[]
): Promise<Buffer> {
  const meta = await sharp(baseImage).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) {
    throw new Error('[composeOverlay] 이미지 크기를 알 수 없습니다.');
  }

  if (blocks.length === 0) {
    return sharp(baseImage).jpeg({ quality: 90 }).toBuffer();
  }

  const svg = buildBlockSvg(width, height, blocks);
  return sharp(baseImage)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/listing/__tests__/sharp-overlay.test.ts`
Expected: PASS (9 passed)

- [ ] **Step 5: Commit**

```bash
git add src/lib/listing/sharp-overlay.ts src/lib/listing/__tests__/sharp-overlay.test.ts
git commit -m "feat: composeOverlay — 흰 박스 + 한국어 SVG 합성"
```

---

## Task 7: 캐시 헬퍼

**Files:**
- Create: `src/lib/listing/translation-cache.ts`
- Test: `src/lib/listing/__tests__/translation-cache.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/listing/__tests__/translation-cache.test.ts`:

```ts
// @vitest-environment node

import { describe, it, expect, vi } from 'vitest';
import { hashImageUrl, getCachedTranslation, saveTranslation } from '@/lib/listing/translation-cache';

vi.mock('@/lib/supabase/server', () => {
  const single = vi.fn();
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const upsert = vi.fn();
  const from = vi.fn(() => ({ select, upsert }));
  return {
    getSupabaseServerClient: () => ({ from }),
    __mocks: { single, upsert, from },
  };
});

const mod = await import('@/lib/supabase/server');

describe('hashImageUrl', () => {
  it('동일 URL은 동일 해시를 반환한다', () => {
    expect(hashImageUrl('https://a.com/x.jpg')).toBe(hashImageUrl('https://a.com/x.jpg'));
  });

  it('다른 URL은 다른 해시를 반환한다', () => {
    expect(hashImageUrl('https://a.com/x.jpg')).not.toBe(hashImageUrl('https://a.com/y.jpg'));
  });

  it('해시는 64자 hex 문자열이다', () => {
    expect(hashImageUrl('https://a.com/x.jpg')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('getCachedTranslation', () => {
  it('캐시 히트 시 row를 반환한다', async () => {
    // @ts-expect-error mock helper
    mod.__mocks.single.mockResolvedValueOnce({
      data: {
        image_url_hash: 'abc',
        translated_url: 'https://cdn/x.jpg',
        status: 'ok',
      },
      error: null,
    });
    const row = await getCachedTranslation('https://a.com/x.jpg');
    expect(row?.translated_url).toBe('https://cdn/x.jpg');
  });

  it('캐시 미스 시 null을 반환한다', async () => {
    // @ts-expect-error mock helper
    mod.__mocks.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116' },
    });
    const row = await getCachedTranslation('https://a.com/y.jpg');
    expect(row).toBeNull();
  });
});

describe('saveTranslation', () => {
  it('upsert 호출 시 image_url_hash를 키로 사용한다', async () => {
    // @ts-expect-error mock helper
    mod.__mocks.upsert.mockResolvedValueOnce({ error: null });
    await saveTranslation({
      original_url: 'https://a.com/x.jpg',
      translated_url: 'https://cdn/x.jpg',
      ocr_blocks: [],
      status: 'ok',
    });
    // @ts-expect-error mock helper
    expect(mod.__mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ok', original_url: 'https://a.com/x.jpg' }),
      expect.objectContaining({ onConflict: 'image_url_hash' })
    );
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/listing/__tests__/translation-cache.test.ts`
Expected: FAIL — 모듈을 찾을 수 없음

- [ ] **Step 3: 구현**

`src/lib/listing/translation-cache.ts`:

```ts
import { createHash } from 'node:crypto';
import { getSupabaseServerClient } from '@/lib/supabase/server';

const TABLE = 'image_translations';

export interface CachedTranslation {
  image_url_hash: string;
  original_url: string;
  translated_url: string | null;
  ocr_blocks: Array<{
    text_zh: string;
    text_ko: string;
    bbox: { x: number; y: number; w: number; h: number };
  }> | null;
  status: 'ok' | 'no_text' | 'failed';
  error_message: string | null;
}

export function hashImageUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

export async function getCachedTranslation(url: string): Promise<CachedTranslation | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('image_url_hash', hashImageUrl(url))
    .single();

  if (error) {
    if ((error as { code?: string }).code === 'PGRST116') return null; // no rows
    throw new Error(`[translation-cache] 조회 실패: ${error.message ?? error}`);
  }
  return data as CachedTranslation;
}

interface SaveInput {
  original_url: string;
  translated_url: string | null;
  ocr_blocks: CachedTranslation['ocr_blocks'];
  status: CachedTranslation['status'];
  error_message?: string | null;
}

export async function saveTranslation(input: SaveInput): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from(TABLE)
    .upsert(
      {
        image_url_hash: hashImageUrl(input.original_url),
        original_url: input.original_url,
        translated_url: input.translated_url,
        ocr_blocks: input.ocr_blocks,
        status: input.status,
        error_message: input.error_message ?? null,
      },
      { onConflict: 'image_url_hash' }
    );
  if (error) {
    throw new Error(`[translation-cache] 저장 실패: ${error.message}`);
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/listing/__tests__/translation-cache.test.ts`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add src/lib/listing/translation-cache.ts src/lib/listing/__tests__/translation-cache.test.ts
git commit -m "feat: image_translations 캐시 조회/저장 헬퍼"
```

---

## Task 8: 메인 파이프라인 통합 (image-translator)

**Files:**
- Create: `src/lib/listing/image-translator.ts`
- Test: `src/lib/listing/__tests__/image-translator.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/listing/__tests__/image-translator.test.ts`:

```ts
// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/listing/google-vision-client', () => ({
  extractTextBlocks: vi.fn(),
}));
vi.mock('@/lib/listing/translation-cache', () => ({
  hashImageUrl: (u: string) => 'hash-' + u,
  getCachedTranslation: vi.fn(),
  saveTranslation: vi.fn(),
}));
vi.mock('@/lib/listing/sharp-overlay', () => ({
  composeOverlay: vi.fn(async () => Buffer.from('jpeg-out')),
}));
vi.mock('@/lib/supabase/server', () => ({
  uploadToStorage: vi.fn(async (path: string) => ({
    url: `https://cdn/${path}`,
    path,
    size: 1,
  })),
  STORAGE_BUCKET: 'test',
}));
vi.mock('@/lib/ai/claude', () => ({
  getAnthropicClient: () => ({
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: 'text', text: '{"translations":[{"index":0,"ko":"제품"}]}' }],
      })),
    },
  }),
}));

global.fetch = vi.fn(async () =>
  new Response(new Uint8Array([0xff, 0xd8, 0xff]).buffer, {
    status: 200,
    headers: { 'content-length': '3' },
  })
) as unknown as typeof fetch;

const visionMod = await import('@/lib/listing/google-vision-client');
const cacheMod = await import('@/lib/listing/translation-cache');
const { translateImage } = await import('@/lib/listing/image-translator');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('translateImage', () => {
  it('캐시 히트 시 OCR을 호출하지 않고 캐시된 URL을 반환한다', async () => {
    // @ts-expect-error mock
    cacheMod.getCachedTranslation.mockResolvedValueOnce({
      image_url_hash: 'h',
      original_url: 'https://a/x.jpg',
      translated_url: 'https://cdn/cached.jpg',
      status: 'ok',
    });

    const result = await translateImage('https://a/x.jpg');
    expect(result.translatedUrl).toBe('https://cdn/cached.jpg');
    expect(visionMod.extractTextBlocks).not.toHaveBeenCalled();
  });

  it('OCR이 빈 배열이면 status=no_text, translatedUrl=null을 반환', async () => {
    // @ts-expect-error mock
    cacheMod.getCachedTranslation.mockResolvedValueOnce(null);
    // @ts-expect-error mock
    visionMod.extractTextBlocks.mockResolvedValueOnce([]);

    const result = await translateImage('https://a/y.jpg');
    expect(result.translatedUrl).toBeNull();
    expect(result.status).toBe('no_text');
    expect(cacheMod.saveTranslation).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'no_text', translated_url: null })
    );
  });

  it('OCR + 번역 + 합성 + 업로드 후 translatedUrl을 반환', async () => {
    // @ts-expect-error mock
    cacheMod.getCachedTranslation.mockResolvedValueOnce(null);
    // @ts-expect-error mock
    visionMod.extractTextBlocks.mockResolvedValueOnce([
      { text: '产品', bbox: { x: 0, y: 0, w: 50, h: 20 } },
    ]);

    const result = await translateImage('https://a/z.jpg');
    expect(result.status).toBe('ok');
    expect(result.translatedUrl).toMatch(/^https:\/\/cdn\//);
  });

  it('OCR 실패 시 status=failed, translatedUrl=null을 반환 (재시도 1회)', async () => {
    // @ts-expect-error mock
    cacheMod.getCachedTranslation.mockResolvedValueOnce(null);
    // @ts-expect-error mock
    visionMod.extractTextBlocks
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'));

    const result = await translateImage('https://a/fail.jpg');
    expect(result.status).toBe('failed');
    expect(result.translatedUrl).toBeNull();
    expect(visionMod.extractTextBlocks).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/lib/listing/__tests__/image-translator.test.ts`
Expected: FAIL — `translateImage`를 찾을 수 없음

- [ ] **Step 3: 구현**

`src/lib/listing/image-translator.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '@/lib/ai/claude';
import {
  TRANSLATE_OVERLAY_SYSTEM_PROMPT,
  buildTranslateOverlayUserPrompt,
  parseTranslateOverlayResponse,
} from '@/lib/ai/prompts/translate-overlay';
import { extractTextBlocks, type TextBlock } from '@/lib/listing/google-vision-client';
import { composeOverlay, type OverlayBlock } from '@/lib/listing/sharp-overlay';
import {
  getCachedTranslation,
  saveTranslation,
  hashImageUrl,
} from '@/lib/listing/translation-cache';
import { uploadToStorage } from '@/lib/supabase/server';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export interface TranslateImageResult {
  originalUrl: string;
  translatedUrl: string | null;
  status: 'ok' | 'no_text' | 'failed';
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`이미지 다운로드 실패: ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? '0');
  if (len > MAX_IMAGE_BYTES) throw new Error('이미지 크기가 너무 큽니다.');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('이미지 크기가 너무 큽니다.');
  return buf;
}

async function translateBlocks(blocks: TextBlock[]): Promise<string[]> {
  if (blocks.length === 0) return [];
  const client: Anthropic = getAnthropicClient();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: TRANSLATE_OVERLAY_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildTranslateOverlayUserPrompt(blocks.map((b) => b.text)) },
        ],
      },
    ],
  });
  const rawText =
    response.content.length > 0 && response.content[0].type === 'text'
      ? response.content[0].text
      : '';
  return parseTranslateOverlayResponse(rawText, blocks.length);
}

export async function translateImage(originalUrl: string): Promise<TranslateImageResult> {
  // 1. 캐시 조회
  const cached = await getCachedTranslation(originalUrl);
  if (cached) {
    return {
      originalUrl,
      translatedUrl: cached.translated_url,
      status: cached.status,
    };
  }

  try {
    // 2. 이미지 다운로드
    const imageBuffer = await downloadImage(originalUrl);

    // 3. OCR (재시도 1회)
    const blocks = await withRetry(() => extractTextBlocks(imageBuffer));
    if (blocks.length === 0) {
      await saveTranslation({
        original_url: originalUrl,
        translated_url: null,
        ocr_blocks: [],
        status: 'no_text',
      });
      return { originalUrl, translatedUrl: null, status: 'no_text' };
    }

    // 4. 번역 (재시도 1회)
    const koreans = await withRetry(() => translateBlocks(blocks));

    // 5. 합성
    const overlayBlocks: OverlayBlock[] = blocks.map((b, i) => ({
      text_ko: koreans[i] ?? '',
      bbox: b.bbox,
    }));
    const composed = await composeOverlay(imageBuffer, overlayBlocks);

    // 6. 업로드
    const storagePath = `1688-translations/${hashImageUrl(originalUrl)}.jpg`;
    const { url: translatedUrl } = await uploadToStorage(
      storagePath,
      composed.buffer.slice(
        composed.byteOffset,
        composed.byteOffset + composed.byteLength
      ) as ArrayBuffer,
      'image/jpeg',
      composed.length
    );

    // 7. 캐시 저장
    const ocrBlocks = blocks.map((b, i) => ({
      text_zh: b.text,
      text_ko: koreans[i] ?? '',
      bbox: b.bbox,
    }));
    await saveTranslation({
      original_url: originalUrl,
      translated_url: translatedUrl,
      ocr_blocks: ocrBlocks,
      status: 'ok',
    });

    return { originalUrl, translatedUrl, status: 'ok' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[image-translator]', originalUrl, message);
    try {
      await saveTranslation({
        original_url: originalUrl,
        translated_url: null,
        ocr_blocks: null,
        status: 'failed',
        error_message: message,
      });
    } catch {
      // 캐시 저장 실패는 무시
    }
    return { originalUrl, translatedUrl: null, status: 'failed' };
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/lib/listing/__tests__/image-translator.test.ts`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add src/lib/listing/image-translator.ts src/lib/listing/__tests__/image-translator.test.ts
git commit -m "feat: image-translator 메인 파이프라인 (캐시→OCR→번역→합성→업로드)"
```

---

## Task 9: 타입 업데이트

**Files:**
- Modify: `src/lib/listing/import-1688-types.ts`

- [ ] **Step 1: 타입 추가**

`src/lib/listing/import-1688-types.ts` 전체 교체:

```ts
export type ImageClassificationType =
  | 'main_product'
  | 'lifestyle'
  | 'infographic'
  | 'size_chart';

export type TranslationStatus = 'ok' | 'no_text' | 'failed' | 'skipped';

export interface ClassifiedImage {
  url: string;
  type: ImageClassificationType;
}

/** 번역 단계를 거친 이미지. translatedUrl이 null이면 원본만 사용 */
export interface TranslatedImage extends ClassifiedImage {
  translatedUrl: string | null;
  translationStatus: TranslationStatus;
}

export interface ClassifyResponse {
  images: ClassifiedImage[];
}

export interface TranslateImagesRequest {
  images: ClassifiedImage[];
}

export interface TranslateImagesResponse {
  images: TranslatedImage[];
}

export interface GenerateResponse {
  thumbnailUrl: string;
  detailPageHtml: string;
}
```

- [ ] **Step 2: 빌드 통과 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음 (기존 generate route가 ClassifiedImage만 받기 때문에 호환됨)

- [ ] **Step 3: Commit**

```bash
git add src/lib/listing/import-1688-types.ts
git commit -m "types: TranslatedImage + TranslateImages 요청/응답 타입 추가"
```

---

## Task 10: translate-images API 라우트

**Files:**
- Create: `src/app/api/listing/import-1688/translate-images/route.ts`
- Test: `src/__tests__/api/import-1688-translate-images.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/__tests__/api/import-1688-translate-images.test.ts`:

```ts
// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(async () => ({ userId: 'u' })),
}));

vi.mock('@/lib/listing/image-translator', () => ({
  translateImage: vi.fn(),
}));

const translatorMod = await import('@/lib/listing/image-translator');
const { POST } = await import('@/app/api/listing/import-1688/translate-images/route');

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://x/api/listing/import-1688/translate-images', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/listing/import-1688/translate-images', () => {
  it('lifestyle 타입은 번역하지 않고 status=skipped로 응답한다', async () => {
    // @ts-expect-error mock
    translatorMod.translateImage.mockImplementation(async (url: string) => ({
      originalUrl: url,
      translatedUrl: 'https://cdn/' + url,
      status: 'ok' as const,
    }));

    const res = await POST(
      makeReq({
        images: [
          { url: 'https://a/info.jpg', type: 'infographic' },
          { url: 'https://a/life.jpg', type: 'lifestyle' },
        ],
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.images).toHaveLength(2);
    const lifestyle = body.images.find((i: { type: string }) => i.type === 'lifestyle');
    expect(lifestyle.translationStatus).toBe('skipped');
    expect(lifestyle.translatedUrl).toBeNull();
    expect(translatorMod.translateImage).toHaveBeenCalledTimes(1); // infographic만
  });

  it('한 이미지가 실패해도 다른 이미지는 정상 응답한다', async () => {
    // @ts-expect-error mock
    translatorMod.translateImage
      .mockResolvedValueOnce({
        originalUrl: 'https://a/1.jpg',
        translatedUrl: 'https://cdn/1.jpg',
        status: 'ok',
      })
      .mockResolvedValueOnce({
        originalUrl: 'https://a/2.jpg',
        translatedUrl: null,
        status: 'failed',
      });

    const res = await POST(
      makeReq({
        images: [
          { url: 'https://a/1.jpg', type: 'infographic' },
          { url: 'https://a/2.jpg', type: 'size_chart' },
        ],
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.images[0].translatedUrl).toBe('https://cdn/1.jpg');
    expect(body.images[1].translationStatus).toBe('failed');
    expect(body.images[1].translatedUrl).toBeNull();
  });

  it('빈 images 배열은 400을 반환', async () => {
    const res = await POST(makeReq({ images: [] }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/__tests__/api/import-1688-translate-images.test.ts`
Expected: FAIL — 라우트 모듈을 찾을 수 없음

- [ ] **Step 3: 라우트 구현**

`src/app/api/listing/import-1688/translate-images/route.ts`:

```ts
import { NextRequest } from 'next/server';
import { z } from 'zod';
import pLimit from 'p-limit';
import { requireAuth } from '@/lib/supabase/auth';
import { translateImage } from '@/lib/listing/image-translator';
import type {
  TranslatedImage,
  TranslateImagesResponse,
} from '@/lib/listing/import-1688-types';

export const maxDuration = 120;

const httpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith('https://'), '이미지 URL은 https만 허용됩니다.');

const requestSchema = z.object({
  images: z
    .array(
      z.object({
        url: httpsUrl,
        type: z.enum(['main_product', 'lifestyle', 'infographic', 'size_chart']),
      })
    )
    .min(1)
    .max(20),
});

const CONCURRENCY = 5;

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '잘못된 요청 바디입니다.' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const { images } = parsed.data;
  const limit = pLimit(CONCURRENCY);

  const results: TranslatedImage[] = await Promise.all(
    images.map((img) =>
      limit(async (): Promise<TranslatedImage> => {
        if (img.type === 'lifestyle') {
          return {
            url: img.url,
            type: img.type,
            translatedUrl: null,
            translationStatus: 'skipped',
          };
        }
        const r = await translateImage(img.url);
        return {
          url: img.url,
          type: img.type,
          translatedUrl: r.translatedUrl,
          translationStatus: r.status,
        };
      })
    )
  );

  return Response.json({ images: results } satisfies TranslateImagesResponse);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/api/import-1688-translate-images.test.ts`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/listing/import-1688/translate-images/route.ts src/__tests__/api/import-1688-translate-images.test.ts
git commit -m "feat: translate-images API 라우트 (동시성 5, lifestyle 스킵)"
```

---

## Task 11: html-builder에 translatedUrl 우선 적용

**Files:**
- Modify: `src/lib/detail-page/html-builder.ts`
- Test: `src/lib/detail-page/__tests__/html-builder.test.ts` (또는 신규)

- [ ] **Step 1: 기존 테스트 위치 확인**

Run: `find src/lib/detail-page -name "*.test.ts" 2>/dev/null`
Expected: 결과를 보고 신규 파일 생성 여부 결정

- [ ] **Step 2: 실패하는 테스트 작성**

`src/lib/detail-page/__tests__/html-builder-translation.test.ts`:

```ts
// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { buildDetailPageHtml } from '@/lib/detail-page/html-builder';

const baseContent = {
  headline: 'h',
  subheadline: 's',
  sellingPoints: [],
  detailDescription: '',
  specs: [],
};

describe('buildDetailPageHtml — translatedUrl 우선', () => {
  it('translatedUrl이 있으면 src에 사용하고 data-original-src에 원본을 저장한다', () => {
    const html = buildDetailPageHtml(baseContent as never, [
      {
        imageBase64: '',
        mimeType: 'image/jpeg',
        publicUrl: 'https://orig/x.jpg',
        translatedUrl: 'https://cdn/translated.jpg',
      },
    ]);
    expect(html).toContain('src="https://cdn/translated.jpg"');
    expect(html).toContain('data-original-src="https://orig/x.jpg"');
  });

  it('translatedUrl이 없으면 publicUrl을 그대로 사용한다', () => {
    const html = buildDetailPageHtml(baseContent as never, [
      {
        imageBase64: '',
        mimeType: 'image/jpeg',
        publicUrl: 'https://orig/y.jpg',
      },
    ]);
    expect(html).toContain('src="https://orig/y.jpg"');
    expect(html).not.toContain('data-original-src');
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run src/lib/detail-page/__tests__/html-builder-translation.test.ts`
Expected: FAIL

- [ ] **Step 4: html-builder.ts 수정**

`src/lib/detail-page/html-builder.ts`의 `ImageInput`과 `toDataUrl` 수정:

```ts
interface ImageInput {
  imageBase64: string;
  mimeType: string;
  publicUrl?: string;
  translatedUrl?: string | null;
}

function toDataUrl(img: ImageInput): string {
  if (img.translatedUrl) return escapeHtml(img.translatedUrl);
  if (img.publicUrl) return escapeHtml(img.publicUrl);
  return `data:${img.mimeType};base64,${img.imageBase64}`;
}
```

`<img>` 태그를 빌드하는 부분(buildHeroSection, buildGallerySection 등)에 `data-original-src` 속성 추가:

```ts
function imageAttrs(img: ImageInput, alt: string): string {
  const src = toDataUrl(img);
  const original = img.translatedUrl && img.publicUrl
    ? ` data-original-src="${escapeHtml(img.publicUrl)}"`
    : '';
  return `src="${src}" alt="${escapeHtml(alt)}"${original}`;
}
```

각 `<img>` 사용처를 `<img ${imageAttrs(img, '...')} ... />` 형태로 변경.

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/lib/detail-page/__tests__/html-builder-translation.test.ts`
Expected: PASS (2 passed)

- [ ] **Step 6: 기존 html-builder 테스트 회귀 없음 확인**

Run: `npx vitest run src/lib/detail-page`
Expected: 모든 기존 테스트 PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/detail-page/html-builder.ts src/lib/detail-page/__tests__/html-builder-translation.test.ts
git commit -m "feat: html-builder가 translatedUrl 우선, data-original-src 보존"
```

---

## Task 12: ResultPreview 토글 UI

**Files:**
- Modify: `src/components/listing/import1688/ResultPreview.tsx`
- Test: `src/components/listing/import1688/__tests__/ResultPreview.test.tsx`

- [ ] **Step 1: 컴포넌트 구조 파악**

Run: `cat src/components/listing/import1688/ResultPreview.tsx`
목적: 기존 props·렌더 구조 확인 후 다음 단계의 props/구현 매핑.

- [ ] **Step 2: 실패하는 테스트 작성**

`src/components/listing/import1688/__tests__/ResultPreview.test.tsx`:

```tsx
// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageWithToggle } from '@/components/listing/import1688/ResultPreview';

describe('ImageWithToggle', () => {
  it('translatedUrl이 있으면 디폴트로 한국어 이미지를 보여준다', () => {
    render(
      <ImageWithToggle
        originalUrl="https://orig/x.jpg"
        translatedUrl="https://cdn/x.jpg"
        alt="t"
      />
    );
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.src).toBe('https://cdn/x.jpg');
  });

  it('토글 클릭 시 src가 원본으로 바뀐다', () => {
    render(
      <ImageWithToggle
        originalUrl="https://orig/x.jpg"
        translatedUrl="https://cdn/x.jpg"
        alt="t"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /원본/i }));
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.src).toBe('https://orig/x.jpg');
  });

  it('translatedUrl이 null이면 토글 버튼이 없다', () => {
    render(
      <ImageWithToggle originalUrl="https://orig/y.jpg" translatedUrl={null} alt="t" />
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx vitest run src/components/listing/import1688/__tests__/ResultPreview.test.tsx`
Expected: FAIL — `ImageWithToggle`이 export되지 않음

- [ ] **Step 4: ImageWithToggle 컴포넌트 추가**

`src/components/listing/import1688/ResultPreview.tsx` 상단에 추가 export:

```tsx
'use client';

import { useState } from 'react';

interface ImageWithToggleProps {
  originalUrl: string;
  translatedUrl: string | null;
  alt: string;
  className?: string;
}

export function ImageWithToggle({
  originalUrl,
  translatedUrl,
  alt,
  className,
}: ImageWithToggleProps): JSX.Element {
  const [showOriginal, setShowOriginal] = useState(false);
  const src = translatedUrl && !showOriginal ? translatedUrl : originalUrl;
  const canToggle = translatedUrl !== null;

  return (
    <div className="relative group inline-block">
      <img src={src} alt={alt} className={className} data-original-src={originalUrl} />
      {canToggle && (
        <button
          type="button"
          onClick={() => setShowOriginal((v) => !v)}
          className="absolute top-2 right-2 px-2 py-1 text-xs rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 transition"
          aria-label={showOriginal ? '한국어로 보기' : '원본으로 보기'}
        >
          {showOriginal ? '🇰🇷 한국어' : '🇨🇳 원본'}
        </button>
      )}
    </div>
  );
}
```

기존 ResultPreview 본문에서 모든 `<img>`를 `<ImageWithToggle ... />`로 교체. props로 `translatedUrl`을 받도록 부모 props 시그니처도 확장.

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx vitest run src/components/listing/import1688/__tests__/ResultPreview.test.tsx`
Expected: PASS (3 passed)

- [ ] **Step 6: Commit**

```bash
git add src/components/listing/import1688/ResultPreview.tsx src/components/listing/import1688/__tests__/ResultPreview.test.tsx
git commit -m "feat: ResultPreview에 이미지별 한국어/원본 토글 UI"
```

---

## Task 13: page.tsx에 translate 단계 추가

**Files:**
- Modify: `src/app/listing/import-1688/page.tsx`

- [ ] **Step 1: 기존 page.tsx 흐름 확인**

Run: `cat src/app/listing/import-1688/page.tsx`
목적: classify 응답 후 어떤 state를 들고 generate를 호출하는지 파악.

- [ ] **Step 2: 흐름 수정**

`src/app/listing/import-1688/page.tsx`에서 classify 호출 직후에 `translate-images` 호출 단계를 끼움. 의사 코드:

```ts
// classify 응답
const classifyRes = await fetch('/api/listing/import-1688/classify', { ... });
const { images } = await classifyRes.json();

// 신규: translate-images
setStep('translating');
const transRes = await fetch('/api/listing/import-1688/translate-images', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ images }),
});
const { images: translatedImages } = await transRes.json();
// translatedImages: TranslatedImage[]

// generate 호출 시 translatedUrl 포함
const genRes = await fetch('/api/listing/import-1688/generate', {
  method: 'POST',
  body: JSON.stringify({
    images: translatedImages.map((i) => ({
      url: i.url,
      type: i.type,
      translatedUrl: i.translatedUrl, // generate route는 무시해도 OK, html-builder가 필요
    })),
    thumbnailUrl,
    sessionId,
  }),
});
```

또한 `ResultPreview`에 `translatedImages`를 prop으로 전달해 토글이 동작하게 한다.

UI 진행률: 기존 step 표시에 "이미지 번역 중..." 단계 추가.

- [ ] **Step 3: 빌드/타입 통과 확인**

Run: `npx tsc --noEmit`
Expected: 에러 없음

- [ ] **Step 4: 개발 서버에서 수동 확인**

Run: `npm run dev` 백그라운드에서 띄우고 1688 import 페이지에서 이미지 5장 업로드 → translate 단계 거쳐 결과 페이지에 진입하는지 확인.

확인 포인트:
- [ ] classify → translating → result 단계가 순서대로 진행되는가
- [ ] lifestyle 이미지에는 토글 배지가 안 뜨는가
- [ ] 다른 이미지에 토글 클릭 시 원본/한국어가 전환되는가
- [ ] 한 이미지가 failed 상태여도 다른 이미지는 정상인가

- [ ] **Step 5: Commit**

```bash
git add src/app/listing/import-1688/page.tsx
git commit -m "feat: 1688 import 페이지에 이미지 번역 단계 추가"
```

---

## Task 14: generate route는 변경 없이 통과 확인

**Files:**
- Modify: `src/app/api/listing/import-1688/generate/route.ts` (필요 시)
- Modify: `src/app/api/listing/import-1688/generate/route.ts` 의 zod 스키마

- [ ] **Step 1: 기존 generate route 확인**

이미 `images` 배열 각 항목에 `translatedUrl` 필드가 들어와도 zod가 거부하지 않게 스키마를 확장:

`src/app/api/listing/import-1688/generate/route.ts`에서 `classifiedImageSchema`에 필드 추가:

```ts
const classifiedImageSchema = z.object({
  url: httpsUrl,
  type: z.enum(['main_product', 'lifestyle', 'infographic', 'size_chart']),
  translatedUrl: z.string().url().nullable().optional(),
});
```

그리고 `imageInputs` 매핑에 `translatedUrl` 전달:

```ts
const imageInputs = images.map((img) => ({
  imageBase64: '',
  mimeType: 'image/jpeg' as const,
  publicUrl: img.url,
  translatedUrl: img.translatedUrl ?? null,
}));
```

- [ ] **Step 2: 기존 generate 테스트가 깨지지 않는지 확인**

Run: `npx vitest run src/__tests__/api/import-1688-generate.test.ts`
Expected: 모두 PASS

- [ ] **Step 3: html-builder 단위 테스트로 충분한지 판단**

`translatedUrl`이 HTML에 박히는 동작은 Task 11에서 이미 단위 테스트로 검증됨. generate route 통합 테스트는 zod 스키마가 `translatedUrl` 필드를 거부하지 않는지만 확인하면 충분.

`src/__tests__/api/import-1688-generate.test.ts`의 기존 success 케이스에 한 항목만 변형 추가:

```ts
it('images에 translatedUrl이 포함되어도 zod 검증을 통과한다', async () => {
  // 기존 success 테스트의 request body에서 images[0]에 translatedUrl: 'https://x/translated.jpg' 추가
  // 응답이 200이고 detailPageHtml이 비어있지 않은지만 확인
});
```

기존 테스트의 mock setup(Anthropic, sharp, supabase)이 그대로 재사용 가능하므로, request body만 변경한 것을 그대로 복사·붙여 변형 추가.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/__tests__/api/import-1688-generate.test.ts`
Expected: 모두 PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/listing/import-1688/generate/route.ts src/__tests__/api/import-1688-generate.test.ts
git commit -m "feat: generate route가 translatedUrl 필드 수용 + html-builder로 전달"
```

---

## Task 15: E2E 스모크 테스트 (Playwright)

**Files:**
- Create: `tests/e2e/1688-image-translation.spec.ts`

- [ ] **Step 1: 기존 e2e 스펙 위치/패턴 확인**

Run: `ls tests/e2e/ 2>/dev/null || ls e2e/ 2>/dev/null` (프로젝트 컨벤션 확인)

- [ ] **Step 2: 스모크 테스트 작성**

`tests/e2e/1688-image-translation.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('1688 이미지 import — translate-images 단계가 호출되고 결과에 토글이 보인다', async ({ page }) => {
  // 외부 GCV/Claude를 실제로 호출하지 않도록 MSW 또는 환경변수 mock 토글 필요.
  // 본 스펙은 "흐름이 살아 있다"만 검증하는 스모크 레벨.

  await page.goto('/listing/import-1688');

  // 1) 이미지 URL 입력 (테스트용 고정 URL — 프로젝트의 fixture 사용)
  await page
    .getByRole('textbox', { name: /이미지 URL/i })
    .fill('https://example.com/fixtures/infographic.jpg');
  await page.getByRole('button', { name: /가져오기|업로드/i }).click();

  // 2) translate 단계가 등장
  await expect(page.getByText(/번역 중|translating/i)).toBeVisible({ timeout: 30_000 });

  // 3) 결과에 토글 버튼 존재
  await expect(page.getByRole('button', { name: /원본|한국어/ })).toBeVisible({
    timeout: 60_000,
  });
});
```

테스트가 외부 API에 의존하지 않도록, dev 환경에서 MSW로 `extractTextBlocks` 등을 모킹할 수 있게 하거나, `process.env.E2E_MOCK_TRANSLATIONS=1`일 때 결정적 결과를 반환하는 토글을 image-translator에 추가하는 것을 권장.

- [ ] **Step 3: 실행**

Run: `npx playwright test tests/e2e/1688-image-translation.spec.ts`
Expected: PASS (또는 환경 미비 시 skip 처리)

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/1688-image-translation.spec.ts
git commit -m "test: 1688 이미지 번역 E2E 스모크 (Playwright)"
```

---

## Task 16: 골든 샘플 시각 회귀 (선택)

**Files:**
- Create: `src/lib/listing/__tests__/fixtures/sharp-overlay-golden/`
- Create: `src/lib/listing/__tests__/sharp-overlay-golden.test.ts`

이 태스크는 sharp 합성 결과의 픽셀 회귀를 잡는 안전망입니다. CI 시간 부담이 있으면 보류 가능.

- [ ] **Step 1: 5종 골든 입력 + 기대 출력 준비**

샘플:
1. 짧은 라벨 (200×100, "产品" 1블록)
2. 긴 캡션 (400×100, 50자 텍스트 1블록)
3. 사이즈표 (600×400, 표 헤더 6블록)
4. 그라디언트 배경 (300×300, 빨강→파랑, 텍스트 2블록)
5. 작은 글자 (200×200, 8px 수준 텍스트 3블록)

각 입력은 `sharp({ create: { ... } }).toBuffer()`로 생성, 기대 출력은 첫 실행 시 저장(`writeFileSync('expected_1.jpg', out)`) 후 이후 실행에서 픽셀 diff < 5%를 검증.

- [ ] **Step 2: 픽셀 diff 헬퍼**

`pixelmatch` 또는 sharp의 `raw()` + `Buffer` 비교로 픽셀 단위 diff 비율 계산.

- [ ] **Step 3: 첫 실행으로 골든 생성 → 두 번째 실행으로 diff 검증**

생성된 골든을 git에 커밋. 합성 로직 변경 시 골든 갱신.

- [ ] **Step 4: Commit**

```bash
git add src/lib/listing/__tests__/fixtures/sharp-overlay-golden/ src/lib/listing/__tests__/sharp-overlay-golden.test.ts
git commit -m "test: sharp-overlay 골든 샘플 시각 회귀"
```

---

## Self-Review 체크리스트

구현 시작 전, 본인 코드를 검토할 때 확인:

1. **Spec coverage** — 디자인 문서의 각 결정(품질 B, 범위 C, 엔진 A, UX B)이 어느 태스크에서 구현되는가?
   - 품질 B (오버레이): Task 5, 6 (sharp-overlay)
   - 범위 C (lifestyle 제외): Task 10 (라우트에서 분기)
   - 엔진 A (GCV + Claude): Task 3 (GCV), Task 4 (Claude 프롬프트), Task 8 (통합)
   - UX B (자동 번역 + 토글): Task 12 (토글), Task 13 (page 흐름)
   - 캐시: Task 2 (DB), Task 7 (헬퍼), Task 8 (사용)
   - 동시성 5: Task 10 (`p-limit`)
   - 에러 폴백: Task 8 (try/catch + saveTranslation status)

2. **타입 일관성** — `TranslatedImage`, `OverlayBlock`, `TextBlock`, `CachedTranslation`이 사용처에서 일관되게 매칭되는가?
   - `TextBlock.bbox`와 `OverlayBlock.bbox`가 동일 형태(`{x,y,w,h}`)
   - `image-translator`가 `TextBlock`을 받아 `OverlayBlock`으로 매핑

3. **순서 의존성** — Task 8(image-translator)은 Task 3, 4, 5, 6, 7에 의존. Task 10은 Task 8, 9에 의존. 위 순서대로 진행하면 충족.

4. **누락된 결정** — 디자인 문서에 있고 계획에 없는 항목 있는지?
   - "Pretendard 폰트 번들 포함": Task 1에서 next.config 설정 ✓
   - "토글 마지막 상태가 최종 저장본": ResultPreview state가 그 역할. 저장 시점은 기존 import 페이지의 저장 로직에 의존(현행 그대로) — 본 범위 외.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-09-1688-image-translation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 태스크별로 새 서브에이전트를 dispatch, 태스크 사이마다 리뷰 가능, 빠른 반복.

**2. Inline Execution** — 현재 세션에서 executing-plans로 일괄 실행, 체크포인트마다 사용자 검토.

어느 쪽으로 진행할까요?
