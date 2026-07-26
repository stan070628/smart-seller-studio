# PRO 인물 착용컷 (model_wearing) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PRO 상세페이지에 한국인 모델 착용컷을 `beat`별로 배치한다. 얼굴이 보이는 컷과 얼굴을 뺀 크롭 컷을 각각 최소 1장.

**Architecture:** 새 `slotType: 'model_wearing'`이 새 `sectionType: 'wearing'`으로 라우팅된다. `wearing`을 `COMPOSITE_SECTIONS`에 넣지 않는 것만으로 누끼 합성을 건너뛰고 제품 참조가 Gemini에 직접 전달되므로, 기존 합성 경로는 코드가 바뀌지 않는다. 프롬프트는 시험 35장으로 확정된 블록을 상수로 고정한다.

**Tech Stack:** TypeScript, Zod, Gemini `gemini-2.5-flash-image`, Vitest, Next.js App Router

**설계 문서:** `docs/superpowers/specs/2026-07-26-pro-model-wearing-design.md`

---

## 중요: 테스트 실행 규칙

**인자 없이 `npx vitest run`을 실행하지 말 것.** 이 저장소는 라이브러리 테스트까지 함께 돌아 대량의 선재 실패가 나오며 회귀 판단이 불가능해진다. **항상 경로를 지정한다.**

---

## 시작 전에 읽어라 — 계획 수립 중 확인한 코드 사실 5가지

계획을 쓰면서 실제 코드를 확인했고, 스펙의 전제 몇 개가 현실과 달랐다. 아래는 확인된 사실이며 각 태스크가 이것을 전제로 한다.

**① `wearing`은 이미 `PRODUCT_FIDELITY_INSTRUCTION`으로 끝나는 프롬프트를 받는다.**
`route.ts:512-514`에서 `compositeProductPng`가 없으면 `finalScenePrompt = claudePrompt`이고, `SCENE_PROMPT_SYSTEM`(58행)이 Claude에게 *"프롬프트는 반드시 이 지시로 끝나야 한다"*고 요구한다. 따라서 **`buildWearingInstruction`에 `PRODUCT_FIDELITY_INSTRUCTION`을 포함시키면 중복된다.** Task 2는 그것을 넣지 않는다.

**② `realBySection`은 손댈 필요가 없다.**
`page.tsx:1272`의 `findIndex`가 이미 `flux_lifestyle`/`detail_closeup`만 본다. `model_wearing`은 자동으로 실사진 override 대상이 아니다. 스펙 ⑦은 코드 변경 없이 이미 만족된다 — Task 6이 이것을 주석으로 고정한다.

**③ 대신 `page.tsx:1376`에 두 번째 `genSlotIdx`가 있다.**
이쪽은 렌더 조립용이며 역시 두 타입을 하드코딩한다. **여기에 `model_wearing`을 추가하지 않으면 이미지가 생성·업로드까지 되고도 어느 슬롯에도 들어가지 않아 화면에서 사라진다.** 조용히 실패하는 지점이므로 Task 6의 핵심이다.

**④ 생성 실패 처리는 이미 완비돼 있다.**
`page.tsx:1408` `if (genSlotIdx >= 0 && !geminiUrl)` → `fallbackSections++` + `stripCloseupClaims`. 슬롯 자리는 `chosen ?? ''`로 원본 제품 이미지가 채운다. 스펙 ⑨의 "이미지 없이 렌더"보다 나은 동작이다. **단, `CLOSEUP_MARKERS`(`image-hygiene.ts:37`)에 착용 표현이 없어** 착용컷이 실패하면 "모델이 입은" 류 문구가 제품컷 위에 거짓으로 남는다 — Task 7이 이것을 막는다.

**⑤ `image` 블록은 `width`를 지원한다.**
`section-renderer.ts:757` `const width = block.width ?? '100%'`. 또한 `page.tsx:1379-1390`이 슬롯별로 `attachedImages`를 만들되 `idx === genSlotIdx && geminiUrl`인 슬롯만 AI 씬을 받고 나머지는 `imageRef` 제품 이미지를 받으므로, **한 섹션에 `model_wearing` + `product_nukki`를 두면 병치가 자동으로 성립한다.**

---

## 스펙에서 개선한 것

설계 문서 §3②는 인물 수위와 성별을 `promptHint` 안에 자연어로 담는 방식이었다(`"한국 20대 후반 남성, 해변 산책, 얼굴 보이는 상반신"`). 그리고 §3③이 그 한계를 이미 인정했다 — *"수위가 promptHint 안에 자연어로 들어가므로 결정론적 판정이 어렵다."*

**이 계획은 `imageSlots`에 필드 두 개를 추가한다:**

```ts
faceVisible?: boolean;              // true=얼굴 보이는 컷, false=크롭 컷
modelGender?: 'male' | 'female';    // 모델 성별
```

이유: 서버가 `FACE_VISIBLE`/`FACE_CROPPED`와 `MODEL_KO.male`/`MODEL_KO.female` 중 무엇을 넣을지 골라야 하는데, 자연어 파싱은 조용히 실패한다. `compare_pair` 스펙이 `beforeHint` 필드를 추가한 것과 같은 패턴이라 일관성도 맞는다.

`beat` 기반 기본값은 그대로 유효하다 — **`CLAUDE_SYSTEM`이 "hook·solution·usecase에는 `faceVisible: true`"를 안내**하고, 검증은 개수만 본다.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/app/api/ai/generate-scene-image/prompts.ts` (생성) | 프롬프트 상수 단일 출처. 기존 8개 이동 + 인물 블록 신설 |
| `src/app/api/ai/generate-scene-image/route.ts` (수정) | `wearing` sectionType, 인물 옵션 수신, 상수는 import |
| `src/app/api/ai/generate-scene-image/user-prompt.ts` (수정) | `buildSceneUserPrompt`에 wearing 방향. Task 1에서 `prompt.ts`를 리네임했다 — `prompts.ts`와 한 글자 차이로 혼동됐다 |
| `src/lib/detail-page/layout-validator.ts` (수정) | `imageSlots` 2필드, `wearing_coverage` |
| `src/lib/detail-page/image-hygiene.ts` (수정) | 폴백 시 착용 주장 위생 |
| `src/lib/ai/repair-pro-layout.ts` (수정) | `wearing_coverage` 수리 지시 |
| `src/app/api/ai/generate-pro-layout/system-prompt.ts` (수정) | N6 규칙 |
| `src/app/api/ai/generate-pro-layout/route.ts` (수정) | `wearing` 플래그 |
| `src/app/listing/[id]/detail-maker-pro/page.tsx` (수정) | 결선 3곳, 요청 필드, AI 고지 |

`route.ts`는 현재 607줄이고 프롬프트 상수 8개 + 누끼 검증 + 합성 + Claude 호출을 한 곳에서 한다. 인물 프롬프트를 더하면 700줄을 넘으므로 **Task 1에서 상수를 먼저 분리한다.** 커밋 `15aa8450`이 `PRODUCT_FIDELITY_INSTRUCTION` 중복 사본을 제거한 이력이 있어 단일 출처를 확보하는 의미도 있다.

---

## Task 1: 프롬프트 상수를 `prompts.ts`로 분리 (동작 무변경)

순수 리팩터링이다. 새 기능을 넣기 전에 파일을 정리한다.

**Files:**
- Create: `src/app/api/ai/generate-scene-image/prompts.ts`
- Modify: `src/app/api/ai/generate-scene-image/route.ts`

- [ ] **Step 1: 이동 대상을 확인한다**

`route.ts`에서 아래를 `prompts.ts`로 옮긴다. **문자열 내용을 한 글자도 바꾸지 마라** — 실물 생성으로 검증된 프롬프트다.

| 심볼 | 현재 위치 | route.ts에서 계속 참조? |
|---|---|---|
| `PRODUCT_FIDELITY_INSTRUCTION` | 44 | 예 (452, 509, 511행) |
| `SCENE_PROMPT_SYSTEM` | 46 | 예 (462행) |
| `BACKGROUND_PROMPT_SYSTEM` | 72 | 예 (462행) |
| `NO_PRODUCT_BASE` | 95 | 아니오 (`buildNoProductSuffix` 내부) |
| `SECTION_BG_HINTS` | 104 | 아니오 |
| `NO_CATEGORY_PROPS` | 122 | 아니오 |
| `buildNoProductSuffix` | 127 부근 | 예 (453, 513행) |
| `COMPOSITE_REFINE_PROMPT` | 236 | 예 |

`SCENE_PROMPT_SYSTEM`이 템플릿 리터럴 안에서 `${PRODUCT_FIDELITY_INSTRUCTION}`을 보간하므로(58행) **선언 순서를 유지하라** — `PRODUCT_FIDELITY_INSTRUCTION`이 먼저 와야 한다.

- [ ] **Step 2: `prompts.ts`를 만든다**

파일 상단에 목적을 적는다:

```ts
/**
 * generate-scene-image 프롬프트 단일 출처.
 *
 * 여기 있는 문자열은 실물 생성으로 검증된 것이다. 문구를 약화시키면 결과가 달라지므로
 * 수정 전에 반드시 실제 생성으로 재검증할 것. 특히 NOT ~ 형태의 부정문은
 * "AI가 수렴하는 기본값을 배제"하는 역할이며, 긍정 지시로 대체하면 효과가 사라진다.
 *
 * 선언 순서 주의: SCENE_PROMPT_SYSTEM이 PRODUCT_FIDELITY_INSTRUCTION을 보간한다.
 */
