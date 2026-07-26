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

export interface NarrativeIssue {
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
 * compare 섹션에서 금지하는 표현.
 * 근거 없는 우위 주장은 실증 책임이 걸린다 — 카테고리 공지의 사실만 허용한다.
 * severity가 warning이므로 오탐 비용이 낮아 패턴을 단순하게 둔다.
 *
 * 단, 퍼센트는 예외가 있다: "100%"는 "면 100%"처럼 소재 구성비를 가리키는
 * 경우가 흔해 우위 주장이 아니다. 100이 아닌 다른 수치의 퍼센트만 검출한다.
 */
const FORBIDDEN_COMPARE: ReadonlyArray<{ label: string; test: (s: string) => boolean }> = [
  { label: '배수', test: (s) => /\d+\s*배/.test(s) },
  {
    label: '퍼센트',
    test: (s) => {
      const matches = [...s.matchAll(/(\d+)\s*%/g)];
      return matches.some((m) => m[1] !== '100');
    },
  },
  { label: '순위', test: (s) => /\d+\s*위/.test(s) },
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
      issues.push({ message: `sections[${i}]에 beat 필드가 없습니다.`, severity: 'error' });
      beats.push(null);
      return;
    }
    if (!BEAT_SET.has(raw)) {
      issues.push({
        message: `sections[${i}]의 beat "${raw}"는 정의되지 않은 값입니다. 허용: ${BEATS.join(', ')}`,
        severity: 'error',
      });
      beats.push(null);
      return;
    }
    beats.push(raw);
  });

  // 첫 섹션은 hook
  if (beats[0] !== null && beats[0] !== 'hook') {
    issues.push({ message: `첫 섹션의 beat는 hook이어야 합니다 (현재: ${beats[0]}).`, severity: 'error' });
  }

  // compare 최소 1개 + 구조 조건
  const compareIdx = beats.reduce<number[]>((acc, b, i) => (b === 'compare' ? [...acc, i] : acc), []);
  if (compareIdx.length === 0) {
    issues.push({
      message: '비교(compare) 섹션이 없습니다. 기존 방식 대비 우위를 보여주는 섹션이 최소 1개 필요합니다.',
      severity: 'error',
    });
  } else {
    for (const i of compareIdx) {
      if (!hasCompareStructure(sections[i]?.blocks)) {
        issues.push({
          message: `sections[${i}]는 beat=compare지만 columns 2단 대비 구조가 없습니다.`,
          severity: 'error',
        });
      }
      // 근거 없는 우위 주장 검출 — 프롬프트 지시만으로는 막히지 않는다
      const found = new Set<string>();
      forEachString(sections[i]?.blocks, (s) => {
        for (const { label, test } of FORBIDDEN_COMPARE) {
          if (test(s)) found.add(label);
        }
      });
      if (found.size > 0) {
        issues.push({
          message: `sections[${i}](compare)에 ${[...found].join('·')} 표현이 있습니다. 카테고리 공지의 사실만 쓰세요.`,
          severity: 'warning',
        });
      }
    }
  }

  // problem이 있으면 solution도 있어야 한다 (미완결 서사 방지)
  if (beats.includes('problem') && !beats.includes('solution')) {
    issues.push({
      message: 'problem 섹션이 있는데 solution 섹션이 없습니다. 문제를 제기했으면 해법을 보여야 합니다.',
      severity: 'error',
    });
  }

  // assure는 끝부분에
  const assureIdx = beats.lastIndexOf('assure');
  if (assureIdx === -1 || assureIdx < sections.length - ASSURE_TAIL) {
    issues.push({
      message: `assure 섹션이 마지막 ${ASSURE_TAIL}개 섹션 안에 없습니다.`,
      severity: 'warning',
    });
  }

  return issues;
}
