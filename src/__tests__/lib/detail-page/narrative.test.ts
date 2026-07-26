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

describe('checkNarrative', () => {
  it('규칙을 모두 지킨 레이아웃은 이슈가 없다', () => {
    const sections = [sec('hook'), sec('detail'), compareSec(), sec('assure')];
    expect(checkNarrative(sections)).toEqual([]);
  });

  it('beat 필드가 없으면 error', () => {
    const sections = [sec('hook'), { blocks: [] }, compareSec(), sec('assure')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.message.includes('beat'))).toBe(true);
  });

  it('알 수 없는 beat 값은 error', () => {
    const sections = [sec('hook'), sec('나열'), compareSec(), sec('assure')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.message.includes('나열'))).toBe(true);
  });

  it('첫 섹션이 hook이 아니면 error', () => {
    const sections = [sec('detail'), sec('hook'), compareSec(), sec('assure')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.message.includes('hook'))).toBe(true);
  });

  it('compare가 하나도 없으면 error', () => {
    const sections = [sec('hook'), sec('detail'), sec('assure')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.message.includes('비교'))).toBe(true);
  });

  it('compare 섹션에 columns 2단이 없으면 error', () => {
    const sections = [sec('hook'), sec('compare'), sec('assure')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.message.includes('columns'))).toBe(true);
  });

  it('cols가 1개뿐인 columns는 compare 구조로 인정하지 않는다', () => {
    const sections = [
      sec('hook'),
      sec('compare', [{ type: 'columns', cols: [[{ type: 'subtext', text: '하나' }]] }]),
      sec('assure'),
    ];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.message.includes('columns'))).toBe(true);
  });

  it('problem이 있는데 solution이 없으면 error', () => {
    const sections = [sec('hook'), sec('problem'), compareSec(), sec('assure')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.message.includes('solution'))).toBe(true);
  });

  it('problem과 solution이 둘 다 있으면 통과', () => {
    const sections = [sec('hook'), sec('problem'), sec('solution'), compareSec(), sec('assure')];
    expect(checkNarrative(sections).filter(i => i.severity === 'error')).toEqual([]);
  });

  it('assure가 마지막 3섹션 밖에 있으면 warning', () => {
    const sections = [sec('hook'), sec('assure'), compareSec(), sec('detail'), sec('usecase'), sec('option')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'warning' && i.message.includes('assure'))).toBe(true);
  });

  it('assure가 아예 없어도 warning', () => {
    const sections = [sec('hook'), sec('detail'), compareSec()];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'warning' && i.message.includes('assure'))).toBe(true);
  });

  it('BEATS는 9종이다', () => {
    expect(BEATS).toHaveLength(9);
  });

  it('빈 배열은 이슈를 만들지 않는다 (다른 검증이 담당)', () => {
    expect(checkNarrative([])).toEqual([]);
  });
});

describe('compare 섹션의 금지 표현', () => {
  /** columns 구조를 갖추되 텍스트만 바꾼 compare 섹션 */
  function compareWithText(text: string) {
    return sec('compare', [
      { type: 'columns', cols: [[{ type: 'subtext', text }], [{ type: 'subtext', text: '우리' }]] },
    ]);
  }

  it('배수 표현은 warning', () => {
    const issues = checkNarrative([sec('hook'), compareWithText('타사 대비 3배 빠른 건조'), sec('assure')]);
    expect(issues.some(i => i.severity === 'warning' && i.message.includes('배수'))).toBe(true);
  });

  it('퍼센트 표현은 warning', () => {
    const issues = checkNarrative([sec('hook'), compareWithText('흡수력 40% 향상'), sec('assure')]);
    expect(issues.some(i => i.severity === 'warning' && i.message.includes('퍼센트'))).toBe(true);
  });

  it('순위 표현은 warning', () => {
    const issues = checkNarrative([sec('hook'), compareWithText('업계 1위 흡수력'), sec('assure')]);
    expect(issues.some(i => i.severity === 'warning' && i.message.includes('순위'))).toBe(true);
  });

  it('카테고리 상식 비교는 통과', () => {
    const issues = checkNarrative([
      sec('hook'),
      compareWithText('면 100%는 땀을 머금어 무거워집니다'),
      sec('assure'),
    ]);
    expect(issues.some(i => i.message.includes('배수') || i.message.includes('퍼센트') || i.message.includes('순위'))).toBe(false);
  });

  it('compare가 아닌 섹션의 수치 표현은 검사하지 않는다', () => {
    const issues = checkNarrative([
      sec('hook'),
      sec('detail', [{ type: 'subtext', text: '3배 두꺼운 원단' }]),
      compareSec(),
      sec('assure'),
    ]);
    expect(issues.some(i => i.message.includes('배수'))).toBe(false);
  });
});