```

`route.ts`가 참조하는 5개(`PRODUCT_FIDELITY_INSTRUCTION`·`SCENE_PROMPT_SYSTEM`·`BACKGROUND_PROMPT_SYSTEM`·`COMPOSITE_REFINE_PROMPT`·`buildNoProductSuffix`)를 `export`한다. `NO_PRODUCT_BASE`·`SECTION_BG_HINTS`·`NO_CATEGORY_PROPS`는 `buildNoProductSuffix` 내부 전용이므로 module-private로 두어 공개 표면을 좁힌다.

- [ ] **Step 3: `route.ts`에서 import로 교체한다**

```ts
import {
  PRODUCT_FIDELITY_INSTRUCTION,
  SCENE_PROMPT_SYSTEM,
  BACKGROUND_PROMPT_SYSTEM,
  COMPOSITE_REFINE_PROMPT,
  buildNoProductSuffix,
} from './prompts';
```

옮긴 선언을 `route.ts`에서 삭제한다. `NO_PRODUCT_BASE`·`SECTION_BG_HINTS`·`NO_CATEGORY_PROPS`는 `buildNoProductSuffix` 내부 전용이므로 import하지 않는다 — 단, **삭제 후 `route.ts`에 남은 참조가 없는지 확인하라:**

```bash
grep -n "NO_PRODUCT_BASE\|SECTION_BG_HINTS\|NO_CATEGORY_PROPS" src/app/api/ai/generate-scene-image/route.ts
```

Expected: 출력 없음. 있으면 그 심볼도 import에 추가한다.

- [ ] **Step 4: 동작이 바뀌지 않았는지 확인한다**

```bash
npx vitest run src/__tests__/api/ai/
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "generate-scene-image"
```

Expected: 기존 테스트 전부 통과, tsc 출력 없음

- [ ] **Step 5: 줄 수를 확인한다**

```bash
wc -l src/app/api/ai/generate-scene-image/route.ts src/app/api/ai/generate-scene-image/prompts.ts
```

Expected: route.ts가 약 510~520줄로 줄어든다 (8개 심볼이 약 101줄, import 블록 7줄 추가 → 607 − 101 + 7 ≈ 513)

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/ai/generate-scene-image/prompts.ts src/app/api/ai/generate-scene-image/route.ts
git commit -m "refactor(scene): 프롬프트 상수를 prompts.ts로 분리

route.ts가 607줄이고 인물 프롬프트를 더하면 700줄을 넘는다.
문자열 내용은 변경하지 않았다."
```

---

## Task 2: 인물 프롬프트 블록 추가

시험 35장으로 확정된 문구를 상수화한다.

**Files:**
- Modify: `src/app/api/ai/generate-scene-image/prompts.ts`
- Test: `src/__tests__/api/ai/wearing-prompts.test.ts`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/__tests__/api/ai/wearing-prompts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  MODEL_KO,
  MODEL_CONTEXT,
  FACE_VISIBLE,
  FACE_CROPPED,
  COLOR_ACCURACY,
  POSE_STATIC,
  PRODUCT_FIDELITY_INSTRUCTION,
  buildWearingInstruction,
} from '@/app/api/ai/generate-scene-image/prompts';

describe('인물 프롬프트 상수', () => {
  it('MODEL_KO는 성별 두 키를 갖는다', () => {
    expect(Object.keys(MODEL_KO).sort()).toEqual(['female', 'male']);
  });

  it('MODEL_CONTEXT에 중국·서양 카탈로그 배제 문구가 있다', () => {
    // "Korean"만으로는 범아시아 평균으로 수렴한다 — 이 부정문이 핵심
    expect(MODEL_CONTEXT).toContain('not a Western or Chinese catalog');
  });

  it('COLOR_ACCURACY에 골든아워 금지가 있다', () => {
    // 골든아워가 화이트 민소매를 살구색으로 만든 것을 막는다
    expect(COLOR_ACCURACY).toContain('NOT golden hour');
  });

  it('POSE_STATIC에 동적 포즈 금지가 있다', () => {
    // 달리기·점프에서 손이 뭉개진다
    expect(POSE_STATIC).toContain('NO running');
  });

  it('FACE_VISIBLE과 FACE_CROPPED는 서로 배타적인 지시다', () => {
    expect(FACE_VISIBLE).toContain('PORTRAIT');
    expect(FACE_CROPPED).toContain('COMPLETELY OUTSIDE the frame');
  });
});

