/**
 * 서사(narrative) 검증 — PRO 레이아웃이 스펙 나열이 아니라 아크를 갖는지 본다.
 * 순수 함수만 두고 Violation 변환은 layout-validator가 담당한다.
 */

/** 섹션이 아크에서 맡는 역할. 검증이 참조하는 것은 hook/problem/solution/compare/assure 5종이다. */
export const BEATS = [
  'hook',      // 첫 화면. 이게 뭐고 왜 봐야 하는가
  'problem',   // 기존 방식·대체재의 불편
  'solution',  // 우리 제품이 그것을 어떻게 푸는가
  'compare',   // 기존 방식 대비 우위
  'evidence',  // 관찰 가능한 근거
  'detail',    // 물리적 마감·소재·구조
  'usecase',   // 언제 어디서 쓰는가
  'option',    // 색상·사이즈 등 선택지
  'assure',    // 세탁·보관·제품정보
] as const;

export type Beat = (typeof BEATS)[number];

const BEAT_SET: ReadonlySet<string> = new Set(BEATS);

/**
 * 위반 규칙 코드. layout-validator가 이걸 그대로 Violation.code로 옮겨 쓴다 —
 * 한국어 메시지를 정규식으로 파싱해 분기하지 않도록, 규칙은 항상 이 코드로 식별한다.
 */
export type NarrativeRule =
  | 'beat_missing'
  | 'beat_unknown'
  | 'hook_first'
  | 'compare_missing'
  | 'compare_structure'
  | 'compare_claim'
  | 'problem_without_solution'
  | 'assure_tail';

