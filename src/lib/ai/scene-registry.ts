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
  {
    // 🔴 이 씬만 주인이 model_f_b다. 위 셋은 굴다(model_f_c)의 집이므로 섞어 쓰지 않는다.
    id: 'home_bathroom',
    personaId: 'model_f_b',
    label: '욕실·세면대',
    sheetPath: 'scene-sheets/home_bathroom.jpg',
    fixtures:
      'A bathroom vanity: a wall-mounted white solid-surface counter running across the frame with an ' +
      'undermount rectangular basin just RIGHT of centre and a brushed-nickel faucet behind it, a large ' +
      'backlit rectangular mirror on the BACK wall above the counter with a soft warm glow around its ' +
      'edges, one open shelf under the counter holding folded towels, and a tall frosted-glass window ' +
      'on the RIGHT wall. Matte off-white tiled walls, light grey floor tile. No other fixtures.',
    bestFor: '핸드워시·바디워시·욕실용품',
  },
  {
    // 사용자 제공 레퍼런스를 그대로 시트로 쓴다 (2026-09-03, 문구·인물 없음 확인).
    // ⚠️ 원본은 /Volumes/Mac_SSD/모델 페르소나/굴다/거실/ 에 있으나 현재 이 씬을
    //    쓰는 상품 컷의 인물은 model_f_b다 — 페르소나 정리 때 소유를 재검토한다.
    id: 'home_living_fb',
    personaId: 'model_f_b',
    label: '거실 (프리미엄)',
    sheetPath: 'scene-sheets/home_living_fb.jpg',
    fixtures:
      'A spacious open-plan living room: floor-to-ceiling windows along the RIGHT wall with sheer curtains, ' +
      'a large beige modular fabric sofa in an L-shape facing the camera, a low rectangular travertine ' +
      'coffee table in front of it holding a vase with green branches and one or two small bowls, ' +
      'a cream rug under the seating area, a kitchen island with wooden bar stools in the far background, ' +
      'a mezzanine balcony above on the LEFT, warm beige walls and pale stone flooring. Daylight from the right.',
    bestFor: '홈리빙·휴대 소구·라이프스타일',
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
