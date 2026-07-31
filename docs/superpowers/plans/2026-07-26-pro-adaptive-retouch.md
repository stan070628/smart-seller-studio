# PRO 실사진 적응형 보정 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 촬영 가이드로 업로드한 실사진 보정을 고정 파라미터에서 이미지 통계 기반 적응형으로 바꾼다.

**Architecture:** `sharp().stats()`로 얻은 채널 평균·최대·표준편차·선명도에서 보정 계수를 계산하는 **순수 함수**를 분리하고, 라우트는 그 계수를 sharp 파이프라인에 넣기만 한다. 계산이 순수 함수라 sharp 없이 테스트할 수 있고, LLM을 쓰지 않아 Phase 4의 결정론 원칙이 유지된다.

**Tech Stack:** TypeScript, sharp 0.34.5, Vitest, Next.js App Router

**설계 문서:** `docs/superpowers/specs/2026-07-26-pro-adaptive-retouch-design.md`

---

## 중요: 테스트 실행 규칙

**인자 없이 `npx vitest run`을 실행하지 말 것.** 라이브러리 테스트까지 함께 돌아 대량의 선재 실패가 나온다. **항상 경로를 지정한다.**

---

## 이 계획이 다루지 않는 것 (설계에서 확정된 범위 제한)

- **배경 정리·교체** — `extractDetailCloseupShots`(`src/lib/detail-page/shot-guide.ts:6~16`)가 `slotType === 'detail_closeup'`만 추출하므로 **모든 ShootSlot은 접사다.** 접사에 누끼를 돌리는 것은 무의미하다. shot-guide가 전체컷 슬롯을 만들도록 확장되는 3단계에서 다룬다.
- **기울기·수평 보정** — 접사에는 수평선이 없어 ROI가 없다.
- **페이지 톤 매칭의 클라이언트 연결** — PRO 페이지는 draft 저장 시 `theme: {}`를 보내고(`page.tsx:290`) 색상은 렌더 시점에 결정된다. **보정 시점에는 페이지 톤을 알 수 없다.** 따라서 `pageTone` 파라미터와 계산 로직은 만들어두되 클라이언트는 값을 보내지 않으며, 기본 `'neutral'`로 동작한다. 테마가 보정 시점에 확정되는 구조가 되면 그때 연결한다.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/lib/image/adaptive-retouch.ts` (생성) | 이미지 통계 → 보정 계수 계산. 순수 함수, sharp 의존 없음 |
| `src/app/api/ai/retouch-photo/route.ts` (수정) | stats 수집 + 계수 적용. 요청 스키마 확장 |

계산을 라우트에서 분리하는 이유: 계수 산출이 이 기능의 전부인데, sharp 파이프라인 안에 섞여 있으면 테스트하려고 실제 이미지를 만들어야 한다. 순수 함수로 빼면 숫자만으로 경계 조건을 전부 검증할 수 있다.

---

## Task 1: 보정 계수 계산 순수 모듈

**Files:**
- Create: `src/lib/image/adaptive-retouch.ts`
- Test: `src/__tests__/lib/image/adaptive-retouch.test.ts`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/__tests__/lib/image/adaptive-retouch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeRetouchParams, LEGACY_PARAMS, type StatsInput } from '@/lib/image/adaptive-retouch';

/** 적정 노출·중립색·보통 대비·적당한 선명도의 기준 입력 */
function baseStats(over: Partial<StatsInput> = {}): StatsInput {
  return {
    channelMeans: { r: 138, g: 138, b: 138 },
    maxChannelValue: 240,
    stdev: 55,
    sharpness: 3,
    ...over,
  };
}

describe('computeRetouchParams — 노출', () => {
  it('적정 노출이면 brightness가 1 근처 (사실상 무보정)', () => {
    const p = computeRetouchParams(baseStats());
    expect(p.brightness).toBeCloseTo(1, 2);
  });

  it('어두운 사진은 brightness > 1', () => {
    const p = computeRetouchParams(baseStats({ channelMeans: { r: 90, g: 90, b: 90 } }));
    expect(p.brightness).toBeGreaterThan(1);
  });

  it('밝은 사진은 brightness <= 1', () => {
    const p = computeRetouchParams(baseStats({ channelMeans: { r: 200, g: 200, b: 200 } }));
    expect(p.brightness).toBeLessThanOrEqual(1);
  });

  it('brightness는 상한을 넘지 않는다', () => {
    const p = computeRetouchParams(baseStats({ channelMeans: { r: 10, g: 10, b: 10 } }));
    expect(p.brightness).toBeLessThanOrEqual(1.35);
  });

  it('brightness는 하한 밑으로 내려가지 않는다', () => {
    const p = computeRetouchParams(baseStats({ channelMeans: { r: 250, g: 250, b: 250 } }));
    expect(p.brightness).toBeGreaterThanOrEqual(0.85);
  });

  it('하이라이트가 이미 날아간 사진은 더 밝히지 않는다', () => {
    // 평균은 어둡지만 max가 클리핑 근처 → 밝히면 하이라이트가 완전히 탄다
    const p = computeRetouchParams(baseStats({
      channelMeans: { r: 90, g: 90, b: 90 },
      maxChannelValue: 254,
    }));
    expect(p.brightness).toBeLessThanOrEqual(1);
  });
});

describe('computeRetouchParams — 화이트밸런스', () => {
  it('중립 이미지는 계수가 모두 1', () => {
    const p = computeRetouchParams(baseStats());
    expect(p.channelMultipliers[0]).toBeCloseTo(1, 3);
    expect(p.channelMultipliers[1]).toBeCloseTo(1, 3);
    expect(p.channelMultipliers[2]).toBeCloseTo(1, 3);
  });

  it('푸른 끼가 도는 사진은 R을 올리고 B를 내린다', () => {
    const p = computeRetouchParams(baseStats({ channelMeans: { r: 120, g: 138, b: 160 } }));
    expect(p.channelMultipliers[0]).toBeGreaterThan(1);
    expect(p.channelMultipliers[2]).toBeLessThan(1);
  });

  it('노란 끼가 도는 사진은 반대 방향', () => {
    const p = computeRetouchParams(baseStats({ channelMeans: { r: 165, g: 145, b: 110 } }));
    expect(p.channelMultipliers[0]).toBeLessThan(1);
    expect(p.channelMultipliers[2]).toBeGreaterThan(1);
  });

  it('강한 단색 제품이어도 계수가 clamp 범위를 벗어나지 않는다', () => {
    // 새빨간 원단이 프레임을 채운 경우 — gray-world 가정이 깨진다
    const p = computeRetouchParams(baseStats({ channelMeans: { r: 200, g: 40, b: 40 } }));
    p.channelMultipliers.forEach((m) => {
      expect(m).toBeGreaterThanOrEqual(0.9);
      expect(m).toBeLessThanOrEqual(1.1);
    });
  });

  it('채널 평균이 0이어도 NaN·Infinity가 나오지 않는다', () => {
    const p = computeRetouchParams(baseStats({ channelMeans: { r: 0, g: 0, b: 0 } }));
    p.channelMultipliers.forEach((m) => expect(Number.isFinite(m)).toBe(true));
    expect(Number.isFinite(p.brightness)).toBe(true);
  });
});

describe('computeRetouchParams — 채도', () => {
  it('대비가 낮은(흐린) 사진은 채도를 올린다', () => {
    const p = computeRetouchParams(baseStats({ stdev: 20 }));
    expect(p.saturation).toBeGreaterThan(1);
  });

  it('이미 선명한 사진은 채도를 올리지 않는다', () => {
    const p = computeRetouchParams(baseStats({ stdev: 80 }));
    expect(p.saturation).toBeCloseTo(1, 2);
  });

  it('채도는 상한을 넘지 않는다', () => {
    const p = computeRetouchParams(baseStats({ stdev: 0 }));
    expect(p.saturation).toBeLessThanOrEqual(1.15);
  });
});

describe('computeRetouchParams — 샤프닝', () => {
  it('흐린 사진에만 샤프닝을 건다', () => {
    const p = computeRetouchParams(baseStats({ sharpness: 0.5 }));
    expect(p.sharpenSigma).not.toBeNull();
  });

  it('이미 선명한 사진에는 샤프닝을 걸지 않는다', () => {
    const p = computeRetouchParams(baseStats({ sharpness: 5 }));
    expect(p.sharpenSigma).toBeNull();
  });
});

describe('computeRetouchParams — 페이지 톤', () => {
  it('warm 톤이면 중립 대비 R이 더 높다', () => {
    const neutral = computeRetouchParams(baseStats());
    const warm = computeRetouchParams(baseStats({ pageTone: 'warm' }));
    expect(warm.channelMultipliers[0]).toBeGreaterThan(neutral.channelMultipliers[0]);
    expect(warm.channelMultipliers[2]).toBeLessThan(neutral.channelMultipliers[2]);
  });

  it('cool 톤이면 반대 방향', () => {
    const neutral = computeRetouchParams(baseStats());
    const cool = computeRetouchParams(baseStats({ pageTone: 'cool' }));
    expect(cool.channelMultipliers[2]).toBeGreaterThan(neutral.channelMultipliers[2]);
  });

  it('톤 시프트를 넣어도 clamp 범위를 지킨다', () => {
    const p = computeRetouchParams(baseStats({
      channelMeans: { r: 120, g: 138, b: 160 },
      pageTone: 'warm',
    }));
    p.channelMultipliers.forEach((m) => {
      expect(m).toBeGreaterThanOrEqual(0.9);
      expect(m).toBeLessThanOrEqual(1.1);
    });
  });
});

describe('LEGACY_PARAMS', () => {
  it('기존 고정 파라미터와 동일하다', () => {
    expect(LEGACY_PARAMS).toEqual({
      brightness: 1.04,
      saturation: 1.06,
      channelMultipliers: [1, 1, 1],
      sharpenSigma: 0.6,
    });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/__tests__/lib/image/adaptive-retouch.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/image/adaptive-retouch"`

