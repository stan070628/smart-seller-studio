import { describe, it, expect } from 'vitest';
import { GEN_SLOT_TYPES, isGenSlotType, resolveGenSlot, sceneTypeFor, isComparePairSlot } from '@/lib/detail-page/gen-slots';

describe('resolveGenSlot', () => {
  it('여러 gen 슬롯 중 첫 번째를 찾는다 — flux_lifestyle이 앞이면 그것', () => {
    expect(resolveGenSlot([{ slotType: 'flux_lifestyle' }, { slotType: 'detail_closeup' }]))
      .toEqual({ index: 0, slotType: 'flux_lifestyle' });
  });

  it('detail_closeup이 앞이면 그것', () => {
    expect(resolveGenSlot([{ slotType: 'detail_closeup' }, { slotType: 'flux_lifestyle' }]))
      .toEqual({ index: 0, slotType: 'detail_closeup' });
  });

  it('gen 슬롯이 아닌 타입(product_nukki)은 건너뛰고 다음 gen 슬롯을 찾는다', () => {
    expect(resolveGenSlot([{ slotType: 'product_nukki' }, { slotType: 'detail_closeup' }]))
      .toEqual({ index: 1, slotType: 'detail_closeup' });
  });

  it('빈 배열이면 null', () => {
    expect(resolveGenSlot([])).toBeNull();
  });

  it('undefined면 null', () => {
    expect(resolveGenSlot(undefined)).toBeNull();
  });

  it('gen 슬롯이 하나도 없으면 null', () => {
    expect(resolveGenSlot([{ slotType: 'product_nukki' }])).toBeNull();
  });
});

describe('sceneTypeFor', () => {
  it('detail_closeup → detail', () => {
    expect(sceneTypeFor('detail_closeup')).toBe('detail');
  });

  it('flux_lifestyle → lifestyle', () => {
    expect(sceneTypeFor('flux_lifestyle')).toBe('lifestyle');
  });

  it('미지 타입·undefined는 lifestyle로 폴백한다', () => {
    expect(sceneTypeFor('product_nukki')).toBe('lifestyle');
    expect(sceneTypeFor(undefined)).toBe('lifestyle');
  });

  // GEN_SLOT_TYPES에 타입이 추가되면 sceneTypeFor에 분기를 더하지 않는 한 조용히
  // 'lifestyle'로 떨어진다. generate-scene-image로 가는 멤버 중 'lifestyle'이 정답인
  // 것은 flux_lifestyle 하나뿐임을 고정해, 새 타입이 들어오는 순간 실패하게 만든다.
  //
  // compare_pair는 제외한다 — 호출부에서 먼저 갈라져 generate-compare-image로 가므로
  // sceneTypeFor에 도달하지 않는다. 여기 포함시키면 "도달하지도 않는 매핑"을 고정하게
  // 되고, 정작 잡아야 할 다음 씬 타입 추가는 통과시켜 가드가 무의미해진다.
  it('generate-scene-image로 가는 멤버 중 lifestyle 매핑은 flux_lifestyle뿐이다', () => {
    const sceneSlots = GEN_SLOT_TYPES.filter((t) => !isComparePairSlot(t));
    const fallsToLifestyle = sceneSlots.filter((t) => sceneTypeFor(t) === 'lifestyle');
    expect(fallsToLifestyle).toEqual(['flux_lifestyle']);
  });

  it('compare_pair는 별도 엔드포인트로 가므로 씬 타입 매핑 대상이 아니다', () => {
    expect(isComparePairSlot('compare_pair')).toBe(true);
    expect(GEN_SLOT_TYPES).toContain('compare_pair');
  });
});

describe('isGenSlotType', () => {
  it('GEN_SLOT_TYPES 멤버는 모두 true를 반환한다', () => {
    for (const t of GEN_SLOT_TYPES) expect(isGenSlotType(t)).toBe(true);
  });

  it('그 외 문자열·undefined·비문자열은 false를 반환한다', () => {
    expect(isGenSlotType('product_nukki')).toBe(false);
    expect(isGenSlotType(undefined)).toBe(false);
    expect(isGenSlotType(123)).toBe(false);
  });
});
