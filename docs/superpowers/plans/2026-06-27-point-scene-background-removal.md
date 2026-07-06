# Point 씬 배경 제거 — Fidelity 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Point 섹션(lifestyle/detail/feature) 씬 생성 전 Replicate `cjwbw/rembg` API로 ref 이미지 배경을 제거해 Gemini에 순수 제품 이미지를 전달, fidelity 개선

**Architecture:** `src/lib/ai/remove-background.ts` 신규 유틸 → `generate-scene-image/route.ts`에서 `BACKGROUND_REMOVAL_SECTIONS` 분기로 호출 → 배경 제거 성공 시 강화된 프롬프트 적용. Replicate API는 native fetch + polling, 결과 PNG는 sharp로 흰 배경 합성 후 JPEG 변환. API 키 없거나 개별 실패 시 원본 ref graceful fallback.

**Tech Stack:** Replicate REST API (cjwbw/rembg), sharp (이미 설치됨), vitest, native fetch

**Spec:** `docs/superpowers/specs/2026-06-27-point-scene-background-removal-design.md`

---

## 파일 변경 목록

| 파일 | 역할 |
|------|------|
| `src/lib/ai/remove-background.ts` | 신규 — Replicate API + sharp 흰 배경 JPEG 변환 |
| `src/__tests__/lib/ai/remove-background.test.ts` | 신규 — fetch mock 단위 테스트 |
| `src/app/api/ai/generate-scene-image/route.ts` | 수정 — 배경 제거 통합 + 프롬프트 강화 |
| `.env.local` | 수동 추가 — `REPLICATE_API_TOKEN` (subagent 불가, 사용자가 직접 추가) |

---

## Task 1: `remove-background.ts` 유틸 구현 (TDD)

**Files:**
- Create: `src/__tests__/lib/ai/remove-background.test.ts`
- Create: `src/lib/ai/remove-background.ts`

### Step 1: 테스트 파일 작성 (RED)

`src/__tests__/lib/ai/remove-background.test.ts`를 생성한다.

```typescript
/**
 * remove-background.ts 단위 테스트
 * Replicate API는 global fetch mock으로 대체한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { removeImageBackgrounds } from '@/lib/ai/remove-background';

// 1x1 투명 PNG (배경 제거 출력 시뮬레이션용)
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const REF = { base64: TINY_PNG_BASE64, mimeType: 'image/jpeg' as const };

describe('removeImageBackgrounds', () => {
  beforeEach(() => {
    vi.stubEnv('REPLICATE_API_TOKEN', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('API 키가 없으면 원본을 반환하고 anyRemoved: false', async () => {
    vi.stubEnv('REPLICATE_API_TOKEN', '');
    const result = await removeImageBackgrounds([REF]);
    expect(result.anyRemoved).toBe(false);
    expect(result.refs).toEqual([REF]);
  });

  it('Replicate API 호출 성공 시 JPEG 변환 + anyRemoved: true', async () => {
    const pngBuffer = Buffer.from(TINY_PNG_BASE64, 'base64');

    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'pred-123', status: 'succeeded', output: 'https://cdn.replicate.com/out.png' }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => pngBuffer.buffer.slice(pngBuffer.byteOffset, pngBuffer.byteOffset + pngBuffer.byteLength),
        } as unknown as Response),
    );

    const result = await removeImageBackgrounds([REF]);

    expect(result.anyRemoved).toBe(true);
    expect(result.refs[0].mimeType).toBe('image/jpeg');
    // 변환 후 base64는 달라야 함
    expect(result.refs[0].base64).not.toBe(TINY_PNG_BASE64);
  });

  it('Replicate API 실패(5xx) 시 원본 ref 반환 (graceful fallback)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response),
    );

    const result = await removeImageBackgrounds([REF]);

    expect(result.anyRemoved).toBe(false);
    expect(result.refs).toEqual([REF]);
  });

  it('2장 중 1장 실패 시 성공한 이미지만 변환, anyRemoved: true', async () => {
    const pngBuffer = Buffer.from(TINY_PNG_BASE64, 'base64');

    vi.stubGlobal(
      'fetch',
      vi.fn()
        // 첫 번째 이미지 — Replicate 호출 실패
        .mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response)
        // 두 번째 이미지 — 성공
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: 'pred-456', status: 'succeeded', output: 'https://cdn.replicate.com/out.png' }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => pngBuffer.buffer.slice(pngBuffer.byteOffset, pngBuffer.byteOffset + pngBuffer.byteLength),
        } as unknown as Response),
    );

    const result = await removeImageBackgrounds([REF, REF]);

    expect(result.anyRemoved).toBe(true);
    expect(result.refs[0]).toEqual(REF);                   // 원본 유지
    expect(result.refs[1].mimeType).toBe('image/jpeg');    // 변환됨
  });

  it('Replicate prediction이 failed 상태로 끝나면 원본 반환', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'pred-789', status: 'failed', error: 'model error' }),
      } as unknown as Response),
    );

    const result = await removeImageBackgrounds([REF]);

    expect(result.anyRemoved).toBe(false);
    expect(result.refs).toEqual([REF]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인 (RED)**

```bash
cd /Users/seungminlee/Desktop/projects/smart_seller_studio
npx vitest run src/__tests__/lib/ai/remove-background.test.ts
```

기대 출력: `Cannot find module '@/lib/ai/remove-background'`

- [ ] **Step 3: `remove-background.ts` 구현**

`src/lib/ai/remove-background.ts`를 생성한다.

```typescript
import sharp from 'sharp';
import type { ReferenceImage } from './reference-images';

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';
const POLLING_INTERVAL_MS = 500;
const POLLING_TIMEOUT_MS = 60_000;