- [ ] **Step 3: 구현한다**

`src/lib/image/adaptive-retouch.ts`:

```ts
/**
 * 실사진 적응형 보정 계수 계산.
 *
 * sharp().stats()에서 얻은 이미지 통계로 보정 계수를 구한다. LLM을 쓰지 않으므로
 * "같은 입력 → 같은 결과"가 보장된다 (Phase 4의 결정론 원칙).
 *
 * 순수 함수만 두어 sharp 없이 경계 조건을 테스트할 수 있게 한다.
 */

export type PageTone = 'warm' | 'cool' | 'neutral';

export interface StatsInput {
  /** 채널별 평균 (0~255) */
  channelMeans: { r: number; g: number; b: number };
  /** 전체 채널 중 최대값 (0~255) — 하이라이트 클리핑 판정용 */
  maxChannelValue: number;
  /** 휘도 표준편차 — 대비 판정용 */
  stdev: number;
  /** sharp가 계산한 선명도 지표 */
  sharpness: number;
  /** 상세페이지 톤. 현재 클라이언트는 보내지 않으며 기본 neutral이다. */
  pageTone?: PageTone;
}

export interface RetouchParams {
  brightness: number;
  saturation: number;
  /** linear()에 넣을 채널별 계수 [R, G, B] */
  channelMultipliers: [number, number, number];
  /** null이면 샤프닝을 걸지 않는다 */
  sharpenSigma: number | null;
}

/** 기존 고정 파라미터 — mode='legacy'와 stats 실패 시 폴백 */
export const LEGACY_PARAMS: RetouchParams = {
  brightness: 1.04,
  saturation: 1.06,
  channelMultipliers: [1, 1, 1],
  sharpenSigma: 0.6,
};

// ── 튜닝 상수 ─────────────────────────────────────────────────────────
/** 목표 휘도. 이커머스 제품 접사 기준으로 중간톤보다 약간 밝게. 실물 튜닝 대상. */
const TARGET_LUMA = 138;
const BRIGHTNESS_MIN = 0.85;
const BRIGHTNESS_MAX = 1.35;

/** 이 값을 넘으면 하이라이트가 이미 클리핑 근처 → 더 밝히지 않는다 */
const HIGHLIGHT_CLIP_THRESHOLD = 250;

/** 화이트밸런스 계수 범위. 좁게 두어 제품 고유색 왜곡을 막는다. */
const WB_MIN = 0.9;
const WB_MAX = 1.1;

/** 페이지 톤 시프트 폭 (2%) */
const TONE_SHIFT = 0.02;

/** 대비 목표 표준편차. 이보다 낮으면 채도를 보강한다. */
const TARGET_STDEV = 55;
const SATURATION_MAX = 1.15;

/** 이 값 미만이면 흐린 사진으로 보고 샤프닝을 건다 */
const SHARPNESS_THRESHOLD = 2;
const SHARPEN_SIGMA = 0.6;

// ── 헬퍼 ─────────────────────────────────────────────────────────────
function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(max, Math.max(min, v));
}

/** ITU-R BT.709 휘도 */
function luma(m: { r: number; g: number; b: number }): number {
  return 0.2126 * m.r + 0.7152 * m.g + 0.0722 * m.b;
}

/**
 * 이미지 통계에서 보정 계수를 계산한다.
 * 어떤 입력에도 유한한 값을 반환한다 — NaN·Infinity는 중립값(1)으로 대체된다.
 */
export function computeRetouchParams(input: StatsInput): RetouchParams {
  const { channelMeans, maxChannelValue, stdev, sharpness, pageTone = 'neutral' } = input;

  // ── 노출 ──
  const l = luma(channelMeans);
  let brightness = l > 0 ? clamp(TARGET_LUMA / l, BRIGHTNESS_MIN, BRIGHTNESS_MAX) : 1;
  // 하이라이트가 이미 날아가 있으면 밝히지 않는다 (탄 영역이 더 넓어질 뿐)
  if (maxChannelValue >= HIGHLIGHT_CLIP_THRESHOLD) {
    brightness = Math.min(brightness, 1);
  }

  // ── 화이트밸런스 (gray-world) ──
  const gray = (channelMeans.r + channelMeans.g + channelMeans.b) / 3;
  const rawMultipliers: [number, number, number] =
    gray > 0
      ? [
          channelMeans.r > 0 ? gray / channelMeans.r : 1,
          channelMeans.g > 0 ? gray / channelMeans.g : 1,
          channelMeans.b > 0 ? gray / channelMeans.b : 1,
        ]
      : [1, 1, 1];

  // 페이지 톤 시프트 — clamp 전에 적용해 최종적으로 범위 안에 들어오게 한다
  const shift = pageTone === 'warm' ? TONE_SHIFT : pageTone === 'cool' ? -TONE_SHIFT : 0;
  const channelMultipliers: [number, number, number] = [
    clamp(rawMultipliers[0] * (1 + shift), WB_MIN, WB_MAX),
    clamp(rawMultipliers[1], WB_MIN, WB_MAX),
    clamp(rawMultipliers[2] * (1 - shift), WB_MIN, WB_MAX),
  ];

  // ── 채도 ──
  // 대비가 낮은(흐릿한) 사진만 보강한다. 이미 선명한 사진은 건드리지 않는다.
  const deficit = Math.max(0, TARGET_STDEV - stdev) / TARGET_STDEV;
  const saturation = clamp(1 + deficit * (SATURATION_MAX - 1), 1, SATURATION_MAX);

  // ── 샤프닝 ──
  // 폰 사진에는 이미 내부 샤프닝이 걸려 있어 중복하면 가장자리에 링잉이 생긴다.
  const sharpenSigma =
    Number.isFinite(sharpness) && sharpness < SHARPNESS_THRESHOLD ? SHARPEN_SIGMA : null;

  return { brightness, saturation, channelMultipliers, sharpenSigma };
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/__tests__/lib/image/adaptive-retouch.test.ts`
Expected: PASS — 19 tests

