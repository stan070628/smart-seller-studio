import { describe, it, expect } from 'vitest';
import { checkNarrative, BEATS, ACCEPTED_BEATS } from '@/lib/detail-page/narrative';

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
    const sections = [sec('hook'), sec('detail'), compareSec(), sec('notice')];
    expect(checkNarrative(sections)).toEqual([]);
  });

  it('beat 필드가 없으면 beat_missing error', () => {
    const sections = [sec('hook'), { blocks: [] }, compareSec(), sec('notice')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.rule === 'beat_missing' && i.sectionIndex === 1)).toBe(true);
  });

  it('beat가 문자열이 아니면 beat_missing으로 처리한다', () => {
    const sections = [sec('hook'), { beat: 123, blocks: [] }, compareSec(), sec('notice')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.rule === 'beat_missing' && i.sectionIndex === 1)).toBe(true);
  });

  it('알 수 없는 beat 값은 beat_unknown error', () => {
    const sections = [sec('hook'), sec('나열'), compareSec(), sec('notice')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.rule === 'beat_unknown' && i.sectionIndex === 1)).toBe(true);
  });

  it('첫 섹션이 hook이 아니면 hook_first error', () => {
    const sections = [sec('detail'), sec('hook'), compareSec(), sec('notice')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.rule === 'hook_first' && i.sectionIndex === 0)).toBe(true);
  });

  it('첫 섹션에 beat가 없으면 beat_missing만 나오고 hook_first는 중복으로 나오지 않는다', () => {
    const sections = [{ blocks: [] }, sec('detail'), compareSec(), sec('notice')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.rule === 'beat_missing' && i.sectionIndex === 0)).toBe(true);
    expect(issues.some(i => i.rule === 'hook_first')).toBe(false);
  });

  it('compare가 하나도 없으면 compare_missing error', () => {
    const sections = [sec('hook'), sec('detail'), sec('notice')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.rule === 'compare_missing')).toBe(true);
  });

  it('compare 섹션에 columns 2단이 없으면 compare_structure error', () => {
    const sections = [sec('hook'), sec('compare'), sec('notice')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.rule === 'compare_structure' && i.sectionIndex === 1)).toBe(true);
  });

  it('cols가 1개뿐인 columns는 compare 구조로 인정하지 않는다', () => {
    const sections = [
      sec('hook'),
      sec('compare', [{ type: 'columns', cols: [[{ type: 'subtext', text: '하나' }]] }]),
      sec('notice'),
    ];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.rule === 'compare_structure' && i.sectionIndex === 1)).toBe(true);
  });

  it('compare 섹션이 2개면 각각 구조를 검사한다', () => {
    const sections = [
      sec('hook'),
      sec('compare'), // columns 없음 → 구조 위반
      compareSec(),   // columns 2단 있음 → 통과
      sec('notice'),
    ];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.rule === 'compare_structure' && i.sectionIndex === 1)).toBe(true);
    expect(issues.some(i => i.rule === 'compare_structure' && i.sectionIndex === 2)).toBe(false);
  });

  it('problem이 있는데 solution이 없으면 problem_without_solution error', () => {
    const sections = [sec('hook'), sec('problem'), compareSec(), sec('notice')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'error' && i.rule === 'problem_without_solution')).toBe(true);
  });

  it('problem과 solution이 둘 다 있으면 통과', () => {
    const sections = [sec('hook'), sec('problem'), sec('solution'), compareSec(), sec('notice')];
    expect(checkNarrative(sections).filter(i => i.severity === 'error')).toEqual([]);
  });

  it('notice가 마지막 3섹션 밖에 있으면 closing_tail warning', () => {
    const sections = [sec('hook'), sec('notice'), compareSec(), sec('detail'), sec('usecase'), sec('option')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'warning' && i.rule === 'closing_tail')).toBe(true);
  });

  it('notice가 아예 없어도 closing_tail warning', () => {
    const sections = [sec('hook'), sec('detail'), compareSec()];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.severity === 'warning' && i.rule === 'closing_tail')).toBe(true);
  });

  it('notice가 정확히 sections.length-3 위치에 있으면 통과한다 (경계값)', () => {
    // length=4, notice가 index1 = length-3 → 딱 걸쳐서 통과해야 한다
    const sections = [sec('hook'), sec('notice'), compareSec(), sec('detail')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.rule === 'closing_tail')).toBe(false);
  });

  // ── care는 마감을 대신하지 못한다 ────────────────────────────────────────
  // 분리의 목적이 "관리법과 고지를 각각 제 몫 하게 하는 것"이라, care 하나로
  // closing_tail이 닫히면 생성기가 예전처럼 한 섹션에 뭉쳐도 통과해버린다.
  it('care만 있고 notice가 없으면 closing_tail warning', () => {
    const sections = [sec('hook'), sec('detail'), compareSec(), sec('care')];
    const issues = checkNarrative(sections);
    expect(issues.some(i => i.rule === 'closing_tail')).toBe(true);
  });

  it('care와 notice가 나란히 있으면 통과한다', () => {
    const sections = [sec('hook'), sec('detail'), compareSec(), sec('care'), sec('notice')];
    expect(checkNarrative(sections)).toEqual([]);
  });

  // ── sizing ───────────────────────────────────────────────────────────────
  it('sizing 비트를 써도 beat_unknown이 나지 않는다', () => {
    const sections = [sec('hook'), sec('sizing'), compareSec(), sec('notice')];
    expect(checkNarrative(sections)).toEqual([]);
  });

  it('sizing이 없어도 이슈가 없다 — 치수 없는 상품(식품·잡화)이 있다', () => {
    const sections = [sec('hook'), sec('detail'), compareSec(), sec('notice')];
    expect(checkNarrative(sections)).toEqual([]);
  });

  // ── 레거시 assure ────────────────────────────────────────────────────────
  // 저장된 드래프트가 beat:'assure'를 갖고 있다. 값을 없애면 그 드래프트가
  // 로드·재저장 시점에 beat_unknown으로 깨지므로 검증에서는 계속 받는다.
  it('레거시 assure는 여전히 통과하고 closing_tail을 닫는다', () => {
    const sections = [sec('hook'), sec('detail'), compareSec(), sec('assure')];
    expect(checkNarrative(sections)).toEqual([]);
  });

  it('BEATS 목록은 다음과 같다 — 생성 정본. assure는 여기 없다', () => {
    expect(BEATS).toEqual([
      'hook', 'problem', 'solution', 'compare', 'evidence', 'detail', 'usecase',
      'option', 'sizing', 'care', 'notice',
    ]);
  });

  it('ACCEPTED_BEATS는 BEATS + 레거시 assure다', () => {
    expect(ACCEPTED_BEATS).toEqual([...BEATS, 'assure']);
  });

  it('beat_unknown 메시지는 BEATS만 안내한다 — 생성기가 assure를 다시 배우면 안 된다', () => {
    const issues = checkNarrative([sec('hook'), sec('없는비트'), compareSec(), sec('notice')]);
    const unknown = issues.find(i => i.rule === 'beat_unknown');
    expect(unknown?.message).not.toContain('assure');
    expect(unknown?.message).toContain('sizing');
  });

  it('빈 배열은 이슈를 만들지 않는다 (다른 검증이 담당)', () => {
    expect(checkNarrative([])).toEqual([]);
  });
});