describe('buildWearingInstruction', () => {
  it('얼굴 보이는 컷에 FACE_VISIBLE이 들어간다', () => {
    const out = buildWearingInstruction({ faceVisible: true, gender: 'male' });
    expect(out).toContain(FACE_VISIBLE);
    expect(out).not.toContain(FACE_CROPPED);
  });

  it('크롭 컷에 FACE_CROPPED가 들어간다', () => {
    const out = buildWearingInstruction({ faceVisible: false, gender: 'male' });
    expect(out).toContain(FACE_CROPPED);
    expect(out).not.toContain(FACE_VISIBLE);
  });

  it('성별에 맞는 모델 서술만 들어간다', () => {
    const m = buildWearingInstruction({ faceVisible: true, gender: 'male' });
    const f = buildWearingInstruction({ faceVisible: true, gender: 'female' });
    expect(m).toContain(MODEL_KO.male);
    expect(m).not.toContain(MODEL_KO.female);
    expect(f).toContain(MODEL_KO.female);
    expect(f).not.toContain(MODEL_KO.male);
  });

  it('색 보존·포즈 제약·모델 맥락은 항상 포함된다', () => {
    for (const faceVisible of [true, false]) {
      for (const gender of ['male', 'female'] as const) {
        const out = buildWearingInstruction({ faceVisible, gender });
        expect(out).toContain(COLOR_ACCURACY);
        expect(out).toContain(POSE_STATIC);
        expect(out).toContain(MODEL_CONTEXT);
      }
    }
  });

  it('성별이 없으면 male을 기본으로 쓴다', () => {
    expect(buildWearingInstruction({ faceVisible: true })).toContain(MODEL_KO.male);
  });

  it('PRODUCT_FIDELITY_INSTRUCTION을 포함하지 않는다', () => {
    // route.ts:512-514 — wearing은 compositeProductPng가 없어 claudePrompt를 쓰고,
    // SCENE_PROMPT_SYSTEM(58행)이 그 프롬프트를 이 지시로 끝내라고 요구한다.
    // 여기서 또 붙이면 같은 문단이 두 번 들어간다.
    const out = buildWearingInstruction({ faceVisible: true, gender: 'male' });
    expect(out).not.toContain(PRODUCT_FIDELITY_INSTRUCTION);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/__tests__/api/ai/wearing-prompts.test.ts`
Expected: FAIL — `MODEL_KO` 등이 export되지 않음

- [ ] **Step 3: `prompts.ts`에 인물 블록을 추가한다**

파일 끝에 추가한다:

```ts
// ── 인물 착용컷 (sectionType: 'wearing') ──────────────────────────────
//
// 아래 문구는 실물 35장 생성으로 확정한 것이다. 특히 NOT ~ 부정문은
// "AI가 수렴하는 기본값을 명시적으로 배제"하는 역할이며, 시험에서 세 번 확인됐다:
//   NOT a tidy product lineup  → 정돈된 목업 대신 실제로 어질러진 씬
//   NOT golden hour            → 화이트가 살구색이 되는 것을 막음
//   not a Chinese catalog      → 범아시아 평균 대신 한국 화보
// 긍정 지시로 대체하면 효과가 사라진다.

/** 모델 세팅. "Korean"만 쓰면 범아시아 평균으로 수렴한다 */
export const MODEL_KO = {
  male:
    'a Korean man in his late twenties with a clean modern Korean haircut — softly layered, ' +
    'natural black hair, fair even skin tone, slim build',
  female:
    'a Korean woman in her late twenties with long straight black hair, natural dewy Korean makeup, ' +
    'fair even skin tone, slim build',
} as const;

export const MODEL_CONTEXT =
  'Styled like a Korean lifestyle magazine editorial shot in Seoul, not a Western or Chinese catalog.';

/**
 * 얼굴 포함. "editorial photo"/"catalog photograph" 같은 표현은 제품 중심 크롭을
 * 유도해 역효과였다 — 인물 사진임을 명시해야 얼굴이 나온다.
 */
export const FACE_VISIBLE =
  'A candid lifestyle PORTRAIT — this is a photo OF THE PERSON, not a product shot. ' +
  'The head and face occupy the upper third of the frame, eyes meeting the camera, ' +
  'an easy natural smile. Waist-up composition.';

/** 얼굴 제외. 팔이 어깨 아래일 때만 안정적이다 (POSE_STATIC과 함께 써야 한다) */
export const FACE_CROPPED =
  'FRAMING IS CRITICAL: the frame starts at the collarbone and ends at the hips — ' +
  'the head and face are COMPLETELY OUTSIDE the frame, not visible at all.';

/** 제품 색 보존. 골든아워에서 화이트 민소매가 살구색으로 렌더된 것을 막는다 */
export const COLOR_ACCURACY =
  'COLOR ACCURACY IS CRITICAL: neutral daylight with accurate white balance. ' +
  "The garment's color must match the reference image exactly — a white garment renders as pure white. " +
  'NOT golden hour, NOT sunset, NOT warm color cast.';

/**
 * 포즈 제약. 동적 포즈는 손을 뭉개고(프레임 배제 지시도 통하지 않았다)
 * 팔을 들면 프레임 기준이 밀려 크롭이 깨진다.
 */
export const POSE_STATIC =
  'POSE CONSTRAINTS: both arms stay BELOW shoulder height — never raised, never overhead. ' +
  'Hands hang naturally relaxed with open fingers or rest in pockets — never clenched into fists. ' +
  'The person stands, leans or walks slowly — NO running, NO jumping, NO mid-action motion.';

export interface WearingOpts {
  faceVisible: boolean;
  gender?: 'male' | 'female';
}

/**
 * 인물 착용컷 지시를 조립한다. finalScenePrompt 뒤에 붙인다.
 *
 * PRODUCT_FIDELITY_INSTRUCTION은 넣지 않는다 — wearing은 COMPOSITE_SECTIONS에
 * 없어 claudePrompt 경로를 타고, SCENE_PROMPT_SYSTEM이 그 프롬프트를 이미
 * 그 지시로 끝내게 만든다. 여기서 또 붙이면 중복된다.
 * (그 지시의 POSITIVE SUBJECT·NO SPARKLE MARKS 조항이 인물 씬에도 적용된다.)
 */
export function buildWearingInstruction({ faceVisible, gender = 'male' }: WearingOpts): string {
  return [
    `The person is ${MODEL_KO[gender]}.`,
    MODEL_CONTEXT,
    faceVisible ? FACE_VISIBLE : FACE_CROPPED,
    POSE_STATIC,
    COLOR_ACCURACY,
  ].join(' ');
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/__tests__/api/ai/wearing-prompts.test.ts`
Expected: PASS — 11 tests (상수 describe 5개 + `buildWearingInstruction` describe 6개)

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/ai/generate-scene-image/prompts.ts src/__tests__/api/ai/wearing-prompts.test.ts
git commit -m "feat(wearing): 인물 착용컷 프롬프트 블록 추가

실물 35장 생성으로 확정한 문구. 부정문(NOT golden hour /
not a Chinese catalog)이 결정적이며 긍정 지시로 대체하면 효과가 사라진다."
```

---

## Task 3: `wearing` sectionType 추가

**Files:**
- Modify: `src/app/api/ai/generate-scene-image/route.ts`
- Modify: `src/app/api/ai/generate-scene-image/user-prompt.ts`
- Test: `src/__tests__/api/ai/wearing-route.test.ts`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/__tests__/api/ai/wearing-route.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSceneUserPrompt } from '@/app/api/ai/generate-scene-image/user-prompt';
import { SCENE_PROMPT_SYSTEM } from '@/app/api/ai/generate-scene-image/prompts';

describe('wearing 씬 프롬프트', () => {
  it('SCENE_PROMPT_SYSTEM에 wearing 섹션 방향이 있다', () => {
    expect(SCENE_PROMPT_SYSTEM).toContain('wearing:');
  });

  it('buildSceneUserPrompt가 wearing을 받아 힌트를 실어보낸다', () => {
    const out = buildSceneUserPrompt('wearing', { headline: '민소매 티셔츠' }, '해변 산책');
    expect(out).toContain('해변 산책');
    expect(out).toContain('민소매 티셔츠');
  });
});
```

> `buildSceneUserPrompt`의 실제 시그니처를 먼저 확인하라. 인자 순서나 옵션 객체 형태가 다르면 **테스트를 실제 시그니처에 맞춰라** — 시그니처를 바꾸지 마라.

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/__tests__/api/ai/wearing-route.test.ts`
Expected: FAIL — `SCENE_PROMPT_SYSTEM`에 `wearing:`이 없음

- [ ] **Step 3: `sectionType` enum에 `wearing`을 추가한다**

`route.ts` 18행:

```ts
  sectionType: z.enum(['hero', 'lifestyle', 'detail', 'feature', 'wearing']),
```

**`COMPOSITE_SECTIONS`(92행)는 건드리지 마라.** `wearing`이 거기 없어야 420행 `COMPOSITE_SECTIONS.has(sectionType)`가 false가 되어 누끼 합성을 건너뛰고, 445행 `allImages`에 제품 참조가 그대로 실린다. 그것이 이 설계의 전부다.

- [ ] **Step 4: 요청 스키마에 인물 옵션을 추가한다**

`RequestBodySchema`에 추가한다:

```ts
  /** wearing 전용: 얼굴이 보이는 컷인지. 기본 true */
  faceVisible: z.boolean().optional(),
  /** wearing 전용: 모델 성별. 기본 male */
  modelGender: z.enum(['male', 'female']).optional(),
```

391행의 구조 분해에 추가한다:

```ts
  const { sectionType, productInfo, sceneHint, scenePrompt: directPrompt, baseImageUrl, instruction,
          faceVisible, modelGender } = parsed.data;
```

- [ ] **Step 5: 인물 지시를 `finalScenePrompt`에 붙인다**

`finalScenePrompt`가 확정되는 곳은 두 갈래다 — `directPrompt` 분기(450~454행)와 Claude 분기(456~514행). **두 분기가 합류한 직후, 517행 `imagePrompt: finalScenePrompt` 로그보다 앞에** 한 번만 붙인다:

```ts
    // wearing은 인물 착용컷이므로 검증된 인물 지시(모델·수위·포즈·색보존)를 말미에 붙인다.
    // 두 분기(directPrompt / Claude) 합류 후에 한 번만 붙여 중복을 막는다.
    // 프롬프트 끝에 두는 이유: 뒤쪽 지시가 더 강하게 반영되고, claudePrompt가 이미
    // PRODUCT_FIDELITY_INSTRUCTION으로 끝나므로 그 뒤에서 프레이밍을 확정해야 한다.
    if (sectionType === 'wearing') {
      finalScenePrompt = `${finalScenePrompt} ${buildWearingInstruction({
        faceVisible: faceVisible ?? true,
        gender: modelGender,
      })}`;
    }
```

`finalScenePrompt`가 `let`으로 선언돼 있으므로(448행) 재할당이 가능하다. import도 추가한다:

```ts
import { /* ...기존... */, buildWearingInstruction } from './prompts';
```

- [ ] **Step 6: `SCENE_PROMPT_SYSTEM`에 wearing 방향을 추가한다**

`prompts.ts`의 `SCENE_PROMPT_SYSTEM` 안 "Section type directions" 목록에 한 줄 추가한다:

```
- wearing: A real person wearing or using the product in a believable everyday Korean setting. Static pose only — the person stands, leans, or walks slowly. The product must be reproduced faithfully from the reference image.
```

- [ ] **Step 7: `buildSceneUserPrompt`에 wearing을 반영한다**

`user-prompt.ts`를 읽고 `sectionType`을 문자열로 서술하는 부분이 있으면 `wearing`에 대응하는 서술을 추가한다. `sectionType`을 그대로 흘려보내기만 한다면 변경이 필요 없다 — 그 경우 이 스텝은 no-op이며, 그렇게 판단한 근거를 보고에 적어라.

- [ ] **Step 8: 테스트와 타입을 확인한다**

```bash
npx vitest run src/__tests__/api/ai/
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "generate-scene-image"
```

Expected: 전부 통과, tsc 출력 없음

- [ ] **Step 9: 커밋**

```bash
git add src/app/api/ai/generate-scene-image/ src/__tests__/api/ai/wearing-route.test.ts
git commit -m "feat(wearing): sectionType 'wearing' 추가 (비합성 경로)

COMPOSITE_SECTIONS에 넣지 않는 것만으로 누끼 합성을 건너뛰고 제품 참조가
Gemini에 직접 전달된다. 기존 합성 경로는 무변경."
```

---

## Task 4: 슬롯 스키마 + `wearing_coverage` 검증

**Files:**
- Modify: `src/lib/detail-page/layout-validator.ts`
- Test: `src/__tests__/lib/detail-page/wearing-coverage.test.ts`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/__tests__/lib/detail-page/wearing-coverage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateProLayout, sanitizeProLayout } from '@/lib/detail-page/layout-validator';

/** model_wearing 슬롯 n개를 서로 다른 섹션에 배치한 최소 레이아웃 */
function withWearing(n: number): Record<string, unknown>[] {
  const secs = Array.from({ length: 6 }, (_, i) => ({
    type: 'claude_layout',
    title: `섹션 ${i}`,
    blocks: [{ type: 'heading', text: `제목 ${i}`, size: 'xl' }],
    bgStyle: 'white',
  })) as Record<string, unknown>[];
  for (let i = 0; i < n; i++) {
    secs[i]!.imageSlots = [
      { slotType: 'model_wearing', promptHint: '해변 산책', faceVisible: i === 0, modelGender: 'male' },
    ];
  }
  return secs;
}

describe('wearing_coverage', () => {
  it('플래그가 꺼져 있으면 검증하지 않는다', () => {
    const res = validateProLayout(withWearing(1));
    expect(res.violations.some(v => v.code === 'wearing_coverage')).toBe(false);
  });

  it('0개는 통과한다 — 인물이 부적절한 상품은 0개가 정답', () => {
    const res = validateProLayout(withWearing(0), { wearing: true });
    expect(res.violations.some(v => v.code === 'wearing_coverage')).toBe(false);
  });

  it('1개면 위반 — 얼굴 컷과 크롭 컷이 각각 필요하다', () => {
    const res = validateProLayout(withWearing(1), { wearing: true });
    expect(res.violations.some(v => v.code === 'wearing_coverage')).toBe(true);
  });

  it('2개는 통과한다', () => {
    const res = validateProLayout(withWearing(2), { wearing: true });
    expect(res.violations.some(v => v.code === 'wearing_coverage')).toBe(false);
  });

  it('3개도 통과한다', () => {
    const res = validateProLayout(withWearing(3), { wearing: true });
    expect(res.violations.some(v => v.code === 'wearing_coverage')).toBe(false);
  });

  it('위반은 error 등급이라 repair를 트리거한다', () => {
    const res = validateProLayout(withWearing(1), { wearing: true });
    const v = res.violations.find(x => x.code === 'wearing_coverage');
    expect(v?.severity).toBe('error');
    expect(res.isClean).toBe(false);
  });
});

describe('imageSlots 신규 필드', () => {
  it('faceVisible과 modelGender가 스키마 위반이 아니다', () => {
    const res = validateProLayout(withWearing(2), { wearing: true });
    expect(res.violations.some(v => v.code === 'schema')).toBe(false);
  });

  it('sanitize를 거쳐도 두 필드가 보존된다', () => {
    const { sections } = sanitizeProLayout(withWearing(2));
    const slot = (sections[0] as { imageSlots: Record<string, unknown>[] }).imageSlots[0]!;
    expect(slot.faceVisible).toBe(true);
    expect(slot.modelGender).toBe('male');
  });

  it('modelGender에 잘못된 값이 오면 schema 위반', () => {
    const secs = withWearing(2);
    (secs[0]!.imageSlots as Record<string, unknown>[])[0]!.modelGender = 'other';
    const res = validateProLayout(secs, { wearing: true });
    expect(res.violations.some(v => v.code === 'schema')).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/__tests__/lib/detail-page/wearing-coverage.test.ts`
Expected: FAIL — `wearing` 옵션과 `wearing_coverage` code가 없음

- [ ] **Step 3: `Violation` code union에 `'wearing_coverage'`를 추가한다**

파일을 열어 기존 union 멤버를 확인하고 `'wearing_coverage'`만 더한다. **다른 멤버를 지우지 마라** — 사용자가 최근 `option_image` 작업으로 멤버를 추가했다.

- [ ] **Step 4: `ProLayoutOpts`에 플래그를 추가한다**

```ts
  /** 인물 착용컷 커버리지 검증 — 생성 경로 전용 (statHygiene·narrative와 같은 선례) */
  wearing?: boolean;
```

- [ ] **Step 5: `imageSlots` 스키마에 두 필드를 추가한다**

`zClaudeSection`의 `imageSlots` 항목 객체에 추가한다. **기존 필드를 지우지 마라:**

```ts
    // model_wearing 전용. 자연어 promptHint를 파싱하면 조용히 실패하므로 필드로 받는다.
    faceVisible: z.boolean().optional(),
    modelGender: z.enum(['male', 'female']).optional(),
```

- [ ] **Step 6: 검증을 결선한다**

`validateProLayout`에서 `narrative` 블록(380행 부근) 다음에 삽입한다:

```ts
  // ── 인물 착용컷 커버리지 (생성 경로 전용) ──
  // 1개면 위반: 얼굴 보이는 컷과 크롭 컷의 역할이 달라 둘 다 필요하다.
  //   얼굴 컷은 표정으로 "입고 싶다"를 만들고, 크롭 컷은 시선을 제품에 붙잡아 핏을 보여준다.
  // 0개는 통과: 인물이 부적절한 상품(위생용품·속옷·의료기기)은 0개가 정답이며,
  //   카테고리를 하드코딩하지 않고도 "Claude가 필요하다고 판단했으면 2개"가 강제된다.
  if (opts?.wearing) {
    let wearingSlots = 0;
    for (const sec of sections) {
      const slots = (sec as { imageSlots?: unknown }).imageSlots;
      if (!Array.isArray(slots)) continue;
      for (const sl of slots) {
        if (sl && typeof sl === 'object' && (sl as { slotType?: unknown }).slotType === 'model_wearing') {
          wearingSlots += 1;
        }
      }
    }
    if (wearingSlots === 1) {
      violations.push({
        code: 'wearing_coverage',
        path: 'sections',
        message:
          '인물 착용컷이 1개입니다. 얼굴이 보이는 컷(faceVisible: true)과 얼굴을 뺀 크롭 컷(faceVisible: false)이 각각 필요하므로 2개 이상으로 만드세요.',
        severity: 'error',
        autoFixable: false,
      });
    }
  }
```

`Violation` 객체의 필드 이름은 파일의 실제 인터페이스를 보고 맞춰라(`autoFixable` 등이 없으면 빼라).

- [ ] **Step 7: 테스트와 회귀를 확인한다**

```bash
npx vitest run src/__tests__/lib/detail-page/wearing-coverage.test.ts
npx vitest run src/__tests__/lib/detail-page/
```

Expected: 신규 9개 통과, 기존 전부 통과

**기존 테스트가 깨지면**: `wearing` 플래그 게이트가 빠졌는지 확인하라. 플래그 없이 검증하면 `imageSlots`를 쓰는 기존 fixture가 영향받는다.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/detail-page/layout-validator.ts src/__tests__/lib/detail-page/wearing-coverage.test.ts
git commit -m "feat(wearing): 슬롯 스키마 2필드 + wearing_coverage 검증

1개면 위반, 0개는 통과. 인물이 부적절한 상품은 Claude가 0개로 두면
되므로 카테고리 하드코딩 없이 최소 2장이 강제된다."
```

---

## Task 5: `CLAUDE_SYSTEM`에 N6 규칙 추가

**Files:**
- Modify: `src/app/api/ai/generate-pro-layout/system-prompt.ts`
- Modify: `src/lib/ai/repair-pro-layout.ts`

- [ ] **Step 1: slotType 목록에 `model_wearing`을 추가한다**

14행의 `imageSlots` 스키마 예시에 새 필드를 넣고:

```
  "imageSlots": [{"slotType": "flux_lifestyle"|"product_nukki"|"detail_closeup"|"model_wearing", "promptHint": "...", "imageRef": 0, "faceVisible": true, "modelGender": "male"}]
```

16행 부근 slotType 설명에 추가한다:

```
model_wearing=사람이 제품을 착용·사용한 씬(AI 생성). faceVisible로 얼굴 노출을, modelGender로 모델 성별을 지정한다.
```

- [ ] **Step 2: NARRATIVE 블록에 N6을 추가한다**

N5 다음, `${BENCHMARK_PATTERNS}` 앞에 삽입한다:

```
N6. 인물 착용컷(model_wearing) — 착용·사용이 구매 결정을 좌우하는 상품(의류·잡화·신발·
    가방·액세서리·스포츠용품)이면 서로 다른 섹션에 최소 2개를 두세요. 하나는 얼굴이
    보이는 컷(faceVisible: true), 하나는 얼굴을 뺀 크롭 컷(faceVisible: false)입니다.
    둘의 역할이 달라 하나만 있으면 절반이 빕니다 — 얼굴 컷은 표정으로 "입고 싶다"를
    만들고, 크롭 컷은 시선을 제품에 붙잡아 핏·마감을 보여줍니다.
    - hook·solution·usecase 비트 → faceVisible: true
    - detail·evidence 비트 → faceVisible: false
    - modelGender는 사이즈 표기와 카피에서 타깃을 읽어 정하세요.
      예: M(95)~XXL(110)이면 male, S/M/L에 여성 카피면 female.
    - 한 섹션에 model_wearing은 하나만 두세요. 섹션당 AI 씬은 1장만 생성됩니다.
    - promptHint에는 [상황]만 쓰세요. 모델 외형·프레이밍·조명·포즈는 시스템이 붙이므로
      거기에 겹쳐 쓰면 충돌합니다.
      예: "여름 해변 보드워크 산책", "밝은 실내 짐에서 수건을 목에 걸치고 서 있는 모습"
    - 두 씬의 상황이 겹치면 안 됩니다.
    - 동작이 큰 장면을 쓰지 마세요 — 달리기·점프·팔을 머리 위로 드는 동작은 손과
      프레임이 망가집니다. 서 있거나 기대거나 천천히 걷는 장면만 쓰세요.
    - 조명에 색을 넣지 마세요 — 노을·골든아워는 제품 색을 물들입니다.
    - problem 비트에는 인물을 쓰지 마세요 (D3: 문제 상황은 카피로 말합니다).
    - 인물이 부적절한 상품(위생용품·속옷·의료기기 등)은 0개로 두세요. 1개는 안 됩니다.
```

**`promptHint`에 상황만 쓰게 하는 것이 중요하다.** 모델 외형·프레이밍·조명·포즈는 검증된 상수가 붙이므로, Claude가 거기에 지시를 겹쳐 쓰면 충돌한다.

- [ ] **Step 3: `repair-pro-layout.ts`에 `wearing_coverage` 수리 지시를 추가한다**

`wearing_coverage`는 `severity: 'error'`이므로 repair 패스가 돌지만, 규칙 7의 per-violation 지시에 항목이 없으면 무엇을 고칠지 모른다. 규칙 7에 추가한다:

```
- wearing_coverage: model_wearing 슬롯이 1개뿐입니다. 다른 섹션에 하나를 더 만드세요.
  기존 것이 faceVisible: true면 새것은 false로(detail 또는 evidence 비트 섹션에),
  기존 것이 false면 새것은 true로(hook 또는 usecase 비트 섹션에) 두세요.
  두 씬의 상황(promptHint)이 겹치면 안 됩니다. 기존 슬롯을 삭제하지 마세요.
```

- [ ] **Step 4: 정합성을 직접 확인한다**

`src/app/api/ai/generate-scene-image/prompts.ts`를 읽고 대조하라:

- N6이 안내하는 `faceVisible` 의미가 `buildWearingInstruction`의 분기와 일치하는가?
- N6의 "동작 금지"가 `POSE_STATIC`의 실제 금지 항목과 일치하는가?
- N6의 "조명 색 금지"가 `COLOR_ACCURACY`와 일치하는가?
- N6이 `promptHint`에 상황만 쓰라고 했는데, `buildWearingInstruction`이 실제로 모델·프레이밍·조명·포즈를 다 붙이는가?

**어긋나면 프롬프트를 임의로 바꾸지 말고 어긋난 사실을 보고하라.** 상수는 시험으로 검증된 것이다.

- [ ] **Step 5: 빌드 확인**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "system-prompt|repair-pro-layout"
npx vitest run src/__tests__/api/generate-pro-layout.test.ts
```

Expected: tsc 출력 없음. `CLAUDE_SYSTEM`은 템플릿 리터럴이므로 백틱·`${}` 손상에 주의하라.

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/ai/generate-pro-layout/system-prompt.ts src/lib/ai/repair-pro-layout.ts
git commit -m "feat(wearing): CLAUDE_SYSTEM N6 규칙 + repair 지시

promptHint에는 상황만 쓰게 한다 — 모델 외형·프레이밍·조명은
검증된 상수가 붙이므로 겹쳐 쓰면 충돌한다."
```

---

## Task 6: `page.tsx` 결선

**세 곳을 고쳐야 하고, 셋 중 하나라도 빠지면 조용히 실패한다.**

**Files:**
- Modify: `src/app/listing/[id]/detail-maker-pro/page.tsx`
- Modify: `src/app/api/ai/generate-pro-layout/route.ts`

- [ ] **Step 1: `GeneratedSection` 타입에 두 필드를 추가한다**

15~19행 부근:

```ts
  imageSlots?: Array<{
    slotType: string;
    promptHint?: string;
    imageRef?: number;
    faceVisible?: boolean;
    modelGender?: 'male' | 'female';
  }>;
```

- [ ] **Step 2: `isGenSlot`에 `model_wearing`을 추가한다** (1283행)

```ts
              const isGenSlot = (t?: string) =>
                t === 'flux_lifestyle' || t === 'detail_closeup' || t === 'model_wearing';
```

- [ ] **Step 3: `sceneTypeFor`에 매핑을 추가한다** (1286행)

```ts
              // 슬롯 타입 → 씬 타입: detail_closeup은 매크로 접사('detail'),
              // model_wearing은 인물 착용컷('wearing', 비합성 경로), 그 외 라이프스타일.
              const sceneTypeFor = (t?: string) =>
                t === 'detail_closeup' ? 'detail'
                : t === 'model_wearing' ? 'wearing'
                : 'lifestyle';
```

- [ ] **Step 4: 요청 바디에 인물 옵션을 전달한다** (1322행 부근)

`sectionType: sceneTypeFor(slot?.slotType),` 바로 아래에 추가한다:

```ts
                        // wearing 전용: 얼굴 노출과 모델 성별.
                        // 자연어 sceneHint로는 서버가 수위를 판정할 수 없어 필드로 보낸다.
                        ...(slot?.slotType === 'model_wearing' && {
                          faceVisible: slot.faceVisible ?? true,
                          modelGender: slot.modelGender,
                        }),
```

- [ ] **Step 5: 렌더 조립부의 두 번째 `genSlotIdx`를 고친다** (1376행)

**이것이 가장 놓치기 쉬운 지점이다.** 1376행은 생성 루프와 별개로 렌더용 슬롯 위치를 다시 계산하며, 여기에 `model_wearing`이 없으면 이미지는 생성·업로드까지 되지만 **어느 슬롯에도 들어가지 않아 화면에서 사라진다.**

```ts
              // 생성 씬(flux_lifestyle · detail_closeup · model_wearing)을 만든 슬롯 위치에 넣는다.
              const genSlotIdx = slots.findIndex(
                sl => sl.slotType === 'flux_lifestyle'
                   || sl.slotType === 'detail_closeup'
                   || sl.slotType === 'model_wearing',
              );
```

- [ ] **Step 6: `realBySection`(1272행)은 고치지 않는다 — 주석만 남긴다**

1272행의 `findIndex`는 `flux_lifestyle`/`detail_closeup`만 본다. **의도된 상태다.** shot-guide는 `detail_closeup` 슬롯만 촬영 카드로 만들므로 업로드 사진은 전부 제품 접사이고, 그것이 인물 씬 자리를 먹으면 "모델 착용컷이 없다"는 원래 문제가 그대로 돌아온다.

`model_wearing`을 **추가하지 않았음을** 확인하고, 나중에 "일관성"을 이유로 누가 추가하지 않게 주석을 남겨라:

```ts
            // 실사진 override: 업로드된 detail_closeup이 그 섹션의 targeting gen 슬롯(genSlotIdx)일 때만.
            // model_wearing은 의도적으로 제외한다 — shot-guide는 detail_closeup만 촬영 카드로
            // 만들므로 업로드 사진은 전부 제품 접사이고, 그것이 인물 씬 자리를 먹으면 안 된다.
            const realBySection: Record<number, string> = {};
```

- [ ] **Step 7: 생성 라우트에 `wearing` 플래그를 켠다**

`src/app/api/ai/generate-pro-layout/route.ts`의 `layoutOpts` 두 분기 **모두**에 `wearing: true`를 추가한다(`optionMode` 삼항의 양쪽):

```ts
  const layoutOpts = optionMode
    ? { statHygiene: true, narrative: true, wearing: true, provenanceSource, optionNameByImageIndex: ... }
    : { statHygiene: true, narrative: true, wearing: true, provenanceSource };
```

- [ ] **Step 8: 타입과 테스트를 확인한다**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "detail-maker-pro|generate-pro-layout"
npx vitest run src/__tests__/api/generate-pro-layout.test.ts src/__tests__/lib/detail-page/
```

Expected: tsc 출력 없음, 테스트 전부 통과

**기존 라우트 테스트가 깨지면**: fixture에 `model_wearing` 슬롯이 1개만 있으면 `wearing_coverage` error가 나 repair 분기로 들어간다. fixture를 확인해 0개 또는 2개로 맞춘다.

- [ ] **Step 9: 커밋**

```bash
git add "src/app/listing/[id]/detail-maker-pro/page.tsx" src/app/api/ai/generate-pro-layout/route.ts
git commit -m "feat(wearing): model_wearing 결선 (생성·씬타입·렌더 3곳)

1376행의 렌더용 genSlotIdx가 별개로 존재한다 — 여기를 빠뜨리면
이미지가 생성·업로드되고도 화면에서 사라진다.
realBySection은 의도적으로 제외하며 그 이유를 주석으로 남겼다."
```

---

## Task 7: 병치 + AI 고지 + 폴백 위생

제품 재현이 좋아도 완벽하지 않고 스파클 글리프가 간헐적으로 새어나온다(12장 중 2장). 구매자가 실물을 대조할 수 있어야 하고, 생성이 실패했을 때 카피가 거짓이 되면 안 된다.

**Files:**
- Modify: `src/lib/detail-page/image-hygiene.ts`
- Modify: `src/app/listing/[id]/detail-maker-pro/page.tsx`
- Modify: `src/app/api/ai/generate-pro-layout/system-prompt.ts`
- Test: `src/__tests__/lib/detail-page/wearing-hygiene.test.ts`

- [ ] **Step 1: 폴백 위생 — 실패하는 테스트를 작성한다**

`model_wearing` 생성이 실패하면 슬롯은 원본 제품컷으로 채워지는데(`page.tsx:1389` `chosen ?? ''`), `CLOSEUP_MARKERS`에 착용 표현이 없어 "모델이 입은 모습입니다" 류 문구가 제품컷 위에 거짓으로 남는다.

`src/__tests__/lib/detail-page/wearing-hygiene.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stripCloseupClaims } from '@/lib/detail-page/image-hygiene';

describe('stripCloseupClaims — 착용 주장 (wearing 옵션)', () => {
  const blocks = [
    { type: 'heading', text: '시원한 여름', size: 'xl' },
    { type: 'subtext', text: '모델이 착용한 모습입니다. 사이즈는 95부터 110까지 있습니다.' },
  ];

  it('옵션이 없으면 착용 문구를 건드리지 않는다', () => {
    const out = stripCloseupClaims(blocks);
    expect(JSON.stringify(out.blocks)).toContain('모델이 착용한 모습입니다');
  });

  it('wearing 옵션이면 착용 주장 문장만 제거한다', () => {
    const out = stripCloseupClaims(blocks, { wearing: true });
    const json = JSON.stringify(out.blocks);
    expect(json).not.toContain('모델이 착용한 모습입니다');
    // 같은 블록의 다른 문장은 보존한다
    expect(json).toContain('사이즈는 95부터 110까지');
    expect(out.removed).toBeGreaterThan(0);
  });

  it('접사 주장은 옵션과 무관하게 계속 제거한다', () => {
    const closeup = [{ type: 'subtext', text: '같은 조명에서 촬영한 접사입니다.' }];
    expect(JSON.stringify(stripCloseupClaims(closeup).blocks)).not.toContain('접사입니다');
    expect(
      JSON.stringify(stripCloseupClaims(closeup, { wearing: true }).blocks),
    ).not.toContain('접사입니다');
  });

  it('일반적인 착용 안내는 지우지 않는다', () => {
    // "착용" 자체가 아니라 "이 사진에 사람이 있다"는 주장만 대상이다
    const generic = [{ type: 'subtext', text: '착용 후 세탁기로 세탁하세요.' }];
    const out = stripCloseupClaims(generic, { wearing: true });
    expect(JSON.stringify(out.blocks)).toContain('착용 후 세탁기로');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/__tests__/lib/detail-page/wearing-hygiene.test.ts`
Expected: FAIL — `stripCloseupClaims`가 두 번째 인자를 받지 않음

- [ ] **Step 3: `image-hygiene.ts`에 착용 마커를 추가한다**

`CLOSEUP_MARKERS`(37행) 다음에 추가한다:

```ts
/**
 * "이 사진에 사람이 있다"고 주장하는 표현. model_wearing 슬롯이 생성 실패로 원본
 * 제품컷으로 대체되면 이 문장들이 거짓이 된다(접사 주장과 같은 문제, 같은 메커니즘).
 *
 * 좁게 잡는다. "착용"만으로 잡으면 "착용 후 세탁하세요" 같은 멀쩡한 안내를 지운다 —
 * 사진에 인물이 있다는 주장으로 읽히는 형태만 대상이다.
 */
const WEARING_MARKERS = /모델이|착용한 모습|착용컷|입은 모습|입고 있는|들고 있는|사용하는 모습/;

export function hasWearingClaim(text: string): boolean {
  return typeof text === 'string' && WEARING_MARKERS.test(text);
}
```

- [ ] **Step 4: `stripCloseupClaims`에 옵션을 추가한다**

`hasCloseupClaim`을 직접 부르던 자리를 옵션 인식 판정으로 바꾼다. `dropCloseupSentences`도 같은 판정을 써야 한다:

```ts
export interface StripOpts {
  /** model_wearing 슬롯이 있던 섹션이면 true — 착용 주장도 함께 제거한다 */
  wearing?: boolean;
}

export function stripCloseupClaims(blocks: unknown, opts?: StripOpts): CloseupStripResult {
  const isClaim = (t: string) =>
    hasCloseupClaim(t) || (opts?.wearing === true && hasWearingClaim(t));
  // ...이하 walk 내부의 hasCloseupClaim 호출을 isClaim으로 바꾼다 (heading·subtext·bullet_list 3곳)
```

`dropCloseupSentences`가 모듈 스코프 함수이므로 판정을 인자로 받게 고쳐라:

```ts
function dropClaimSentences(text: string, isClaim: (t: string) => boolean): string {
  const parts = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim() !== '');
  const kept = parts.filter((s) => !isClaim(s));
  return kept.join(' ').trim();
}
```

**기존 `hasCloseupClaim` export를 유지하라** — 다른 곳에서 쓸 수 있다.

- [ ] **Step 5: `page.tsx`에서 옵션을 넘긴다** (1409행)

```ts
              if (genSlotIdx >= 0 && !geminiUrl) {
                fallbackSections++;
                // 인물 씬이 실패해 제품컷으로 대체되면 "모델이 착용한" 류 문구도 거짓이 된다.
                const wasWearing = slots[genSlotIdx]?.slotType === 'model_wearing';
                const stripped = stripCloseupClaims(blocks, { wearing: wasWearing });
                blocks = stripped.blocks as LayoutBlock[];
```

- [ ] **Step 6: 병치 규칙을 N6에 추가한다**

`section-renderer.ts:757`이 `block.width ?? '100%'`를 지원하고, `page.tsx:1379-1390`이 `genSlotIdx` 슬롯에만 AI 씬을 넣고 나머지 슬롯은 `imageRef` 제품 이미지를 넣으므로, 슬롯 두 개 + image 블록 두 개로 병치가 성립한다. N6 끝에 추가한다:

```
    - model_wearing 슬롯이 있는 섹션에는 product_nukki 슬롯을 하나 더 두고(model_wearing이
      배열의 첫 번째), blocks에 image 블록 2개를 배치하세요. 첫째는 착용컷(attachedIndex 0,
      width 생략), 둘째는 제품 단독컷(attachedIndex 1, "width": "45%")입니다. AI로 생성한
      착용컷과 실제 제품 사진을 같은 화면에서 대조할 수 있어야 합니다.
```

**`model_wearing`이 슬롯 배열의 첫 번째여야 한다** — `page.tsx`의 `findIndex`가 첫 gen 슬롯을 잡고, `attachedIndex 0`이 그 자리에 대응한다.

- [ ] **Step 7: AI 연출 고지를 추가한다**

`page.tsx`에서 `detailSections`를 만든 뒤, **하단 고정 프레임 이미지를 붙이는 지점보다 앞**에 삽입한다. 그 지점을 먼저 찾아라:

```bash
grep -n "detailSections" "src/app/listing/[id]/detail-maker-pro/page.tsx"
```

`detailSections`가 `generatedSections.map(...)`의 결과라 `const` 배열이면 `push`가 타입상 막힐 수 있다. 그 경우 새 배열을 만들어 이후 사용처 **한 곳만** 바꿔라:

```ts
            // AI 생성 착용컷이 있으면 연출 고지를 붙인다. 제품 재현이 좋아도
            // 스파클 글리프 같은 것이 간헐적으로 섞이므로(12장 중 2장) 구매자가 알 수 있어야 한다.
            const hasWearing = generatedSections.some(
              s => s.imageSlots?.some(sl => sl.slotType === 'model_wearing') ?? false,
            );
            const sectionsWithDisclosure = hasWearing
              ? [
                  ...detailSections,
                  {
                    type: 'claude_layout',
                    title: '이미지 안내',
                    blocks: [{
                      type: 'subtext',
                      text: '일부 이미지는 제품 연출을 위해 AI로 생성되었으며, 실제 제품과 다를 수 있습니다.',
                      align: 'left',
                    }],
                    bgStyle: 'light',
                  } as (typeof detailSections)[number],
                ]
              : detailSections;
```

이후 하단 프레임과 결합하는 곳에서 `detailSections` → `sectionsWithDisclosure`로 바꾼다.

- [ ] **Step 8: 확인한다**

```bash
npx vitest run src/__tests__/lib/detail-page/
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "detail-maker-pro|image-hygiene|system-prompt"
```

Expected: 신규 4개 통과, 기존 전부 통과, tsc 출력 없음

- [ ] **Step 9: 커밋**

```bash
git add src/lib/detail-page/image-hygiene.ts src/__tests__/lib/detail-page/wearing-hygiene.test.ts "src/app/listing/[id]/detail-maker-pro/page.tsx" src/app/api/ai/generate-pro-layout/system-prompt.ts
git commit -m "feat(wearing): 제품컷 병치 + AI 고지 + 폴백 시 착용문구 위생

인물 씬이 실패하면 제품컷으로 대체되는데 CLOSEUP_MARKERS에 착용 표현이
없어 착용 주장 문구가 거짓으로 남았다."
```

---

## Task 8: 실물 검증

자동화 테스트로는 "인물이 실제로 나오는가"를 확인할 수 없다.

**Files:** 없음 (수동 검증)

- [ ] **Step 1: 개발 서버를 확인한다**

`npm run dev`가 3000에서 돌고 있는지 확인한다. 없으면 띄운다.

- [ ] **Step 2: PRO 상세페이지를 생성한다**

민소매 티셔츠 리스팅(`46d297cb-7fb0-4ada-9070-a8a8e09509d4`)으로 생성한다. 핵심 포인트에 실측값을 포함시킨다(`가슴둘레 95cm부터 110cm까지` 등) — 그러면 `progress_bar` provenance도 함께 검증된다.

**PRO 플로우에는 중간에 "OCR 결과 확인" 화면이 있어 "생성 시작"을 두 번 눌러야 한다.** 첫 클릭 후 폴링만 하면 영원히 끝나지 않는다.

브라우저 작업은 `/browse` 스킬을 쓴다(`CLAUDE.md` 규칙 — `mcp__claude-in-chrome__*`는 쓰지 않는다). React가 `type` 속성을 렌더하지 않으므로 `input[type=text]` 셀렉터는 실패한다 — `input:not([type])`을 쓴다.

- [ ] **Step 3: 확인 항목**

| 항목 | 기대 |
|---|---|
| `model_wearing` 슬롯 개수 | 2개 이상 (또는 0개) |
| `faceVisible` 분포 | `true` 1개 이상 + `false` 1개 이상 |
| beat 배정 | `hook`·`solution`·`usecase`에 얼굴, `detail`·`evidence`에 크롭 |
| **렌더 반영** | 생성된 착용컷이 실제로 페이지에 보이는가 (Task 6 Step 5 검증) |
| 생성된 인물 | 한국인으로 보이는가. 중국·서양 카탈로그 느낌이 아닌가 |
| 제품 색 | 화이트가 화이트로 나오는가 (살구색·핑크 아님) |
| 포즈 | 동적 포즈가 없는가. 손이 뭉개지지 않았는가 |
| 크롭 컷 | 얼굴이 정말 프레임 밖인가 |
| 스파클 | ✦ 글리프가 옷·배경에 없는가 |
| 병치 | 착용컷 아래에 제품 단독컷이 45% 폭으로 있는가 |
| 연출 고지 | 하단 프레임 앞에 한 줄이 있는가 |
| 경고 배너 | `wearing_coverage` 경고가 떠 있지 않은가 |

- [ ] **Step 4: 어긋난 항목을 보고한다**

**테스트를 느슨하게 고치거나 프롬프트를 임의로 바꾸지 마라.** 무엇이 어긋났는지 보고하라. 상수는 시험 35장으로 검증된 것이므로, 실물에서 다르게 나오면 그 사실 자체가 정보다.

---

## 완료 확인

- [ ] `npx vitest run src/__tests__/lib/detail-page/ src/__tests__/api/ai/ src/__tests__/api/generate-pro-layout.test.ts` 전부 통과
- [ ] `npx tsc --noEmit`에서 이번에 만진 파일의 오류 없음
- [ ] `route.ts`가 Task 1 이후 520줄 이하 (Task 3이 약 15줄을 더한다)
- [ ] 실물 생성에서 한국인 모델 착용컷이 얼굴 컷 1장 + 크롭 컷 1장 이상 **화면에 보이는지**

## 이 계획의 범위 밖

- **Virtual Try-On** — 제품 재현이 충분히 좋아 1단계로 충분하다고 판단했다
- **동적 포즈** — 프롬프트로 해결 불가(4/4 실패)
- **스파클 글리프 자동 검증** — vision 판정 후 재생성이 가능하나 호출이 늘어난다. 실사용 빈도를 보고 결정한다
- **`compare_pair`** — 별도 스펙(`2026-07-26-pro-compare-pair-image-design.md`)
- **비의류 카테고리** — 화장품 "손에 든 튜브" 같은 형태는 미검증
- **마켓플레이스 AI 인물 정책** — 미확인. 연출 고지로 완화하되 정책 확인은 별건
- **`buildNoProductSuffix` 테스트** — Task 1에서 module-private에서 export로 바뀌며 테스트 가능해졌다(그전에는 핸들러 전체를 호출해야 했다). `productName?.trim()` 항등 절과 `SECTION_BG_HINTS[sectionType] ?? ''` 폴백에 분기가 있어 고정할 가치가 있으나, 이 계획의 범위가 아니다
- **`SECTION_BG_HINTS`의 타입 좁히기** — 현재 `Record<string, string>`이라 아무 키나 받고 미스는 `?? ''`로 조용히 넘어간다. `tsconfig`의 `noUncheckedIndexedAccess`가 꺼져 있어 타입 검사도 못 잡는다. `wearing`이 안전한 이유는 `COMPOSITE_SECTIONS`에 없어 `buildNoProductSuffix`에 도달하지 않기 때문이며, 타입으로 강제된 것이 아니다
