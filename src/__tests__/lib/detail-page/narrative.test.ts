import { describe, it, expect } from 'vitest';
import { checkNarrative, BEATS } from '@/lib/detail-page/narrative';

/** beat를 지정한 최소 섹션 */
function sec(beat: string, blocks: unknown[] = [{ type: 'heading', text: 'x', size: 'xl' }]) {
  return { beat, blocks };
}

/** compare 섹션은 columns 2단을 가져야 통과한다 */
function compareSec() {
  return sec('compare', [
    { type: 'columns', cols: [[{ type: 'subtext', text: '기존' }], [{ type: 'subtext', text: '우리' }]] },
  ]);
}

/** columns 구조를 갖추되 텍스트만 바꾼 compare 섹션 */
function compareWithText(text: string) {
  return sec('compare', [
    { type: 'columns', cols: [[{ type: 'subtext', text }], [{ type: 'subtext', text: '우리' }]] },
  ]);
}

describe('checkNarrative', () => {
  it('규칙을 모두 지킨 레이아웃은 이슈가 없다', () => {
    const sections = [sec('hook'), sec('detail'), compareSec(), sec('assure')];
    expect(checkNarrative(sections)).toEqual([]);
  });

  it('beat 필드가 없으면 beat_missing error', () => {
    const sections = [sec('hook'), { blocks: [] }, compareSec(), sec('assure')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.rule === 'beat_missing' && i.sectionIndex === 1)).toBe(true);
  });

  it('beat가 문자열이 아니면 beat_missing으로 처리한다', () => {
    const sections = [sec('hook'), { beat: 123, blocks: [] }, compareSec(), sec('assure')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.rule === 'beat_missing' && i.sectionIndex === 1)).toBe(true);
  });

  it('알 수 없는 beat 값은 beat_unknown error', () => {
    const sections = [sec('hook'), sec('나열'), compareSec(), sec('assure')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.rule === 'beat_unknown' && i.sectionIndex === 1)).toBe(true);
  });

  it('첫 섹션이 hook이 아니면 hook_first error', () => {
    const sections = [sec('detail'), sec('hook'), compareSec(), sec('assure')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.rule === 'hook_first' && i.sectionIndex === 0)).toBe(true);
  });

  it('첫 섹션에 beat가 없으면 beat_missing만 나오고 hook_first는 중복으로 나오지 않는다', () => {
    const sections = [{ blocks: [] }, sec('detail'), compareSec(), sec('assure')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.rule === 'beat_missing' && i.sectionIndex === 0)).toBe(true);
    expect(issues.some(i => i.rule === 'hook_first')).toBe(false);
  });

  it('compare가 하나도 없으면 compare_missing error', () => {
    const sections = [sec('hook'), sec('detail'), sec('assure')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.rule === 'compare_missing')).toBe(true);
  });

  it('compare 섹션에 columns 2단이 없으면 compare_structure error', () => {
    const sections = [sec('hook'), sec('compare'), sec('assure')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.rule === 'compare_structure' && i.sectionIndex === 1)).toBe(true);
  });

  it('cols가 1개뿐인 columns는 compare 구조로 인정하지 않는다', () => {
    const sections = [
      sec('hook'),
      sec('compare', [{ type: 'columns', cols: [[{ type: 'subtext', text: '하나' }]] }]),
      sec('assure'),
    ];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.rule === 'compare_structure' && i.sectionIndex === 1)).toBe(true);
  });

  it('compare 섹션이 2개면 각각 구조를 검사한다', () => {
    const sections = [
      sec('hook'),
      sec('compare'), // columns 없음 → 구조 위반
      compareSec(),   // columns 2단 있음 → 통과
      sec('assure'),
    ];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.rule === 'compare_structure' && i.sectionIndex === 1)).toBe(true);
    expect(issues.some(i => i.rule === 'compare_structure' && i.sectionIndex === 2)).toBe(false);
  });

  it('problem이 있는데 solution이 없으면 problem_without_solution error', () => {
    const sections = [sec('hook'), sec('problem'), compareSec(), sec('assure')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.rule === 'problem_without_solution')).toBe(true);
  });

  it('problem과 solution이 둘 다 있으면 통과', () => {
    const sections = [sec('hook'), sec('problem'), sec('solution'), compareSec(), sec('assure')];
    expect(checkNarrative(sections).filter(i => i.severity === 'error')).toEqual([]);
  });

  it('assure가 마지막 3섹션 밖에 있으면 assure_tail warning', () => {
    const sections = [sec('hook'), sec('assure'), compareSec(), sec('detail'), sec('usecase'), sec('option')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'warning' && i.rule === 'assure_tail')).toBe(true);
  });

  it('assure가 아예 없어도 assure_tail warning', () => {
    const sections = [sec('hook'), sec('detail'), compareSec()];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'warning' && i.rule === 'assure_tail')).toBe(true);
  });

  it('assure가 정확히 sections.length-3 위치에 있으면 통과한다 (경계값)', () => {
    // length=4, assure가 index1 = length-3 → 딱 걸쳐서 통과해야 한다
    const sections = [sec('hook'), sec('assure'), compareSec(), sec('detail')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.rule === 'assure_tail')).toBe(false);
  });

  it('BEATS 목록은 다음과 같다', () => {
    expect(BEATS).toEqual([
      'hook', 'problem', 'solution', 'compare', 'evidence', 'detail', 'usecase', 'option', 'assure',
    ]);
  });

  it('빈 배열은 이슈를 만들지 않는다 (다른 검증이 담당)', () => {
    expect(checkNarrative([])).toEqual([]);
  });
});