describe('compare 섹션의 금지 표현', () => {
  it('배수 표현은 compare_claim warning + labels에 배수', () => {
    const issues = checkNarrative([sec('hook'), compareWithText('타사 대비 3배 빠른 건조'), sec('notice')]);
    const issue = issues.find(i => i.rule === 'compare_claim');
    expect(issue?.severity).toBe('warning');
    expect(issue?.sectionIndex).toBe(1);
    expect(issue?.labels).toContain('배수');
  });

  it('비교 표지어가 있는 퍼센트 표현은 compare_claim warning + labels에 퍼센트', () => {
    const issues = checkNarrative([sec('hook'), compareWithText('흡수력 40% 향상'), sec('notice')]);
    const issue = issues.find(i => i.rule === 'compare_claim');
    expect(issue?.severity).toBe('warning');
    expect(issue?.labels).toContain('퍼센트');
  });

  it('순위 표현은 compare_claim warning + labels에 순위', () => {
    const issues = checkNarrative([sec('hook'), compareWithText('업계 1위 흡수력'), sec('notice')]);
    const issue = issues.find(i => i.rule === 'compare_claim');
    expect(issue?.severity).toBe('warning');
    expect(issue?.labels).toContain('순위');
  });

  it('조사가 붙은 순위 표현("1위입니다")도 검출한다', () => {
    const issues = checkNarrative([sec('hook'), compareWithText('카테고리 판매량 1위입니다'), sec('notice')]);
    const issue = issues.find(i => i.rule === 'compare_claim');
    expect(issue?.severity).toBe('warning');
    expect(issue?.labels).toContain('순위');
  });

  it('조사가 붙은 배수 표현("3배나 뛰어납니다")도 검출한다', () => {
    const issues = checkNarrative([sec('hook'), compareWithText('흡수력이 3배나 뛰어납니다'), sec('notice')]);
    const issue = issues.find(i => i.rule === 'compare_claim');
    expect(issue?.severity).toBe('warning');
    expect(issue?.labels).toContain('배수');
  });

  it('숫자가 100이어도 비교 표지어가 있으면 검출한다 (기존 미탐 해소)', () => {
    const issues = checkNarrative([sec('hook'), compareWithText('흡수력 100% 향상'), sec('notice')]);
    expect(issues.some(i => i.rule === 'compare_claim' && i.severity === 'warning')).toBe(true);
  });

  it('비교 표지어가 있으면 소수점 퍼센트도 검출한다', () => {
    const issues = checkNarrative([sec('hook'), compareWithText('타사 대비 40.5% 빠른 건조'), sec('notice')]);
    expect(issues.some(i => i.rule === 'compare_claim' && i.severity === 'warning')).toBe(true);
  });

  it('헤더와 표 셀에 표지어와 수치가 나뉘어 있어도 섹션 전체 기준으로 검출한다', () => {
    const section = sec('compare', [
      { type: 'heading', text: '타사 대비', size: 'lg' },
      {
        type: 'columns',
        cols: [[{ type: 'subtext', text: '40% 단축' }], [{ type: 'subtext', text: '변화 없음' }]],
      },
    ]);
    const issues = checkNarrative([sec('hook'), section, sec('notice')]);
    const issue = issues.find(i => i.rule === 'compare_claim');
    expect(issue?.severity).toBe('warning');
    expect(issue?.sectionIndex).toBe(1);
    expect(issue?.labels).toContain('퍼센트');
  });

  it('카테고리 상식 비교는 통과', () => {
    const issues = checkNarrative([
      sec('hook'),
      compareWithText('면 100%는 땀을 머금어 무거워집니다'),
      sec('notice'),
    ]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(false);
  });

  it('비교 표지어 없는 조성비 표기(혼방)는 통과 (기존 오탐 해소)', () => {
    const issues = checkNarrative([
      sec('hook'),
      compareWithText('폴리에스터 65%, 면 35%'),
      sec('notice'),
    ]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(false);
  });

  it('소수점 조성비 표기도 통과 (기존 "0%" 오탐 해소)', () => {
    const issues = checkNarrative([
      sec('hook'),
      compareWithText('면 100.0%로 제작되었습니다'),
      sec('notice'),
    ]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(false);
  });

  it('알려진 한계: 비교 표지어 없는 주장은 놓친다', () => {
    // "더"는 COMPARATIVE_MARKER 목록에 없어 우위 주장이어도 검출하지 못한다.
    // 조성비 오탐을 없애는 대가로 받아들인 한계이며, 회귀 시 조용히
    // 사라지거나 늘어나지 않도록 이 테스트로 고정한다.
    const issues = checkNarrative([sec('hook'), compareWithText('40% 더 빠른 건조'), sec('notice')]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(false);
  });

  it('알려진 한계: 조성비 문장에 마커 어휘가 섞이면 오탐한다 (의도된 트레이드오프)', () => {
    // "개선"이 COMPARATIVE_MARKER라서, 조성비를 설명하는 문장이어도 걸린다.
    // 미탐(실증 책임 있는 주장을 놓치는 것)이 오탐(노이즈)보다 비용이 크다고
    // 판단해 받아들인 한계이며, 회귀 시 이 동작이 바뀌면 의도적으로 검토해야
    // 하므로 여기 고정한다.
    const issues = checkNarrative([
      sec('hook'),
      compareWithText('면 100% 원단으로 통기성이 개선되었습니다'),
      sec('notice'),
    ]);
    const issue = issues.find(i => i.rule === 'compare_claim');
    expect(issue?.severity).toBe('warning');
    expect(issue?.labels).toContain('퍼센트');
  });

  it('"50위안" 같은 가격 표기는 순위로 오탐하지 않는다', () => {
    const issues = checkNarrative([
      sec('hook'),
      compareWithText('원가는 50위안입니다'),
      sec('notice'),
    ]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(false);
  });

  it('"2배수 구조"는 배수 주장으로 오탐하지 않는다', () => {
    const issues = checkNarrative([
      sec('hook'),
      compareWithText('2배수 구조로 안정적입니다'),
      sec('notice'),
    ]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(false);
  });

  it('compare가 아닌 섹션의 수치 표현은 검사하지 않는다', () => {
    const issues = checkNarrative([
      sec('hook'),
      sec('detail', [{ type: 'subtext', text: '타사 대비 3배 빠른 건조' }]),
      compareSec(),
      sec('notice'),
    ]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(false);
  });

  it('leaf 경계에서 앞 leaf의 숫자와 뒤 leaf의 음절이 붙어 순위로 오탐하지 않는다', () => {
    // 같은 배열(items) 안 인접 leaf는 사이에 다른 필드가 끼지 않아 공백 join이면
    // "재고 30" + "위탁 판매" → "30 위탁"이 순위 정규식에 걸린다.
    const section = sec('compare', [{ type: 'bullet_list', items: ['재고 30', '위탁 판매'] }]);
    const issues = checkNarrative([sec('hook'), section, sec('notice')]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(false);
  });

  it('leaf 경계에서 앞 leaf의 숫자와 뒤 leaf의 음절이 붙어 배수로 오탐하지 않는다', () => {
    // 공백으로 이어붙이면 "옵션 3" + "배기 성능" → "3 배기"가 배수 정규식에 걸린다.
    const section = sec('compare', [{ type: 'bullet_list', items: ['옵션 3', '배기 성능'] }]);
    const issues = checkNarrative([sec('hook'), section, sec('notice')]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(false);
  });

  it('퍼센트 인코딩 URL의 숫자를 퍼센트 주장으로 오탐하지 않는다', () => {
    // LayoutBlock의 image 변형에는 스키마상 url 필드가 없어 정상 경로에선 등장하지
    // 않지만, zod가 non-strict라 LLM이 규격 외 url 키를 덤으로 붙여도 attachedIndex가
    // 있으면 그 블록은 pruneBlocks를 통과해 checkNarrative까지 살아남는다.
    // "%ED%95%9C" 안의 "95%"가 퍼센트로, "타사 대비"가 비교 표지어로 잡힐 수 있다.
    const section = sec('compare', [
      { type: 'columns', cols: [
        [{ type: 'subtext', text: '타사 대비' }],
        [{ type: 'image', attachedIndex: 0, url: 'https://cdn.example.com/img/%ED%95%9C%EA%B5%AD.jpg' }],
      ] },
    ]);
    const issues = checkNarrative([sec('hook'), section, sec('notice')]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(false);
  });

  it('문장 중간에 임베드된 URL도 부분 치환으로 걸러낸다 (앵커 매칭이면 놓친다)', () => {
    // 가드가 "문자열 전체가 URL"에만 앵커돼 있으면 "자세히는 https://...%95... 참고"
    // 같은 임베드 형태는 그대로 뚫린다. 부분 치환이어야 이 경우도 막는다.
    const section = sec('compare', [
      { type: 'subtext', text: '자세히는 https://cdn.example.com/%ED%95%9C.jpg 참고 (타사 대비 성능)' },
    ]);
    const issues = checkNarrative([sec('hook'), section, sec('notice')]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(false);
  });

  it('한 leaf 안에서 URL을 공백으로 치환하면 앞뒤 숫자·음절이 붙어 배수로 오탐한다 (회귀 방지)', () => {
    // 실측 오탐: "옵션 3 https://cdn.example.com/a.jpg 배기 성능"을 URL→공백 치환하면
    // "옵션 3   배기 성능"이 되어 "3 배"가 배수 정규식에 걸린다. URL 치환자를
    // 구분자와 동일한 ' | '로 바꾸면 "옵션 3  |  배기 성능"이 되어 걸리지 않는다.
    const section = sec('compare', [
      { type: 'subtext', text: '옵션 3 https://cdn.example.com/a.jpg 배기 성능' },
    ]);
    const issues = checkNarrative([sec('hook'), section, sec('notice')]);
    expect(issues.some(i => i.rule === 'compare_claim')).toBe(false);
  });

  it('stat_row처럼 value/unit이 별개 필드여도 "1위" 붙인 형태로 순위를 검출한다', () => {
    // " | " 구분자가 leaf 경계 오탐(위 두 테스트)을 막는 대가로 stat_row의
    // { value:'1', unit:'위' }를 "1"과 "위"로 갈라놓아 "판매 1위" 같은 실증 책임이
    // 가장 무거운 표현을 놓칠 뻔했다. forEachValueUnitPair가 이 붙인 형태를
    // 별도로 복원해야 검출된다.
    const section = sec('compare', [
      {
        type: 'columns',
        cols: [
          [{ type: 'stat_row', items: [{ label: '판매', value: '1', unit: '위' }] }],
          [{ type: 'subtext', text: '우리' }],
        ],
      },
    ]);
    const issues = checkNarrative([sec('hook'), section, sec('notice')]);
    const issue = issues.find(i => i.rule === 'compare_claim');
    expect(issue?.severity).toBe('warning');
    expect(issue?.labels).toContain('순위');
  });
});