- [ ] **Step 5: 커밋**

```bash
git add src/lib/image/adaptive-retouch.ts src/__tests__/lib/image/adaptive-retouch.test.ts
git commit -m "feat(retouch): 이미지 통계 기반 보정 계수 계산 순수 모듈"
```

---

## Task 2: retouch-photo 라우트에 적응형 경로 결선

**Files:**
- Modify: `src/app/api/ai/retouch-photo/route.ts`

- [ ] **Step 1: 요청 스키마를 확장한다**

`route.ts:17`을 교체한다:

```ts
const RequestSchema = z.object({
  imageUrl: z.string().url(),
  /** 상세페이지 톤. 현재 클라이언트는 보내지 않으며, 향후 테마 확정 시 연결한다. */
  pageTone: z.enum(['warm', 'cool', 'neutral']).optional(),
  /** legacy = 기존 고정 파라미터 (탈출구·회귀 안전망) */
  mode: z.enum(['adaptive', 'legacy']).default('adaptive'),
});
```

- [ ] **Step 2: import를 추가한다**

`route.ts` 상단 import 블록에:

```ts
import { computeRetouchParams, LEGACY_PARAMS, type RetouchParams } from '@/lib/image/adaptive-retouch';
```

- [ ] **Step 3: 파싱된 값을 꺼낸다**

