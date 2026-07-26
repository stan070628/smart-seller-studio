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
 */
export const GEN_SLOT_TYPES = ['flux_lifestyle', 'detail_closeup', 'model_wearing'] as const;
export type GenSlotType = (typeof GEN_SLOT_TYPES)[number];
const GEN_SLOT_SET: ReadonlySet<string> = new Set(GEN_SLOT_TYPES);

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
 * 접사('detail'), model_wearing은 인물 착용컷('wearing', 비합성 경로), 그 외
 * (flux_lifestyle 포함)는 라이프스타일('lifestyle').
 *
 * GEN_SLOT_TYPES에 네 번째 타입이 추가되면 여기 분기가 없는 한 조용히
 * 'lifestyle'로 떨어진다 — 새 타입을 추가할 때는 이 함수도 함께 확인할 것.
 * (지금 세 멤버는 모두 명시 분기되거나, 'lifestyle'이 곧 정답인 flux_lifestyle뿐이다.)
 */
export function sceneTypeFor(t?: string): 'detail' | 'wearing' | 'lifestyle' {
  return t === 'detail_closeup' ? 'detail'
    : t === 'model_wearing' ? 'wearing'
    : 'lifestyle';
}
