import { describe, it, expect } from 'vitest';
import {
  deriveOptions,
  uniqueOptionNames,
  isOptionMode,
  optionNameByImageIndex,
  collectOptionCoverage,
  type OptionSection,
} from '@/lib/detail-page/product-options';

describe('deriveOptions', () => {
  it('이름이 붙은 이미지마다 항목을 하나씩 만든다 (중복을 접지 않는다)', () => {
    expect(deriveOptions(['화이트', '블랙', '블랙', ''])).toEqual([
      { name: '화이트', imageIndex: 0 },
      { name: '블랙', imageIndex: 1 },
      { name: '블랙', imageIndex: 2 },
    ]);
  });

  it('공백을 제거하고 빈 문자열은 버린다', () => {
    expect(deriveOptions(['  화이트  ', '   ', '블랙'])).toEqual([
      { name: '화이트', imageIndex: 0 },
      { name: '블랙', imageIndex: 2 },
    ]);
  });

  it('40자를 넘으면 자른다', () => {
    const long = 'ㄱ'.repeat(50);
    expect(deriveOptions([long])[0]!.name).toHaveLength(40);
  });
});

describe('uniqueOptionNames', () => {
  it('입력 순서를 유지하며 중복을 접는다', () => {
    const opts = deriveOptions(['블랙', '화이트', '블랙']);
    expect(uniqueOptionNames(opts)).toEqual(['블랙', '화이트']);
  });
});

describe('isOptionMode', () => {
  it('고유 옵션명이 2개 이상이면 true', () => {
    expect(isOptionMode(deriveOptions(['화이트', '블랙']))).toBe(true);
  });

  it('같은 이름만 여러 개면 false', () => {
    expect(isOptionMode(deriveOptions(['블랙', '블랙']))).toBe(false);
  });

  it('빈 입력이면 false', () => {
    expect(isOptionMode(deriveOptions(['', '']))).toBe(false);
  });
});

describe('optionNameByImageIndex', () => {
  it('이름이 붙은 모든 인덱스를 담는다', () => {
    const map = optionNameByImageIndex(deriveOptions(['화이트', '블랙', '블랙']));
    expect(map.get(0)).toBe('화이트');
    expect(map.get(1)).toBe('블랙');
    expect(map.get(2)).toBe('블랙');
    expect(map.has(3)).toBe(false);
  });
});

/** imageSlots만 가진 최소 섹션 */
function section(imageRefs: Array<number | undefined>): OptionSection {
  return { blocks: [], imageSlots: imageRefs.map((r) => ({ imageRef: r })) };
}

/** 옵션 수만큼 슬롯과 option_grid items를 가진 비교 섹션 */
function compareSection(imageRefs: number[]): OptionSection {
  return {
    blocks: [{ type: 'option_grid', items: imageRefs.map(() => ({ label: 'x' })) }],
    imageSlots: imageRefs.map((r) => ({ imageRef: r })),
  };
}

describe('collectOptionCoverage', () => {
  const nameByIdx = optionNameByImageIndex(deriveOptions(['화이트', '블랙']));

  it('비교 섹션을 집계에서 제외한다', () => {
    const cov = collectOptionCoverage([compareSection([0, 1]), section([0])], nameByIdx);
    expect(cov.compareSectionCount).toBe(1);
    expect(cov.counts.get('화이트')).toBe(1);
    expect(cov.counts.get('블랙')).toBe(0);
    expect(cov.total).toBe(1);
  });

  it('등장하지 않은 옵션도 0으로 채운다', () => {
    const cov = collectOptionCoverage([section([0, 0])], nameByIdx);
    expect(cov.counts.get('블랙')).toBe(0);
  });

  it('imageRef 미지정 슬롯을 unresolvedSlots로 센다', () => {
    const cov = collectOptionCoverage([section([undefined, 0])], nameByIdx);
    expect(cov.unresolvedSlots).toBe(1);
    expect(cov.counts.get('화이트')).toBe(1);
  });

  it('이름이 없는 인덱스를 가리키는 슬롯도 unresolvedSlots', () => {
    const cov = collectOptionCoverage([section([3])], nameByIdx);
    expect(cov.unresolvedSlots).toBe(1);
  });

  it('option_grid가 있어도 슬롯 수가 옵션 수와 다르면 비교 섹션이 아니다', () => {
    const sizeGrid: OptionSection = {
      blocks: [{ type: 'option_grid', items: [{ label: 'S' }, { label: 'M' }, { label: 'L' }] }],
      imageSlots: [{ imageRef: 0 }],
    };
    const cov = collectOptionCoverage([sizeGrid], nameByIdx);
    expect(cov.compareSectionCount).toBe(0);
    expect(cov.counts.get('화이트')).toBe(1);
  });

  it('imageSlots가 없는 섹션은 건너뛴다', () => {
    const cov = collectOptionCoverage([{ blocks: [] }], nameByIdx);
    expect(cov.total).toBe(0);
  });
});
