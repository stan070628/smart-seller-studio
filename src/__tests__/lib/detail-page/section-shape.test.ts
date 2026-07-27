import { describe, it, expect } from 'vitest';
import { hasVisualAnchor, declaredCount, countedItems, countMismatch } from '@/lib/detail-page/section-shape';
import { validateProLayout } from '@/lib/detail-page/layout-validator';

const heading = (text: string) => ({ type: 'heading', text, size: 'lg' });
const bullets = (...items: string[]) => ({ type: 'bullet_list', items });

describe('hasVisualAnchor', () => {
  it('이미지·표·아이콘 등은 앵커로 본다', () => {
    for (const t of ['image', 'stat_row', 'icon_grid', 'option_grid', 'process_flow', 'spec_table']) {
      expect(hasVisualAnchor([{ type: t }])).toBe(true);
    }
  });

  it('불릿만 있는 섹션은 앵커가 없다 — 바로 이게 문제 상황이다', () => {
    expect(hasVisualAnchor([heading('제목'), { type: 'subtext', text: '문단' }, bullets('a', 'b')]))
      .toBe(false);
  });

  it('columns 안에 있어도 찾는다', () => {
    expect(hasVisualAnchor([{ type: 'columns', cols: [[bullets('a')], [{ type: 'image' }]] }]))
      .toBe(true);
  });

  it('columns 안에도 앵커가 없으면 false — 웨건 B안 비교 섹션이 이 모양이었다', () => {
    expect(hasVisualAnchor([
      heading('짐 나르기, 두 가지 방법'),
      { type: 'columns', cols: [[bullets('a', 'b')], [bullets('c', 'd')]] },
    ])).toBe(false);
  });
});

describe('declaredCount', () => {
  it('숫자·한글 수사 모두 읽는다', () => {
    expect(declaredCount('쓰기 전에 두 가지만')).toBe(2);
    expect(declaredCount('3가지 이유')).toBe(3);
    expect(declaredCount('네 가지 특징')).toBe(4);
  });

  // "개"·"매"는 제품 구성을 뜻하는 경우가 훨씬 많아 세지 않는다.
  it('가지가 아니면 세지 않는다', () => {
    expect(declaredCount('2매 세트')).toBeNull();
    expect(declaredCount('3개 구성')).toBeNull();
    expect(declaredCount('두 사이즈 사이라면 큰 쪽을 고르세요')).toBeNull();
    expect(declaredCount('M · L · XL · XXL')).toBeNull();
  });
});

describe('countedItems', () => {
  it('가장 큰 목록을 센다', () => {
    expect(countedItems([bullets('a', 'b'), { type: 'icon_grid', items: [1, 2, 3, 4] }])).toBe(4);
  });

  it('spec_table은 행 수로 센다', () => {
    expect(countedItems([{ type: 'spec_table', columns: ['a'], rows: [['1'], ['2']] }])).toBe(2);
  });

  it('셀 것이 없으면 null', () => {
    expect(countedItems([heading('제목')])).toBeNull();
  });
});

describe('countMismatch', () => {
  it('실제로 나왔던 불일치를 잡는다 — "두 가지만"인데 항목 4개', () => {
    expect(countMismatch('쓰기 전에 두 가지만', [bullets('a', 'b', 'c', 'd')]))
      .toEqual({ declared: 2, actual: 4 });
  });

  it('맞으면 null', () => {
    expect(countMismatch('두 가지만', [bullets('a', 'b')])).toBeNull();
  });

  it('헤드라인에 수량이 없거나 셀 것이 없으면 판정하지 않는다', () => {
    expect(countMismatch('제목', [bullets('a', 'b')])).toBeNull();
    expect(countMismatch('두 가지만', [heading('x')])).toBeNull();
  });
});

describe('validateProLayout 연결', () => {
  const sec = (blocks: unknown[]) => ({ type: 'claude_layout', title: 't', beat: 'detail', blocks });

  // warning인 이유: error면 isClean이 깨져 repair를 매번 부른다. 해법이 "다시
  // 생성"으로 같은데 Claude 호출만 는다. 대신 route가 이 코드를 배너로 건져 올린다.
  it('텍스트 전용 섹션을 warning으로 올린다 — isClean은 유지', () => {
    const { violations, isClean } = validateProLayout([sec([heading('제목'), bullets('a')])]);
    const v = violations.find((x) => x.code === 'visual_anchor');
    expect(v?.severity).toBe('warning');
    expect(v?.autoFixable).toBe(true);
    expect(isClean).toBe(true);
  });

  it('앵커가 있으면 올리지 않는다', () => {
    const { violations } = validateProLayout([sec([heading('제목'), { type: 'image', attachedIndex: 0 }])]);
    expect(violations.some((x) => x.code === 'visual_anchor')).toBe(false);
  });

  it('수량 불일치를 올린다', () => {
    const { violations } = validateProLayout([
      sec([heading('쓰기 전에 두 가지만'), { type: 'icon_grid', items: [1, 2, 3, 4] }]),
    ]);
    const v = violations.find((x) => x.code === 'count_mismatch');
    expect(v?.message).toContain('2가지');
    expect(v?.message).toContain('4개');
  });

  it('빈 blocks는 visual_anchor 대상이 아니다 — 스키마·빈블록 검사가 따로 잡는다', () => {
    const { violations } = validateProLayout([sec([])]);
    expect(violations.some((x) => x.code === 'visual_anchor')).toBe(false);
  });
});