describe('compare 섹션의 금지 표현', () => {
  it('배수 표현은 compare_claim warning', () => {
    const issues = checkNarrative([sec('hook'), compareWithText('타사 대비 3배 빠른 건조'), sec('assure')]);
    expect(issues.some(i => i.severity === 'warning' && i.rule === 'compare_claim')).toBe(true);
  });

  it('비교 표지어가 있는 퍼센트 표현은 compare_claim warning', () => {
    const issues = checkNarrative([sec('hook'), compareWithText('흡수력 40% 향상'), sec('assure')]);
    expect(issues.some(i => i.severity === 'warning' && i.rule === 'compare_claim')).toBe(true);
  });

  it('숫자가 100이어도 비교 표지어가 있으면 검출한다 (기존 미탐 해소)', () => {
    const issues = checkNarrative([sec('hook'), compareWithText('흡수력 100% 향상'), sec('assure')]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(true);
  });

  it('비교 표지어가 있으면 소수점 퍼센트도 검출한다', () => {
    const issues = checkNarrative([sec('hook'), compareWithText('타사 대비 40.5% 빠른 건조'), sec('assure')]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(true);
  });

  it('순위 표현은 compare_claim warning', () => {
    const issues = checkNarrative([sec('hook'), compareWithText('업계 1위 흡수력'), sec('assure')]);
    expect(issues.some(i => i.severity === 'warning' && i.rule === 'compare_claim')).toBe(true);
  });

  it('카테고리 상식 비교는 통과', () => {
    const issues = checkNarrative([
      sec('hook'),
      compareWithText('면 100%는 땀을 머금어 무거워집니다'),
      sec('assure'),
    ]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(false);
  });

  it('비교 표지어 없는 조성비 표기(혼방)는 통과 (기존 오탐 해소)', () => {
    const issues = checkNarrative([
      sec('hook'),
      compareWithText('폴리에스터 65%, 면 35%'),
      sec('assure'),
    ]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(false);
  });

  it('소수점 조성비 표기도 통과 (기존 "0%" 오탐 해소)', () => {
    const issues = checkNarrative([
      sec('hook'),
      compareWithText('면 100.0%로 제작되었습니다'),
      sec('assure'),
    ]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(false);
  });

  it('알려진 한계: 비교 표지어 없는 주장은 놓친다', () => {
    // "더"는 COMPARATIVE_MARKER 목록에 없어 우위 주장이어도 검출하지 못한다.
    // 조성비 오탐을 없애는 대가로 받아들인 한계이며, 회귀 시 조용히
    // 사라지거나 늘어나지 않도록 이 테스트로 고정한다.
    const issues = checkNarrative([sec('hook'), compareWithText('40% 더 빠른 건조'), sec('assure')]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(false);
  });

  it('"50위안" 같은 가격 표기는 순위로 오탐하지 않는다', () => {
    const issues = checkNarrative([
      sec('hook'),
      compareWithText('원가는 50위안입니다'),
      sec('assure'),
    ]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(false);
  });

  it('"2배수 구조"는 배수 주장으로 오탐하지 않는다', () => {
    const issues = checkNarrative([
      sec('hook'),
      compareWithText('2배수 구조로 안정적입니다'),
      sec('assure'),
    ]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(false);
  });

  it('compare가 아닌 섹션의 수치 표현은 검사하지 않는다', () => {
    const issues = checkNarrative([
      sec('hook'),
      sec('detail', [{ type: 'subtext', text: '타사 대비 3배 빠른 건조' }]),
      compareSec(),
      sec('assure'),
    ]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(false);
  });
});
