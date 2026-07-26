import { describe, it, expect } from 'vitest';
import { GEN_SLOT_TYPES, isGenSlotType, resolveGenSlot, sceneTypeFor } from '@/lib/detail-page/gen-slots';

describe('resolveGenSlot', () => {
  it('여러 gen 슬롯 중 첫 번째를 찾는다 — flux_lifestyle이 앞이면 그것', () => {
    expect(resolveGenSlot([{ slotType: 'flux_lifestyle' }, { slotType: 'model_wearing' }]))
      .toEqual({ index: 0, slotType: 'flux_lifestyle' });
  });

  it('model_wearing이 앞이면 그것', () => {
    expect(resolveGenSlot([{ slotType: 'model_wearing' }, { slotType: 'flux_lifestyle' }]))
      .toEqual({ index: 0, slotType: 'model_wearing' });
  });

  it('gen 슬롯이 아닌 타입(product_nukki)은 건너뛰고 다음 gen 슬롯을 찾는다', () => {
    expect(resolveGenSlot([{ slotType: 'product_nukki' }, { slotType: 'model_wearing' }]))
      .toEqual({ index: 1, slotType: 'model_wearing' });
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

  it('model_wearing → wearing', () => {
    expect(sceneTypeFor('model_wearing')).toBe('wearing');
  });

  it('flux_lifestyle → lifestyle', () => {
    expect(sceneTypeFor('flux_lifestyle')).toBe('lifestyle');
  });

  it('미지 타입·undefined는 lifestyle로 폴백한다', () => {
    expect(sceneTypeFor('product_nukki')).toBe('lifestyle');
    expect(sceneTypeFor(undefined)).toBe('lifestyle');
  });

  // GEN_SLOT_TYPES에 네 번째 타입이 추가되면 sceneTypeFor에 분기를 더하지 않는 한
  // 조용히 'lifestyle'로 떨어진다. 'lifestyle'이 정답인 멤버는 지금 flux_lifestyle
  // 하나뿐임을 고정해서, 새 타입이 이 목록에 들어오는 순간 이 테스트가 실패하게
  // 만든다 — "조용히 lifestyle로 떨어지는" 사고를 여기서 눈에 띄게 한다.
  it('GEN_SLOT_TYPES 중 lifestyle로 매핑되는 멤버는 flux_lifestyle뿐이다', () => {
    const fallsToLifestyle = GEN_SLOT_TYPES.filter((t) => sceneTypeFor(t) === 'lifestyle');
    expect(fallsToLifestyle).toEqual(['flux_lifestyle']);
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
