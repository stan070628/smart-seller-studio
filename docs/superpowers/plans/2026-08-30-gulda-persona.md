# 굴다 페르소나 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `model_f_c`에 캐릭터 프로필(굴다)과 고정된 집(씬 시트)을 부여해, 발굴템 연구소 영상에서 같은 인물이 같은 공간에 반복 등장하게 만든다.

**Architecture:** 「누가」(model-registry)와 「어디서」(scene-registry)를 분리하고, 둘을 참조 3장 안에 배치하는 판단을 `reference-composer`가 전담한다. 프롬프트 조립 함수는 전부 순수 함수라 단위 테스트로 검증하고, 배경 고정이 실제로 되는지는 마지막 태스크에서 육안으로 검증한다.

**Tech Stack:** TypeScript · Next.js · vitest · Gemini(imagen.ts) · Supabase Storage

**Spec:** `docs/superpowers/specs/2026-08-30-gulda-persona-design.md`

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/ai/model-registry.ts` (수정) | 인물 — 페르소나 목록, 캐릭터 프로필, 말투 지시문 |
| `src/lib/ai/scene-registry.ts` (신규) | 공간 — 씬 목록, 씬 조회, URL 조립, 배경 고정 지시문 |
| `src/lib/ai/reference-composer.ts` (신규) | 배치 — 참조 3장 상한 안에서 무엇을 넣고 무엇을 강등할지 결정 |
| `src/lib/ai/__tests__/model-registry.test.ts` (신규) | 위 1의 테스트 |
| `src/lib/ai/__tests__/scene-registry.test.ts` (신규) | 위 2의 테스트 |
| `src/lib/ai/__tests__/reference-composer.test.ts` (신규) | 위 3의 테스트 |
| `scripts/_gulda_scene.ts` (신규) | 씬 시트 생성·검증 스크립트 |

`reference-composer`를 따로 둔 이유: 인물과 씬 어느 쪽에도 속하지 않는 **조정 책임**이고, 참조 상한이 바뀌면 이 파일만 고치면 된다.

---

## Task 1: CharacterProfile 타입과 굴다 프로필

**Files:**
- Modify: `src/lib/ai/model-registry.ts`
- Test: `src/lib/ai/__tests__/model-registry.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/ai/__tests__/model-registry.test.ts`를 새로 만든다.

```ts
// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { findPersona, MODEL_PERSONAS } from '../model-registry';

