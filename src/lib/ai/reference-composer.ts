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

/**
 * 넣는 우선순위. 버리는 순서의 역순이다.
 *
 * 🔴 이 배열의 순서가 이 모듈의 모든 보장을 떠받친다. 앞쪽일수록 먼저 들어가고
 *    뒤쪽일수록 먼저 버려진다. 종류를 추가할 때는 반드시 「버려도 되는 정도」에
 *    맞는 자리에 넣어야 하며, 맨 뒤에 그냥 붙이면 scene보다 먼저 버려진다.
 *    순서는 reference-composer.test.ts가 고정한다.
 */
export const PRIORITY: readonly RefKind[] = ['persona', 'productFlat', 'productWorn', 'scene'] as const;

/**
 * 🔴 sceneMode가 'none'이면 buildSceneLock을 부르지 않는다.
 *    SceneLockMode는 'reference' | 'fixtures' 둘뿐이고 'none'을 받지 않는다.
 *    호출부는 이렇게 쓴다:
 *      const c = composeReferences({...});
 *      const sceneLock = c.sceneMode === 'none' ? '' : buildSceneLock(scene, c.sceneMode);
 *
 * 🔴 빈 문자열은 「없음」으로 취급한다. 호출부는 조회에 실패했을 때 '' 대신
 *    undefined를 넘겨야 한다 — ''를 넘기면 그 자리가 비고 뒤 항목이 승격되는데,
 *    dropped는 상한 때문에 버린 것만 담으므로 그 사실이 어디에도 보고되지 않는다.
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
