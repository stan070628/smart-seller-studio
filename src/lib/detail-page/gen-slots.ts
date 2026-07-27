// src/lib/detail-page/gen-slots.ts
//
// Leaf 모듈 — 다른 모듈을 import하지 않는다. 의도적이다: page.tsx(클라이언트
// 컴포넌트)가 이 판정만 쓰려고 layout-validator.ts를 import하면 zod 스키마
// (zLayoutBlock/zClaudeSection)가 tree-shake되지 않고 클라이언트 번들에 통째로
// 딸려 온다(esbuild 실측: isGenSlotType 하나만 import해도 313KB, 그중 310KB가
// node_modules/zod/**). 이 파일을 별도로 두면 page.tsx는 여기서만 import하고
// zod와 무관해진다.
//
// 검증(layout-validator.ts)·생성 루프·렌더 조립(page.tsx)이 모두 이 모듈 하나만
// 봐야 한다. 세 곳이 각자 하드코딩한 판정으로 갈라지면 "검증 통과, 이미지 없음"
// 류 결함이 재발한다.

/**
 * AI가 씬을 생성하는 슬롯 타입. page.tsx가 섹션당 이 중 첫 번째 하나만
 * 생성하고 렌더하므로(resolveGenSlot), 검증도 같은 기준을 써야 한다.
 *
 * model_wearing(인물 착용컷 전용 슬롯)은 제거했다 — 실물 검증에서 Claude가
 * 그 슬롯 자체를 만들지 않았고, 만들어도 gender/프레이밍 지시가 무시됐다.
 * flux_lifestyle이 이미 자유 프레이밍으로 완전한 착용컷을 만들고 있어
 * (generate-scene-image/prompts.ts의 PERSON_QUALITY 조건절 참고), 전용 슬롯
 * 없이도 같은 결과를 얻는다.
 */
export const GEN_SLOT_TYPES = ['flux_lifestyle', 'detail_closeup', 'compare_pair'] as const;
export type GenSlotType = (typeof GEN_SLOT_TYPES)[number];
const GEN_SLOT_SET: ReadonlySet<string> = new Set(GEN_SLOT_TYPES);

/**
 * compare_pair만 다른 엔드포인트(generate-compare-image)로 간다. 좌우 두 씬을
 * 만들어 한 장으로 붙이는 처리라 generate-scene-image의 단일 씬 경로와 다르다.
 *
 * 그래도 GEN_SLOT_TYPES에 넣는 이유: resolveGenSlot이 "이 섹션에서 AI가 채울
 * 슬롯"을 찾는 함수이고, 렌더 조립도 그 인덱스에 결과를 넣는다. 여기서 빠지면
 * 이미지가 만들어져도 놓일 자리를 못 찾는다.
 */
export function isComparePairSlot(t: unknown): boolean {
  return t === 'compare_pair';
}

/** GEN_SLOT_TYPES 소속 여부 타입가드. 호출부(검증/생성/렌더)가 모두 이것 하나만 본다. */
export function isGenSlotType(t: unknown): t is GenSlotType {
  return typeof t === 'string' && GEN_SLOT_SET.has(t);
}

/**
 * 섹션의 imageSlots 중 실제로 생성·업로드·렌더되는 첫 슬롯과 그 인덱스를 찾는다.
 * 없으면 null. 생성 루프와 렌더 조립(page.tsx)이 각자 findIndex를 하드코딩하는
 * 대신 이 함수 하나를 공유해야, 어느 슬롯에서 씬을 만들고 어느 슬롯에 그 결과를
 * 넣을지가 항상 같은 답을 낸다.
 */
export function resolveGenSlot(
  slots: ReadonlyArray<{ slotType?: string }> | undefined,
): { index: number; slotType: string } | null {
  if (!slots) return null;
  const index = slots.findIndex((sl) => isGenSlotType(sl?.slotType));
  if (index === -1) return null;
  return { index, slotType: slots[index]!.slotType as string };
}

/**
 * 슬롯 타입 → generate-scene-image의 sectionType. detail_closeup은 매크로
 * 접사('detail'), 그 외(flux_lifestyle 포함)는 라이프스타일('lifestyle').
 *
 * GEN_SLOT_TYPES에 세 번째 타입이 추가되면 여기 분기가 없는 한 조용히
 * 'lifestyle'로 떨어진다 — 새 타입을 추가할 때는 이 함수도 함께 확인할 것.
 * 두 멤버뿐이라 판정이 단순해졌지만, 검증·생성·렌더가 이 매핑 하나를
 * 공유한다는 계약 자체는 그대로 유효하므로 남긴다.
 */
export function sceneTypeFor(t?: string): 'detail' | 'lifestyle' {
  // compare_pair는 호출부에서 먼저 갈라져 generate-compare-image로 가므로 여기
  // 도달하지 않는다. 도달했다면 라우팅이 빠진 것이다.
  return t === 'detail_closeup' ? 'detail' : 'lifestyle';
}