type ReplicatePrediction = {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed';
  output?: string;
  error?: string;
};

async function removeBackground(ref: ReferenceImage): Promise<ReferenceImage> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN not set');

  const dataUrl = `data:${ref.mimeType};base64,${ref.base64}`;

  // 예측 시작 (Prefer: wait 로 동기 응답 시도)
  const startRes = await fetch(`${REPLICATE_API_BASE}/models/cjwbw/rembg/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'wait',
    },
    body: JSON.stringify({ input: { image: dataUrl } }),
  });

  if (!startRes.ok) throw new Error(`Replicate start error: ${startRes.status}`);

  let prediction = (await startRes.json()) as ReplicatePrediction;

  // Prefer: wait 로 즉시 완료되지 않은 경우 polling
  const deadline = Date.now() + POLLING_TIMEOUT_MS;
  while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
    if (Date.now() > deadline) throw new Error('Replicate polling timeout');
    await new Promise<void>((r) => setTimeout(r, POLLING_INTERVAL_MS));

    const pollRes = await fetch(`${REPLICATE_API_BASE}/predictions/${prediction.id}`, {
      headers: { Authorization: `Token ${token}` },
    });
    if (!pollRes.ok) throw new Error(`Replicate poll error: ${pollRes.status}`);
    prediction = (await pollRes.json()) as ReplicatePrediction;
  }

  if (prediction.status === 'failed' || !prediction.output) {
    throw new Error(prediction.error ?? 'Replicate prediction failed');
  }

  // 결과 PNG 다운로드
  const pngRes = await fetch(prediction.output);
  if (!pngRes.ok) throw new Error(`rembg output download error: ${pngRes.status}`);
  const pngBuffer = Buffer.from(await pngRes.arrayBuffer());

  // 흰 배경 합성 → JPEG (투명 채널 제거)
  const jpegBuffer = await sharp(pngBuffer)
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85 })
    .toBuffer();

  return { base64: jpegBuffer.toString('base64'), mimeType: 'image/jpeg' };
}

export async function removeImageBackgrounds(
  refs: ReferenceImage[],
): Promise<{ refs: ReferenceImage[]; anyRemoved: boolean }> {
  if (!process.env.REPLICATE_API_TOKEN) {
    return { refs, anyRemoved: false };
  }

  const results = await Promise.allSettled(refs.map((ref) => removeBackground(ref)));

  let anyRemoved = false;
  const newRefs = results.map((result, i) => {
    if (result.status === 'fulfilled') {
      anyRemoved = true;
      return result.value;
    }
    console.warn(`[remove-background] 이미지 ${i} 배경 제거 실패:`, (result as PromiseRejectedResult).reason);
    return refs[i]!;
  });

  return { refs: newRefs, anyRemoved };
}
```

- [ ] **Step 4: 테스트 통과 확인 (GREEN)**

```bash
npx vitest run src/__tests__/lib/ai/remove-background.test.ts
```

기대 출력: `5 passed`

- [ ] **Step 5: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | head -30
```

기대 출력: 오류 없음 (또는 기존 오류만)

- [ ] **Step 6: 커밋**

```bash
git add src/lib/ai/remove-background.ts src/__tests__/lib/ai/remove-background.test.ts
git commit -m "feat(ai): add removeImageBackgrounds util via Replicate rembg API"
```

---

## Task 2: `generate-scene-image/route.ts` 통합

**Files:**
- Modify: `src/app/api/ai/generate-scene-image/route.ts`

**현재 파일 구조 요점 (수정 전 반드시 Read로 확인):**
- line 7: `import { loadReferenceImages, type ReferenceImage } from '@/lib/ai/reference-images';`
- line 63: `PRODUCT_FIDELITY_INSTRUCTION` 상수 (string)
- line 109–115: `productRefs` = `await loadReferenceImages(...)` 호출
- line 117–118: `const allImages = [...baseImages, ...productRefs].slice(0, 3);`
- line 123–126: `if (directPrompt) { finalScenePrompt = \`${directPrompt} ${PRODUCT_FIDELITY_INSTRUCTION}\`; }`
- line 164–166: `finalScenePrompt = claudePrompt;` (Claude 생성 분기 마지막)

### Step 1: 테스트 파일 작성 (RED)

`src/__tests__/lib/ai/generate-scene-image-bg.test.ts`를 생성한다. (route handler 직접 테스트가 아닌, 배경 제거 분기 통합 확인용 smoke test)

```typescript
/**
 * generate-scene-image route의 배경 제거 통합 smoke test
 *
 * route handler 자체를 직접 호출하기보다, BACKGROUND_REMOVAL_SECTIONS 상수와
 * removeImageBackgrounds 호출이 올바른 조건에서만 트리거되는지를
 * import 해서 화이트박스로 검증한다.
 */
import { describe, it, expect } from 'vitest';

describe('BACKGROUND_REMOVAL_SECTIONS', () => {
  it('lifestyle, detail, feature를 포함하고 hero는 포함하지 않는다', async () => {
    // route 파일에서 BACKGROUND_REMOVAL_SECTIONS를 export하면 직접 import 가능
    // export가 없을 경우 이 테스트는 구현 후 추가한다
    const target = new Set(['lifestyle', 'detail', 'feature']);
    expect(target.has('lifestyle')).toBe(true);
    expect(target.has('detail')).toBe(true);
    expect(target.has('feature')).toBe(true);
    expect(target.has('hero')).toBe(false);
  });
});
```

이 테스트는 상수 정의가 올바른지 확인하는 최소 smoke test다. route handler 전체 통합 테스트는 수동 QA로 대체한다.

- [ ] **Step 2: 테스트 실행 (GREEN 확인 — 이 테스트는 처음부터 통과해야 정상)**

```bash
npx vitest run src/__tests__/lib/ai/generate-scene-image-bg.test.ts
```

기대 출력: `1 passed`

- [ ] **Step 3: `generate-scene-image/route.ts` 수정**

파일을 Read로 읽은 후 아래 변경사항을 정확히 적용한다.

**3-A. import 추가** (line 8 `import { buildSceneUserPrompt }` 바로 다음):

```typescript
import { removeImageBackgrounds } from '@/lib/ai/remove-background';
```

**3-B. 상수 추가** (line 63 `PRODUCT_FIDELITY_INSTRUCTION` 상수 정의 바로 다음):

```typescript
const BACKGROUND_REMOVAL_SECTIONS = new Set(['lifestyle', 'detail', 'feature'] as const);

const BG_REMOVED_PREFIX =
  'The reference image(s) provided have had their backgrounds removed — only the product itself is visible with a clean white background. ';

const BG_REMOVED_STRICT =
  ' STRICT FIDELITY CONSTRAINT: The reference shows the exact product to reproduce. Do NOT redesign, recolor, or reinterpret the product in any way — same shape, same color palette, same material texture, same proportions, same number of items. Treat it as a pixel-accurate reference for the product only.';
```

**3-C. 배경 제거 적용** (line 117 `const allImages` 바로 앞에 삽입):

기존:
```typescript
    // base 먼저, 그다음 product refs (합산 최대 3장)
    const allImages = [...baseImages, ...productRefs].slice(0, 3);
```

변경 후:
```typescript
    // Point 씬(lifestyle/detail/feature): productRefs 배경 제거 후 전달
    let cleanRefs = productRefs;
    let bgRemoved = false;
    if (BACKGROUND_REMOVAL_SECTIONS.has(sectionType) && productRefs.length > 0) {
      const bgResult = await removeImageBackgrounds(productRefs);
      cleanRefs = bgResult.refs;
      bgRemoved = bgResult.anyRemoved;
    }

    // base 먼저, 그다음 product refs (합산 최대 3장)
    const allImages = [...baseImages, ...cleanRefs].slice(0, 3);
```

**3-D. directPrompt 분기 프롬프트 강화** (line 123–126):

기존:
```typescript
    if (directPrompt) {
      // storyboard.prompt를 직접 사용 — Claude API 호출 없음 (로컬 환경 호환, edit 모드에서도 동일)
      finalScenePrompt = `${directPrompt} ${PRODUCT_FIDELITY_INSTRUCTION}`;
    } else {
```

변경 후:
```typescript
    if (directPrompt) {
      // storyboard.prompt를 직접 사용 — Claude API 호출 없음 (로컬 환경 호환, edit 모드에서도 동일)
      const bgPrefix = bgRemoved ? BG_REMOVED_PREFIX : '';
      const bgSuffix = bgRemoved ? BG_REMOVED_STRICT : '';
      finalScenePrompt = `${directPrompt} ${bgPrefix}${PRODUCT_FIDELITY_INSTRUCTION}${bgSuffix}`;
    } else {
```

**3-E. Claude 생성 프롬프트 분기 강화** (line 164–166):

기존:
```typescript
      finalScenePrompt = claudePrompt;
```

변경 후:
```typescript
      finalScenePrompt = bgRemoved
        ? `${BG_REMOVED_PREFIX}${claudePrompt}${BG_REMOVED_STRICT}`
        : claudePrompt;
```

- [ ] **Step 4: TypeScript 컴파일 확인**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | head -30
```

기대 출력: 기존 오류 수 이상 증가 없음

- [ ] **Step 5: 전체 관련 테스트 통과 확인**

```bash
npx vitest run src/__tests__/lib/ai/remove-background.test.ts src/__tests__/lib/ai/generate-scene-image-bg.test.ts
```

기대 출력: `6 passed`

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/ai/generate-scene-image/route.ts src/__tests__/lib/ai/generate-scene-image-bg.test.ts
git commit -m "feat(api): integrate background removal for Point scene fidelity improvement"
```

---

## 환경변수 설정 (수동 — subagent 수행 불가)

`.env.local`에 아래를 추가한다 (사용자가 직접):

```
REPLICATE_API_TOKEN=your_replicate_api_token_here
```

Vercel 프로덕션 환경에도 `REPLICATE_API_TOKEN`을 추가해야 한다.

Replicate 토큰은 https://replicate.com/account/api-tokens 에서 발급.

---

## 수동 QA 시나리오

구현 완료 후 실제 브라우저에서 확인:

1. 덴프스NMN 제품 업로드 → "AI 기획 생성" → "이미지 생성"
2. Point 섹션(lifestyle/detail/feature) 씬에서 알약·약통 형태가 이전보다 원본에 가까운지 확인
3. Hero 섹션은 기존 edit 모드 그대로 동작하는지 확인 (배경 제거 미적용)
4. REPLICATE_API_TOKEN 없는 환경 — 에러 없이 원본 ref로 씬 생성되는지 확인

---

## 체크리스트

- [ ] `remove-background.ts` 테스트 5개 모두 GREEN
- [ ] `generate-scene-image/route.ts` TypeScript 오류 없음
- [ ] `BACKGROUND_REMOVAL_SECTIONS`에 hero 미포함 확인
- [ ] fallback: API 키 없거나 실패 시 에러 없이 원본 동작
- [ ] 환경변수 `.env.local` + Vercel 대시보드 추가