`route.ts:34`의 구조분해를 교체한다:

```ts
  const { imageUrl, pageTone, mode } = parsed.data;
```

- [ ] **Step 4: 보정 로직을 교체한다**

`route.ts:39~55`의 `try` 블록 안, 이미지 로드 이후부터 업로드 직전까지를 아래로 교체한다:

```ts
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`이미지 로드 실패 (${res.status})`);
    const inputBuf = Buffer.from(await res.arrayBuffer());

    // 보정 계수 결정. adaptive 모드에서 stats 수집이 실패하면 기존 고정값으로 폴백한다
    // — 현재 동작이 최저 보장선이다.
    let params: RetouchParams = LEGACY_PARAMS;
    if (mode === 'adaptive') {
      try {
        const stats = await sharp(inputBuf).stats();
        const [r, g, b] = stats.channels;
        if (r && g && b) {
          params = computeRetouchParams({
            channelMeans: { r: r.mean, g: g.mean, b: b.mean },
            maxChannelValue: Math.max(r.max, g.max, b.max),
            stdev: (r.stdev + g.stdev + b.stdev) / 3,
            sharpness: stats.sharpness,
            pageTone,
          });
        }
      } catch (statsErr) {
        console.warn('[retouch-photo] stats 수집 실패 — 고정 파라미터로 진행:', statsErr);
      }
    }

    // EXIF 회전 → 화이트밸런스(채널별) → 노출·채도 → (필요 시) 샤프닝
    let pipeline = sharp(inputBuf)
      .rotate()
      .linear(params.channelMultipliers, [0, 0, 0])
      .modulate({ brightness: params.brightness, saturation: params.saturation });

    if (params.sharpenSigma !== null) {
      pipeline = pipeline.sharpen({ sigma: params.sharpenSigma });
    }

    const outBuf = await pipeline.jpeg({ quality: 90 }).toBuffer();

    const path = `retouched/${Date.now()}.jpg`;
    const ab = outBuf.buffer.slice(outBuf.byteOffset, outBuf.byteOffset + outBuf.byteLength) as ArrayBuffer;
    const { url } = await uploadToStorage(path, ab, 'image/jpeg', outBuf.byteLength);
    return NextResponse.json({ success: true, url });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: '보정 중 오류가 발생했습니다.', _debug: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
```