export interface NarrativeIssue {
  rule: NarrativeRule;
  /** 섹션 단위 규칙에만 채운다. compare_missing·problem_without_solution처럼
   *  레이아웃 전체를 보는 규칙은 특정 섹션 하나를 가리키지 않으므로 비워둔다. */
  sectionIndex?: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface NarrativeSection {
  beat?: unknown;
  blocks?: unknown;
}

/** assure가 이 위치 안에 있어야 한다 — 뒤에서 세 섹션 */
const ASSURE_TAIL = 3;

/**
 * 우위 주장임을 드러내는 표지어. 이것이 같은 문자열에 없으면 퍼센트는
 * 조성비·함량 진술("면 60% 폴리 40%", "당 함량 5%")로 보고 통과시킨다.
 *
 * 알려진 한계: 표지어 목록에 없는 부사로 우위를 주장하면 검출을 놓친다
 * (예: "40% 더 빠른 건조" — "더"는 마커가 아니다). 조성비 오탐을 없애기
 * 위해 의도적으로 받아들인 트레이드오프이며, 아래 테스트
 * ("알려진 한계: 비교 표지어 없는 주장은 놓친다")로 고정해 회귀 시
 * 이 한계가 조용히 사라지거나 늘어나지 않게 한다.
 */
const COMPARATIVE_MARKER = /(대비|보다|향상|증가|절감|개선|상승|우위|뛰어)/;

/**
 * compare 섹션에서 금지하는 표현.
 * 근거 없는 우위 주장은 실증 책임이 걸린다 — 카테고리 공지의 사실만 허용한다.
 * severity가 warning이므로 오탐 비용이 낮아 패턴을 단순하게 둔다.
 *
 * compare 섹션에만 적용하는 이유: "1위"·"40% 향상" 같은 과장 표현이
 * 전역 광고 심의 대상(PROHIBITED_PHRASES_ABSOLUTE)에도 속해야 하는지는
 * 별도 관심사라 후속 태스크로 미룬다. 여기서는 "compare 섹션에서 근거
 * 없는 상대 비교를 하지 말라"는 서사 규칙만 강제한다.
 *
 * 배수·순위는 뒤에 한글 음절이 이어지면 매칭하지 않는다 — 이 프로젝트는
 * 1688 중국 사입가를 다루므로 "50위안"이 순위로, "2배수 구조"가 배수로
 * 오탐하는 사례가 실재한다. "3배 빠른"·"1위 흡수력"처럼 수치+단위 뒤에
 * 공백이 오는 정상 탐지에는 영향이 없다.
 */
const FORBIDDEN_COMPARE: ReadonlyArray<{ label: string; test: (s: string) => boolean }> = [
  { label: '배수', test: (s) => /\d+\s*배(?![가-힣])/.test(s) },
  {
    label: '퍼센트',
    test: (s) => /\d+(?:\.\d+)?\s*%/.test(s) && COMPARATIVE_MARKER.test(s),
  },
  { label: '순위', test: (s) => /\d+\s*위(?![가-힣])/.test(s) },
];

/** 값 트리의 모든 문자열에 콜백을 적용한다 */
function forEachString(node: unknown, cb: (s: string) => void): void {
  if (typeof node === 'string') { cb(node); return; }
  if (Array.isArray(node)) { node.forEach((v) => forEachString(v, cb)); return; }
  if (node !== null && typeof node === 'object') {
    Object.values(node as Record<string, unknown>).forEach((v) => forEachString(v, cb));
  }
}

/**
 * compare 섹션은 columns 2단 이상을 가져야 한다.
 * beat는 LLM 자기신고 라벨이라 구조 조건을 걸지 않으면 라벨만 붙이고 통과한다.
 */
function hasCompareStructure(blocks: unknown): boolean {
  if (!Array.isArray(blocks)) return false;
  return blocks.some((b) => {
    if (!b || typeof b !== 'object') return false;
    const block = b as Record<string, unknown>;
    return block.type === 'columns' && Array.isArray(block.cols) && block.cols.length >= 2;
  });
}

/** 서사 규칙 위반 목록을 반환한다. 위반이 없으면 빈 배열. */
export function checkNarrative(sections: NarrativeSection[]): NarrativeIssue[] {
  if (!Array.isArray(sections) || sections.length === 0) return [];

  const issues: NarrativeIssue[] = [];
  const beats: (string | null)[] = [];

  sections.forEach((sec, i) => {
    const raw = sec?.beat;
    if (typeof raw !== 'string' || raw.trim() === '') {
      issues.push({
        rule: 'beat_missing',
        sectionIndex: i,
        message: `sections[${i}]에 beat 필드가 없습니다.`,
        severity: 'error',
      });
      beats.push(null);
      return;
    }
    if (!BEAT_SET.has(raw)) {
      issues.push({
        rule: 'beat_unknown',
        sectionIndex: i,
        message: `sections[${i}]의 beat "${raw}"는 정의되지 않은 값입니다. 허용: ${BEATS.join(', ')}`,
        severity: 'error',
      });
      beats.push(null);
      return;
    }
    beats.push(raw);
  });

  // 첫 섹션은 hook. beat 자체가 없거나 알 수 없는 값이면 위에서 이미
  // beat_missing/beat_unknown을 냈으므로 hook_first를 중복으로 내지 않는다.
  if (beats[0] !== null && beats[0] !== 'hook') {
    issues.push({
      rule: 'hook_first',
      sectionIndex: 0,
      message: `첫 섹션의 beat는 hook이어야 합니다 (현재: ${beats[0]}).`,
      severity: 'error',
    });
  }

  // compare 최소 1개 + 구조 조건
  const compareIdx = beats.flatMap((b, i) => (b === 'compare' ? [i] : []));
  if (compareIdx.length === 0) {
    issues.push({
      rule: 'compare_missing',
      message: '비교(compare) 섹션이 없습니다. 기존 방식 대비 우위를 보여주는 섹션이 최소 1개 필요합니다.',
      severity: 'error',
    });
  } else {
    for (const i of compareIdx) {
      if (!hasCompareStructure(sections[i].blocks)) {
        issues.push({
          rule: 'compare_structure',
          sectionIndex: i,
          message: `sections[${i}]는 beat=compare지만 columns 2단 대비 구조가 없습니다.`,
          severity: 'error',
        });
      }
      // 근거 없는 우위 주장 검출 — 프롬프트 지시만으로는 막히지 않는다
      const found = new Set<string>();
      forEachString(sections[i].blocks, (s) => {
        for (const { label, test } of FORBIDDEN_COMPARE) {
          if (test(s)) found.add(label);
        }
      });
      if (found.size > 0) {
        issues.push({
          rule: 'compare_claim',
          sectionIndex: i,
          message: `sections[${i}](compare)에 ${[...found].join('·')} 표현이 있습니다. 카테고리 공지의 사실만 쓰세요.`,
          severity: 'warning',
        });
      }
    }
  }

  // problem이 있으면 solution도 있어야 한다 (미완결 서사 방지)
  if (beats.includes('problem') && !beats.includes('solution')) {
    issues.push({
      rule: 'problem_without_solution',
      message: 'problem 섹션이 있는데 solution 섹션이 없습니다. 문제를 제기했으면 해법을 보여야 합니다.',
      severity: 'error',
    });
  }

  // assure는 끝부분에
  const assureIdx = beats.lastIndexOf('assure');
  if (assureIdx === -1 || assureIdx < sections.length - ASSURE_TAIL) {
    issues.push({
      rule: 'assure_tail',
      ...(assureIdx === -1 ? {} : { sectionIndex: assureIdx }),
      message: `assure 섹션이 마지막 ${ASSURE_TAIL}개 섹션 안에 없습니다.`,
      severity: 'warning',
    });
  }

  return issues;
}