describe('CharacterProfile', () => {
  it('여성 C에 굴다 프로필이 붙어 있다', () => {
    const p = findPersona('model_f_c');
    expect(p?.character?.name).toBe('굴다');
    expect(p?.character?.title).toBe('발굴템 연구소 연구원');
  });

  it('나머지 페르소나는 character가 없어도 그대로 동작한다', () => {
    const others = MODEL_PERSONAS.filter((p) => p.id !== 'model_f_c');
    expect(others).toHaveLength(4);
    for (const p of others) {
      expect(p.character).toBeUndefined();
      expect(p.sheetPath).toMatch(/^model-sheets\//);
    }
  });

  it('굴다의 말투 규칙과 금지 표현이 비어 있지 않다', () => {
    const c = findPersona('model_f_c')!.character!;
    expect(c.voiceRules.length).toBeGreaterThan(0);
    expect(c.forbidden.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/lib/ai/__tests__/model-registry.test.ts`
Expected: FAIL — `character` 속성이 타입에 없어 타입 오류, 또는 `undefined`

- [ ] **Step 3: 타입과 프로필을 추가한다**

`src/lib/ai/model-registry.ts`의 `ModelSex` 타입 선언 바로 아래에 추가한다.

```ts
/**
 * 캐릭터 프로필 — 외모 프리셋에 정체성을 얹는다.
 *
 * MODEL_PERSONAS는 원래 얼굴만 고정했다. 유튜브 채널을 운영하려면 그 인물이
 * 누구인지가 필요하고, 그것이 영상 자막·카피의 말투까지 정한다.
 * 선택 필드인 이유는 5명 중 굴다부터 채우기 때문이다 — 나머지는 프리셋으로
 * 계속 동작해야 한다.
 */
export interface CharacterProfile {
  /** 이름 */
  name: string;
  /** 직함 — 채널 안에서의 위치 */
  title: string;
  /** 나이대 */
  ageBand: string;
  /** 한 줄 생활 배경 */
  setting: string;
  /** 말투 규칙 — buildCharacterVoice가 지시문으로 바꾼다 */
  voiceRules: string[];
  /** 금지 표현 */
  forbidden: string[];
}
```

`ModelPersona` 인터페이스에 필드 하나를 더한다.

```ts
export interface ModelPersona {
  /** 안정 식별자. Storage 파일명과 같아야 한다 */
  id: string;
  sex: ModelSex;
  /** UI에 보이는 이름 */
  label: string;
  /** 어떤 상품에 어울리는지 — 선택을 돕는 힌트 */
  bestFor: string;
  /** 캐릭터 시트 Storage 경로 (버킷 내부 경로) */
  sheetPath: string;
  /** 캐릭터 프로필. 없으면 외모 프리셋으로만 쓴다 */
  character?: CharacterProfile;
}
```

`MODEL_PERSONAS`의 `model_f_c` 항목에 `character`를 채운다. 다른 넷은 손대지 않는다.

```ts
  {
    id: 'model_f_c',
    sex: 'female',
    label: '여성 C · 건강 발랄',
    bestFor: '스포츠·아웃도어·식품 — 생기 있는 인상',
    sheetPath: 'model-sheets/model_f_c.jpg',
    character: {
      name: '굴다',
      title: '발굴템 연구소 연구원',
      ageBand: '30대 초반',
      setting: '코스트코 단골. 집이 주 무대이고 장보기·살림·정리가 일상이다. 잘 사는 사람이 아니라 사고 나서 후회도 하는 사람이다',
      voiceRules: [
        '높임말 구어체로 말한다 — ~잖아요, ~더라고요, ~거든요, ~네요',
        '문장 끝에 마침표를 찍지 않는다',
        '실패담과 후회를 숨기지 않는다. 좋은 점만 말하면 추천이 믿기지 않는다',
        '같은 어미를 세 번 연속 반복하지 않는다',
      ],
      forbidden: [
        '~습니다 정중체 (딱딱해진다)',
        '반말',
        '과장 단정 — 최고예요, 무조건, 강추',
        '번역투 — 소리 내 읽어서 걸리면 다시 쓴다',
        '부정문 제목',
      ],
    },
  },
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/lib/ai/__tests__/model-registry.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 커밋한다**

```bash
git add src/lib/ai/model-registry.ts src/lib/ai/__tests__/model-registry.test.ts
git commit -m "feat(persona): model_f_c에 굴다 캐릭터 프로필을 부여한다"
```

---

## Task 2: buildCharacterVoice

**Files:**
- Modify: `src/lib/ai/model-registry.ts`
- Test: `src/lib/ai/__tests__/model-registry.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/ai/__tests__/model-registry.test.ts` 끝에 붙인다. 상단 import에 `buildCharacterVoice`를 추가한다.

```ts
import { findPersona, MODEL_PERSONAS, buildCharacterVoice } from '../model-registry';

describe('buildCharacterVoice', () => {
  it('이름·직함·말투 규칙·금지를 한 지시문에 담는다', () => {
    const out = buildCharacterVoice(findPersona('model_f_c')!.character!);
    expect(out).toContain('굴다');
    expect(out).toContain('발굴템 연구소 연구원');
    expect(out).toContain('~잖아요');
    expect(out).toContain('~습니다 정중체');
  });

  it('규칙과 금지를 서로 다른 구획에 넣는다 — 섞이면 모델이 금지를 규칙으로 읽는다', () => {
    const out = buildCharacterVoice(findPersona('model_f_c')!.character!);
    const rulesAt = out.indexOf('지켜야 할 말투');
    const banAt = out.indexOf('쓰지 않는다');
    expect(rulesAt).toBeGreaterThan(-1);
    expect(banAt).toBeGreaterThan(rulesAt);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/lib/ai/__tests__/model-registry.test.ts -t buildCharacterVoice`
Expected: FAIL — `buildCharacterVoice is not a function`

- [ ] **Step 3: 함수를 구현한다**

`src/lib/ai/model-registry.ts` 맨 아래에 추가한다.

```ts
/**
 * 캐릭터 말투 지시문 — 영상 자막·카피 생성에 붙인다.
 *
 * IDENTITY_LOCK_INSTRUCTION이 얼굴을 고정하듯 이 함수는 목소리를 고정한다.
 * 한국어 카피를 만드는 프롬프트에 들어가므로 지시문 자체도 한국어다.
 *
 * 규칙과 금지를 구획으로 나누는 이유: 한 덩어리로 주면 모델이 금지 표현을
 * 예시로 읽고 그대로 쓰는 경우가 있다.
 */
export function buildCharacterVoice(profile: CharacterProfile): string {
  const rules = profile.voiceRules.map((r) => `- ${r}`).join('\n');
  const bans = profile.forbidden.map((r) => `- ${r}`).join('\n');
  return [
    `화자는 ${profile.name}이며 ${profile.title}이다. ${profile.ageBand}이고, ${profile.setting}.`,
    '',
    '지켜야 할 말투:',
    rules,
    '',
    '아래 표현은 쓰지 않는다:',
    bans,
  ].join('\n');
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/lib/ai/__tests__/model-registry.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋한다**

```bash
git add src/lib/ai/model-registry.ts src/lib/ai/__tests__/model-registry.test.ts
git commit -m "feat(persona): 캐릭터 말투 지시문을 조립하는 buildCharacterVoice"
```

---

## Task 3: scene-registry — 씬 목록과 조회

**Files:**
- Create: `src/lib/ai/scene-registry.ts`
- Test: `src/lib/ai/__tests__/scene-registry.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/ai/__tests__/scene-registry.test.ts`를 새로 만든다.

```ts
// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SCENE_SHEETS, findScene, scenesFor, sceneSheetUrl } from '../scene-registry';

describe('SCENE_SHEETS', () => {
  it('굴다의 집으로 거실·부엌·현관이 등록돼 있다', () => {
    const ids = scenesFor('model_f_c').map((s) => s.id);
    expect(ids).toContain('home_living');
    expect(ids).toContain('home_kitchen');
    expect(ids).toContain('home_entrance');
  });

  it('모든 씬이 고정 소품 문장을 갖는다 — 참조를 못 넣을 때의 대체 수단이다', () => {
    for (const s of SCENE_SHEETS) {
      expect(s.fixtures.length).toBeGreaterThan(10);
    }
  });

  it('id가 중복되지 않는다', () => {
    const ids = SCENE_SHEETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('findScene', () => {
  it('없는 id에는 null을 준다', () => {
    expect(findScene('nope')).toBeNull();
    expect(findScene(undefined)).toBeNull();
  });
});

describe('sceneSheetUrl', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL;
  });

  it('Supabase 공개 URL을 만든다', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    const url = sceneSheetUrl(findScene('home_living')!);
    expect(url).toBe(
      'https://example.supabase.co/storage/v1/object/public/smart-seller-studio/scene-sheets/home_living.jpg',
    );
  });

  it('환경변수가 없으면 null을 준다 — 씬 없이도 생성은 진행돼야 한다', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(sceneSheetUrl(findScene('home_living')!)).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/lib/ai/__tests__/scene-registry.test.ts`
Expected: FAIL — `Cannot find module '../scene-registry'`

- [ ] **Step 3: scene-registry.ts를 만든다**

```ts
// src/lib/ai/scene-registry.ts
/**
 * 씬(공간) 레지스트리 — 캐릭터가 사는 집을 고정한다.
 *
 * model-registry가 「누가」를 정한다면 이 파일은 「어디서」를 정한다.
 * 둘을 나눈 이유는 수명이 다르기 때문이다 — 페르소나는 5명으로 고정이지만
 * 씬은 상품군이 늘 때마다 늘어난다.
 *
 * 🔴 2026-08-30 실측: 캐릭터 시트만 있고 씬 시트가 없으면 같은 프롬프트로
 * 만든 3색 착용컷의 방 구조가 매번 달라졌다(커튼 왼쪽 / 창 중앙 / 소파 왼쪽).
 * 얼굴만 고정해서는 「그 사람의 집」이 만들어지지 않는다.
 */

const BUCKET_PUBLIC_PREFIX = '/storage/v1/object/public/smart-seller-studio/';

export interface SceneSheet {
  /** 안정 식별자. Storage 파일명과 같아야 한다 */
  id: string;
  /** 누구의 공간인가 — ModelPersona.id */
  personaId: string;
  /** UI에 보이는 이름 */
  label: string;
  /** 씬 시트 Storage 경로 (버킷 내부 경로) */
  sheetPath: string;
  /**
   * 고정 소품 문장. 참조 3장이 차서 씬 시트를 못 넣을 때 이 문장이 대신 들어간다.
   * 가구의 종류·상대 위치·개수를 적는다 — 그것이 씬 검증의 합격 기준이다.
   */
  fixtures: string;
  /** 어떤 상품군에 쓰는가 */
  bestFor: string;
}

export const SCENE_SHEETS: readonly SceneSheet[] = [
  {
    id: 'home_living',
    personaId: 'model_f_c',
    label: '거실',
    sheetPath: 'scene-sheets/home_living.jpg',
    fixtures:
      'A bright living room: a sheer-curtained window on the LEFT wall, one grey three-seat fabric sofa ' +
      'against the BACK wall on the RIGHT half, a black floor lamp standing between the window and the sofa, ' +
      'pale wood flooring, plain off-white walls. No other furniture.',
    bestFor: '의류·홈리빙',
  },
  {
    id: 'home_kitchen',
    personaId: 'model_f_c',
    label: '부엌·싱크대',
    sheetPath: 'scene-sheets/home_kitchen.jpg',
    fixtures:
      'A small home kitchen: a white countertop running along the BACK wall with a stainless sink on the ' +
      'LEFT half, light wood upper cabinets above it, a white tiled backsplash, one wooden cutting board ' +
      'leaning at the RIGHT end of the counter. Pale wood flooring. No dining table in frame.',
    bestFor: '요거트·초콜릿 무스·시리얼·주방템',
  },
  {
    id: 'home_entrance',
    personaId: 'model_f_c',
    label: '현관',
    sheetPath: 'scene-sheets/home_entrance.jpg',
    fixtures:
      'A small apartment entrance: a white front door on the BACK wall, a low wooden shoe cabinet against ' +
      'the RIGHT wall with one pair of shoes on top, a full-length mirror on the LEFT wall, grey tiled ' +
      'entrance floor stepping up to pale wood flooring. No rug.',
    bestFor: '택배 언박싱·나가는 옷·신발',
  },
] as const;

export function findScene(id: string | undefined | null): SceneSheet | null {
  if (!id) return null;
  return SCENE_SHEETS.find((s) => s.id === id) ?? null;
}

/** 한 페르소나의 씬만 고른다 — 다른 사람 집이 섞이면 안 된다 */
export function scenesFor(personaId: string): SceneSheet[] {
  return SCENE_SHEETS.filter((s) => s.personaId === personaId);
}

/**
 * 씬 시트의 공개 URL을 만든다.
 *
 * personaSheetUrl과 같은 규칙이다 — 환경변수가 없으면 null을 돌려주고
 * 호출부는 씬 시트 없이 진행한다. 배경이 안 고정될 뿐 생성이 실패하지는 않아야 한다.
 */
export function sceneSheetUrl(scene: SceneSheet): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, '')}${BUCKET_PUBLIC_PREFIX}${scene.sheetPath}`;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/lib/ai/__tests__/scene-registry.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋한다**

```bash
git add src/lib/ai/scene-registry.ts src/lib/ai/__tests__/scene-registry.test.ts
git commit -m "feat(scene): 굴다의 집을 고정하는 씬 레지스트리"
```

---

## Task 4: buildSceneLock

**Files:**
- Modify: `src/lib/ai/scene-registry.ts`
- Test: `src/lib/ai/__tests__/scene-registry.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/ai/__tests__/scene-registry.test.ts` 끝에 붙인다. 상단 import에 `buildSceneLock`을 추가한다.

```ts
import { SCENE_SHEETS, findScene, scenesFor, sceneSheetUrl, buildSceneLock } from '../scene-registry';

describe('buildSceneLock', () => {
  const scene = () => findScene('home_living')!;

  it('reference 모드는 첨부된 씬 참조를 가리킨다', () => {
    const out = buildSceneLock(scene(), 'reference');
    expect(out).toContain('SCENE LOCK');
    expect(out).toContain('scene reference');
    expect(out).not.toContain(scene().fixtures);
  });

  it('fixtures 모드는 소품 문장을 그대로 싣는다 — 참조가 없기 때문이다', () => {
    const out = buildSceneLock(scene(), 'fixtures');
    expect(out).toContain('SCENE LOCK');
    expect(out).toContain(scene().fixtures);
    expect(out).not.toContain('scene reference');
  });

  it('두 모드 모두 인물을 바꾸라고 말하지 않는다 — 인물은 IDENTITY_LOCK의 몫이다', () => {
    for (const mode of ['reference', 'fixtures'] as const) {
      expect(buildSceneLock(scene(), mode).toLowerCase()).not.toContain('face');
    }
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/lib/ai/__tests__/scene-registry.test.ts -t buildSceneLock`
Expected: FAIL — `buildSceneLock is not a function`

- [ ] **Step 3: 함수를 구현한다**

`src/lib/ai/scene-registry.ts` 맨 아래에 추가한다.

```ts
export type SceneLockMode = 'reference' | 'fixtures';

/**
 * 배경 고정 지시문.
 *
 * 두 모드가 있는 이유는 참조 3장 상한 때문이다. 의류 생성은 캐릭터 시트·착용
 * 참조·제품 누끼로 자리가 이미 차서 씬 시트를 넣을 수 없고, 그때는 소품을
 * 문장으로 서술하는 fixtures 모드로 내려간다. 어느 모드인지는
 * composeReferences가 정한다.
 *
 * 인물에 대해서는 아무것도 말하지 않는다 — 그것은 IDENTITY_LOCK_INSTRUCTION의
 * 몫이고, 두 지시문이 같은 대상을 다르게 말하면 모델이 흔들린다.
 */
export function buildSceneLock(scene: SceneSheet, mode: SceneLockMode): string {
  if (mode === 'reference') {
    return (
      'SCENE LOCK: The room MUST be the exact same room shown in the attached scene reference image — ' +
      'same furniture, same layout, same wall and floor finish, same window position. Treat the scene ' +
      'reference as a photograph of the actual location being shot. The camera may stand at a different ' +
      'spot in that room, but do not invent a different room.'
    );
  }
  return (
    'SCENE LOCK: Build the room exactly as described here and keep it identical across every image in ' +
    `this set. ${scene.fixtures} Do not add furniture or props that are not listed.`
  );
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/lib/ai/__tests__/scene-registry.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: 커밋한다**

```bash
git add src/lib/ai/scene-registry.ts src/lib/ai/__tests__/scene-registry.test.ts
git commit -m "feat(scene): 참조·문장 두 모드를 갖는 buildSceneLock"
```

---

## Task 5: composeReferences — 참조 3장 배치

**Files:**
- Create: `src/lib/ai/reference-composer.ts`
- Test: `src/lib/ai/__tests__/reference-composer.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/ai/__tests__/reference-composer.test.ts`를 새로 만든다.

```ts
// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { composeReferences, MAX_REFERENCES } from '../reference-composer';

const P = 'https://x/persona.jpg';
const S = 'https://x/scene.jpg';
const W = 'https://x/worn.jpg';
const F = 'https://x/flat.jpg';

describe('composeReferences', () => {
  it('상한은 3장이다', () => {
    expect(MAX_REFERENCES).toBe(3);
  });

  it('넷을 다 주면 씬을 버린다 — 버리는 순서의 첫 번째다', () => {
    const r = composeReferences({ persona: P, scene: S, productWorn: W, productFlat: F });
    expect(r.refs.map((x) => x.kind)).toEqual(['persona', 'productFlat', 'productWorn']);
    expect(r.sceneMode).toBe('fixtures');
    expect(r.dropped).toEqual(['scene']);
  });

  it('착용 참조가 없으면 씬이 들어간다 — 식품·잡화가 이 경우다', () => {
    const r = composeReferences({ persona: P, scene: S, productFlat: F });
    expect(r.refs.map((x) => x.kind)).toEqual(['persona', 'productFlat', 'scene']);
    expect(r.sceneMode).toBe('reference');
    expect(r.dropped).toEqual([]);
  });

  it('인물과 제품 누끼는 절대 버리지 않는다', () => {
    const r = composeReferences({ persona: P, scene: S, productWorn: W, productFlat: F });
    expect(r.refs.some((x) => x.kind === 'persona')).toBe(true);
    expect(r.refs.some((x) => x.kind === 'productFlat')).toBe(true);
    expect(r.dropped).not.toContain('persona');
    expect(r.dropped).not.toContain('productFlat');
  });

  it('씬이 아예 없으면 fixtures 모드가 아니라 none이다', () => {
    const r = composeReferences({ persona: P, productFlat: F });
    expect(r.sceneMode).toBe('none');
    expect(r.dropped).toEqual([]);
  });

  it('인물만 있어도 동작한다', () => {
    const r = composeReferences({ persona: P });
    expect(r.refs.map((x) => x.kind)).toEqual(['persona']);
    expect(r.sceneMode).toBe('none');
  });

  it('어떤 경우에도 상한을 넘지 않는다', () => {
    const r = composeReferences({ persona: P, scene: S, productWorn: W, productFlat: F });
    expect(r.refs.length).toBeLessThanOrEqual(MAX_REFERENCES);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/lib/ai/__tests__/reference-composer.test.ts`
Expected: FAIL — `Cannot find module '../reference-composer'`

- [ ] **Step 3: reference-composer.ts를 만든다**

```ts
// src/lib/ai/reference-composer.ts
/**
 * 참조 이미지 배치 — 3장 상한 안에서 무엇을 넣고 무엇을 강등할지 정한다.
 *
 * 🔴 2026-08-27 실측: 참조를 3장 넘게 주면 뒤쪽이 무시된다. 나이키 다저스
 * 티셔츠에 캐릭터 시트를 더했을 때 하단 로고가 누락된 것이 그 형태였다.
 *
 * 🔴 2026-08-30: 의류는 캐릭터 시트·착용 참조·제품 누끼로 자리가 이미 차서
 * 씬 시트를 넣을 수 없다. 그 판단을 호출부마다 손으로 하면 조용히 깨지므로
 * 이 파일이 전담한다.
 *
 * 버리는 순서는 고정이다: 씬 → 착용 참조. 인물 시트와 제품 누끼는 버리지
 * 않는다 — 앞은 캐릭터 정체성이고 뒤는 상품 정확성이라, 둘 중 하나가 빠지면
 * 그 컷은 쓸 수 없다.
 */

export const MAX_REFERENCES = 3;

export type RefKind = 'persona' | 'productFlat' | 'productWorn' | 'scene';

/** 씬을 참조로 넣었는지, 문장으로 내렸는지, 아예 없는지 */
export type SceneMode = 'reference' | 'fixtures' | 'none';

export interface RefSlot {
  kind: RefKind;
  url: string;
}

export interface ComposeInput {
  /** 캐릭터 시트 — 없으면 인물이 고정되지 않는다 */
  persona?: string;
  /** 씬 시트 */
  scene?: string;
  /** 옷이 몸에 걸쳐진 참조 (드레이프) */
  productWorn?: string;
  /** 제품 누끼 — 패턴·색의 기준 */
  productFlat?: string;
}

export interface ComposeResult {
  refs: RefSlot[];
  /** 씬을 어떻게 다뤘는가. buildSceneLock의 인자가 된다 */
  sceneMode: SceneMode;
  /** 상한 때문에 버린 것들 */
  dropped: RefKind[];
}

/** 넣는 우선순위. 버리는 순서의 역순이다 */
const PRIORITY: RefKind[] = ['persona', 'productFlat', 'productWorn', 'scene'];

/**
 * 🔴 sceneMode가 'none'이면 buildSceneLock을 부르지 않는다.
 *    SceneLockMode는 'reference' | 'fixtures' 둘뿐이고 'none'을 받지 않는다.
 *    호출부는 이렇게 쓴다:
 *      const c = composeReferences({...});
 *      const sceneLock = c.sceneMode === 'none' ? '' : buildSceneLock(scene, c.sceneMode);
 */
export function composeReferences(input: ComposeInput): ComposeResult {
  const available: RefSlot[] = PRIORITY.flatMap((kind) => {
    const url = input[kind];
    return url ? [{ kind, url }] : [];
  });

  const refs = available.slice(0, MAX_REFERENCES);
  const dropped = available.slice(MAX_REFERENCES).map((r) => r.kind);

  let sceneMode: SceneMode = 'none';
  if (input.scene) {
    sceneMode = refs.some((r) => r.kind === 'scene') ? 'reference' : 'fixtures';
  }

  return { refs, sceneMode, dropped };
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/lib/ai/__tests__/reference-composer.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 타입 검사와 린트를 돌린다**

Run: `npx tsc --noEmit && npx eslint src/lib/ai`
Expected: 오류 없음

- [ ] **Step 6: 커밋한다**

```bash
git add src/lib/ai/reference-composer.ts src/lib/ai/__tests__/reference-composer.test.ts
git commit -m "feat(ai): 참조 3장 상한 안에서 배치를 결정하는 composeReferences"
```

> **스펙의 해법 ①(상품 참조 합치기)은 이 코드를 바꾸지 않는다.** 착용 참조와 제품 누끼를 한 장으로 합성했다면 그 합성본 URL을 `productFlat`으로만 넘기고 `productWorn`을 비우면 된다 — 그러면 자리가 하나 남아 씬이 `reference` 모드로 들어간다. 합성이 실제로 읽히는지는 스펙의 열린 질문이며, 실패해도 ③(지금 구현)이 기본 경로로 계속 동작한다.

---

## Task 6: 씬 시트 생성 스크립트

**Files:**
- Create: `scripts/_gulda_scene.ts`

이 태스크는 이미지를 생성하는 실행 스크립트다. 순수 함수가 아니라 단위 테스트를 붙이지 않고, 다음 태스크에서 육안으로 검증한다.

- [ ] **Step 1: 스크립트를 만든다**

```ts
/**
 * 굴다의 씬 시트 생성 (2026-08-30).
 *
 * 사용법: npx tsx scripts/_gulda_scene.ts <home_living|home_kitchen|home_entrance> [장수]
 *
 * 씬 시트는 인물이 없는 빈 방 사진이다. 인물을 넣으면 그 인물이 시트에 박혀
 * 캐릭터 시트와 충돌한다.
 *
 * 🔴 같은 씬을 여러 장 뽑는 이유는 검증 때문이다. 세 장에서 가구의 종류·상대
 * 위치·개수가 같아야 이 씬 시트를 쓸 수 있다 — 2026-08-30에 배경이 매번
 * 달라진 것이 이 작업의 출발점이다.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { generateFrameImage } from '@/lib/ai/imagen';
import { findScene } from '@/lib/ai/scene-registry';

const ENV = path.join(process.env.HOME!, 'dev/smart_seller_studio/.env.local');
for (const line of readFileSync(ENV, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const OUT = '/Volumes/Mac_SSD/Seller/공용 섹션/굴다 씬 시트';

async function main() {
  const id = process.argv[2];
  const count = Number(process.argv[3] ?? 3);
  const scene = findScene(id);
  if (!scene) throw new Error(`씬을 찾을 수 없다: ${id}`);
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

  const prompt =
    'Photograph of an empty room interior, no people, no person, nobody in frame. ' +
    `${scene.fixtures} ` +
    'Shot from standing eye level with a normal lens, the whole room readable in one frame. ' +
    'Soft neutral daylight, white-balanced, no colour cast. Photographic realism, sharp focus, ' +
    'no text, no watermark.';

  for (let i = 1; i <= count; i++) {
    process.stdout.write(`[${scene.id}] ${i}/${count} … `);
    try {
      const r = await generateFrameImage({ imagePrompt: prompt, aspectRatio: '3:4' });
      const buf = Buffer.from(r.imageBase64, 'base64');
      const ext = buf[0] === 0x89 && buf[1] === 0x50 ? 'png' : 'jpg';
      const file = path.join(OUT, `${scene.id}_${i}.${ext}`);
      writeFileSync(file, buf);
      console.log(`OK → ${path.basename(file)} (${(buf.length / 1024).toFixed(0)}KB)`);
    } catch (e) {
      console.log(`실패: ${(e as Error).message}`);
    }
  }
  console.log(`\n저장: ${OUT}`);
}

main();
```

- [ ] **Step 2: 거실 씬을 3장 뽑는다**

Run: `npx tsx scripts/_gulda_scene.ts home_living 3`
Expected: `home_living_1.png` ~ `home_living_3.png`이 `/Volumes/Mac_SSD/Seller/공용 섹션/굴다 씬 시트`에 생성된다

- [ ] **Step 3: 커밋한다**

```bash
git add scripts/_gulda_scene.ts
git commit -m "feat(scene): 굴다 씬 시트 생성 스크립트"
```

---

## Task 7: 씬 검증 — 배경이 실제로 고정되는가

**Files:** 없음 (검증 태스크)

이 태스크는 **게이트**다. 통과하지 못하면 씬 시트를 편당 제작에 쓰지 않는다.

- [ ] **Step 1: 세 장을 나란히 붙여 본다**

```bash
cd "/Volumes/Mac_SSD/Seller/공용 섹션/굴다 씬 시트"
ffmpeg -y -i home_living_1.png -i home_living_2.png -i home_living_3.png \
  -filter_complex "[0]scale=360:-1[a];[1]scale=360:-1[b];[2]scale=360:-1[c];[a][b][c]hstack=3" \
  home_living_check.jpg
```

- [ ] **Step 2: 합격 기준으로 판정한다**

세 장에서 아래가 모두 같으면 통과한다.

- 주요 가구의 **종류** (소파·램프·창)
- 주요 가구의 **상대 위치** (창이 왼쪽, 소파가 오른쪽 뒷벽)
- 주요 가구의 **개수** (소파 하나, 램프 하나)

조명·카메라 각도·소품의 미세한 차이는 통과로 본다.

- [ ] **Step 3-A: 통과한 경우 — 시트를 확정하고 업로드한다**

가장 잘 나온 한 장을 `home_living.jpg`로 정하고 세 곳에 둔다.

```bash
cd "/Volumes/Mac_SSD/Seller/공용 섹션/굴다 씬 시트"
sips -s format jpeg home_living_1.png --out home_living.jpg
cp home_living.jpg ~/dev/smart_seller_studio/reference/scene-sheets/home_living.jpg
```

Supabase `scene-sheets/home_living.jpg`에 업로드한다(앱 화면 또는 Storage 콘솔).

- [ ] **Step 3-B: 실패한 경우 — 스펙의 후퇴 경로를 따른다**

씬 시트를 쓰지 않고 `composeReferences`가 항상 `fixtures` 모드로 떨어지게 둔다. 코드는 그대로 동작한다 — `sceneSheetUrl`이 null을 주면 `composeReferences`의 `scene`이 undefined가 되고 `sceneMode`가 `none`이 된다.

이 경우 `scene-registry.ts`의 해당 씬 주석에 실패 사실과 날짜를 적는다.

- [ ] **Step 4: 부엌·현관도 같은 절차를 반복한다**

```bash
npx tsx scripts/_gulda_scene.ts home_kitchen 3
npx tsx scripts/_gulda_scene.ts home_entrance 3
```

- [ ] **Step 5: 결과를 위키에 기록한다**

`20-wiki/outputs/카디건 릴스 제작 실측 2026-08-30.md`의 열린 질문 *"씬 시트가 배경을 고정하는가"*를 해소하거나, 실패했다면 그 사실을 적는다.

---

## Task 8: 전체 검증

**Files:** 없음

- [ ] **Step 1: 전체 테스트를 돌린다**

Run: `npx vitest run src/lib/ai`
Expected: PASS — model-registry 5건, scene-registry 9건, reference-composer 7건 = 21건

- [ ] **Step 2: 타입 검사와 빌드를 돌린다**

Run: `npx tsc --noEmit && npm run build`
Expected: 오류 없이 빌드 완료

- [ ] **Step 3: 기존 테스트가 깨지지 않았는지 본다**

Run: `npx vitest run 2>&1 | tail -5`
Expected: 실패 수가 작업 전과 같다 (2026-08-30 기준 기존 실패 9건 — `keyword-discover`·`cleanup-image-region`·`keyword-suggest-with-evaluate`·`analyze-detail-images`·`detail-maker-thumbnail-panel`·`assets-tab`·`_tmp_*` 3건)

- [ ] **Step 4: 커밋한다**

```bash
git add -A
git commit -m "chore(persona): 굴다 페르소나 구현 검증"
```