> 응답 형태(`{ success, url }`)는 바뀌지 않는다. 클라이언트 `handleRetouch`(`page.tsx:396~413`)는 수정할 필요가 없다.

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "retouch-photo\|adaptive-retouch" | head -20`
Expected: 출력 없음

**`stats.sharpness`에서 타입 오류가 나면**: sharp 0.34의 `Stats` 타입에 `sharpness: number`가 있다. 오류가 나면 `sharp` 타입 정의 버전을 확인하고, 없으면 `(stats as { sharpness?: number }).sharpness ?? 0`으로 우회한다.

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/ai/retouch-photo/route.ts
git commit -m "feat(retouch): 고정 파라미터 → 이미지 통계 기반 적응형 보정"
```

---

## Task 3: 실물 검증

자동화 테스트로는 "자연스러움"을 판정할 수 없다. 눈으로 확인한다.

**Files:** 없음 (수동 검증)

- [ ] **Step 1: 개발 서버를 띄운다**

Run: `npm run dev`

- [ ] **Step 2: 조명이 다른 접사 사진 3장을 준비한다**

- 어두운 실내에서 찍은 것
- 형광등 아래에서 찍은 것 (초록·푸른 끼)
- 창가 자연광에서 찍은 것 (적정 노출)

- [ ] **Step 3: PRO 촬영 가이드에서 각각 업로드하고 "AI 보정"을 누른다**

before/after 프리뷰에서 확인할 것:

- 어두운 사진: 눈에 띄게 밝아지되 하이라이트가 타지 않았는가
- 형광등 사진: 색 끼가 걷혔는가. 제품 고유색이 바래지 않았는가
- 자연광 사진: **거의 변화가 없어야 한다.** 크게 변한다면 `TARGET_LUMA`가 잘못됐다

- [ ] **Step 4: 필요하면 튜닝한다**

전반적으로 너무 밝으면 `src/lib/image/adaptive-retouch.ts`의 `TARGET_LUMA`를 낮추고(예: 130), 개선이 체감되지 않으면 올린다(예: 145). 값을 바꾼 뒤 Task 1의 테스트를 다시 돌린다:

Run: `npx vitest run src/__tests__/lib/image/adaptive-retouch.test.ts`

**테스트가 깨지면**: `baseStats()`의 `channelMeans`가 `TARGET_LUMA`와 같은 값이어야 "적정 노출이면 brightness 1"이 성립한다. 상수를 바꿨으면 테스트 fixture도 같이 맞춘다.

- [ ] **Step 5: 튜닝 결과를 커밋한다**

```bash
git add src/lib/image/adaptive-retouch.ts src/__tests__/lib/image/adaptive-retouch.test.ts
git commit -m "tune(retouch): 실물 검증 기반 TARGET_LUMA 조정"
```

> 튜닝이 필요 없었다면 이 단계는 건너뛴다.

---

## 완료 확인

- [ ] `npx vitest run src/__tests__/lib/image/adaptive-retouch.test.ts` 통과
- [ ] `npx tsc --noEmit`에서 `retouch-photo`·`adaptive-retouch` 오류 없음
- [ ] 조명이 다른 사진 3장으로 before/after 육안 확인 완료
- [ ] 적정 노출 사진이 거의 변하지 않는지 확인 (과보정 방지의 핵심 지표)
- [ ] `mode: 'legacy'`로 호출하면 기존과 동일한 결과가 나오는지 확인

## 이 계획의 범위 밖

- 배경 정리·교체 — shot-guide 전체컷 슬롯 확장(3단계)이 선행돼야 함
- 기울기·수평 보정 — 접사에 수평선 없음
- 페이지 톤 매칭의 클라이언트 연결 — 보정 시점에 테마가 확정되지 않음
- 인물 컷 보정 — 인물 슬롯이 2단계 이후에 생김
- `retouched/` 고아 파일 정리 — 현행에도 있는 문제, 별도 과제
