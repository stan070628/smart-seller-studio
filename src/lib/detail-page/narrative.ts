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
  /** compare_claim에만 채운다 — 어떤 종류의 주장인지(배수/퍼센트/순위).
   *  소비자가 "퍼센트 주장만 자동수정" 같은 종류별 분기를 하려면 한국어
   *  message를 파싱하지 않고 이 배열을 봐야 한다. */
  labels?: string[];
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
 * 우위 주장임을 드러내는 표지어. compare 섹션 전체(헤더+표 셀 등 모든 leaf를
 * 이어붙인 텍스트) 기준으로 이것이 없으면 퍼센트는 조성비·함량 진술
 * ("면 60% 폴리 40%", "당 함량 5%")로 보고 통과시킨다.
 *
 * 알려진 한계 두 가지 — 어느 쪽으로도 완전할 수 없어 트레이드오프를 선택했다:
 *
 * 1) 미탐: 표지어 목록에 없는 부사로 우위를 주장하면 놓친다
 *    (예: "40% 더 빠른 건조" — "더"는 마커가 아니다).
 * 2) 오탐: 조성비·마감 설명 문장에 이 표지어 어휘가 우연히 섞이면 잘못 검출한다
 *    (예: "면 100% 원단으로 통기성이 개선되었습니다" — "개선"이 마커라서 걸린다).
 *
 * severity가 warning(비차단)이므로 두 위험의 크기가 다르다: 미탐(1)은 "판매 1위"·
 * "타사 대비 개선"처럼 표시광고법상 실증 책임이 걸리는 주장을 그대로 흘려보내는
 * 반면, 오탐(2)은 사람이 한 번 더 보고 넘기면 그만인 노이즈다. 그래서 마커
 * 목록을 좁혀 미탐을 줄이는 대신 오탐이 늘어나는 쪽을 택했다. 두 한계 모두
 * 아래 "알려진 한계" 테스트로 고정해 회귀 시 조용히 사라지거나 늘어나지 않게 한다.
 */
const COMPARATIVE_MARKER = /(대비|보다|향상|증가|절감|개선|상승|우위|뛰어)/;

/**
 * compare 섹션에서 금지하는 표현.
 * 근거 없는 우위 주장은 실증 책임이 걸린다 — 카테고리 공지의 사실만 허용한다.
 *
 * compare 섹션에만 적용하는 이유: "1위"·"40% 향상" 같은 과장 표현이
 * 전역 광고 심의 대상(PROHIBITED_PHRASES_ABSOLUTE)에도 속해야 하는지는
 * 별도 관심사라 후속 태스크로 미룬다. 여기서는 "compare 섹션에서 근거
 * 없는 상대 비교를 하지 말라"는 서사 규칙만 강제한다.
 *
 * 이 패턴들은 개별 leaf 문자열이 아니라 checkNarrative가 만든
 * "섹션 전체를 이어붙인 텍스트"에 적용된다 — compare 섹션은 정의상
 * columns 2단 구조라, "타사 대비"는 헤더에 두고 수치는 표 셀에 두는
 * 배치가 오히려 자연스러운 산출물이기 때문이다. leaf 단위로 판정하면
 * 이 전형적인 배치에서 뚫린다.
 *
 * 배수·순위는 관찰된 노이즈 음절만 제외한다 — 한글 전체를 막으면
 * (구 버전의 (?![가-힣])) "1위를"·"1위의"·"3배나"처럼 조사가 붙은
 * 형태를 전부 놓친다. 한국어 카피에서는 오히려 이쪽이 다수이고,
 * 그중 "판매 1위" 류가 실증 책임이 가장 무거운 표현이라 놓치는 비용이
 * 크다. 그래서 "50위안"(1688 사입가)·"2배수 구조" 같은 실측 오탐
 * 사례에서 관찰된 음절만 좁게 제외한다.
 */
const FORBIDDEN_COMPARE: ReadonlyArray<{ label: string; test: (s: string) => boolean }> = [
  { label: '배수', test: (s) => /\d+\s*배(?!수|송|열|치|터)/.test(s) },
  {
    label: '퍼센트',
    test: (s) => /\d+(?:\.\d+)?\s*%/.test(s) && COMPARATIVE_MARKER.test(s),
  },
  { label: '순위', test: (s) => /\d+\s*위(?!안|치|험|생|원)/.test(s) },
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
 * 값 트리에서 `{ value, unit }`이 둘 다 문자열인 객체를 찾아 "value+unit" 붙인
 * 형태를 콜백에 전달한다. stat_row(`{label,value,unit}`)처럼 수치와 단위가
 * 별개 필드인 블록에서, collectSectionText가 leaf를 " | "로 분리해버리면
 * "1"과 "위"가 서로 다른 leaf가 되어 "1위" 매칭이 끊긴다 — 이 함수가 그 붙인
 * 형태를 별도로 복원해 넣는다.
 */
function forEachValueUnitPair(node: unknown, cb: (pair: string) => void): void {
  if (Array.isArray(node)) { node.forEach((v) => forEachValueUnitPair(v, cb)); return; }
  if (node !== null && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (typeof obj.value === 'string' && typeof obj.unit === 'string') {
      cb(`${obj.value}${obj.unit}`);
    }
    Object.values(obj).forEach((v) => forEachValueUnitPair(v, cb));
  }
}

/**
 * 섹션의 모든 leaf 문자열을 하나로 이어붙인다. 헤더와 표 셀처럼 서로 다른
 * leaf에 표지어와 수치가 나뉘어 있어도 compare_claim 판정은 섹션 전체
 * 기준으로 해야 하기 때문이다 (FORBIDDEN_COMPARE 주석 참고).
 *
 * 조심할 것 세 가지:
 * 1) 구분자는 공백이 아니라 " | "를 쓴다 — FORBIDDEN_COMPARE의 정규식(예: 배수의
 *    `\d+\s*배`)이 공백을 허용하므로, 공백으로 이어붙이면 앞 leaf의 끝 숫자와
 *    뒤 leaf의 첫 음절이 우연히 붙어 매칭된다(예: ["재고 30", "위탁 판매"] →
 *    "30 위" 순위 오탐, ["옵션 3", "배기 성능"] → "3 배" 배수 오탐). 마커 게이트
 *    (섹션 전체에서 표지어 유무를 보는 것)는 공백이 아니어도 그대로 작동한다.
 * 2) 하지만 " | " 구분자는 stat_row처럼 수치와 단위가 별개 필드("판매"/"1"/"위")인
 *    블록에서 "1"과 "위"도 갈라놓는다 — compare 섹션의 양쪽 컬럼에 stat_row로
 *    "기존 3배 / 우리 1위"를 대비시키는 배치는 이 스키마에서 흔히 나오는 형태라,
 *    이걸 그대로 두면 가장 실증 책임이 무거운 "1위" 류를 통째로 놓친다. 그래서
 *    forEachValueUnitPair로 value+unit을 붙인 토큰을 별도로 추가한다 — leaf 경계
 *    분리(1번)의 이득은 유지하면서 이 경로만 가산적으로 복구한다.
 * 3) 문자열 안에 임베드된 URL은 매칭에서 제외한다 — 퍼센트 인코딩된 URL
 *    (`%ED%95%9C`처럼 우연히 "95%" 형태가 들어간 경우)이 퍼센트 주장으로 오인될
 *    수 있다. LayoutBlock의 image 변형에는 스키마상 url 필드가 없어 정상 생성
 *    경로에서는 등장하지 않지만, zod 파싱이 non-strict라 LLM이 규격 외 url
 *    키를 덤으로 붙여도 그 블록 자체는 유효하다고 통과된다 — 그 경우를 대비한
 *    가드다. 전체 문자열이 URL인 leaf뿐 아니라 "자세히는 https://... 참고"처럼
 *    URL이 문장 중간에 임베드된 경우까지 덮도록 부분 치환한다(앵커 매칭이면 후자를
 *    놓친다).
 */
function collectSectionText(blocks: unknown): string {
  const parts: string[] = [];
  forEachString(blocks, (s) => {
    // URL 치환자도 공백이면 leaf 내부에서 숫자+다음 음절이 붙어버린다
    // (예: "옵션 3 https://... 배기 성능" → "옵션 3   배기 성능" → "3 배" 오탐).
    // join 구분자와 동일하게 ' | '를 써서 leaf 분리 효과를 유지한다.
    parts.push(s.replace(/https?:\/\/\S+/g, ' | '));
  });
  forEachValueUnitPair(blocks, (pair) => parts.push(pair));
  return parts.join(' | ');
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
      // 근거 없는 우위 주장 검출 — 프롬프트 지시만으로는 막히지 않는다.
      // 섹션 전체를 이어붙인 텍스트 기준으로 판정한다 (헤더/셀 분리 대응).
      const sectionText = collectSectionText(sections[i].blocks);
      const found = new Set<string>();
      for (const { label, test } of FORBIDDEN_COMPARE) {
        if (test(sectionText)) found.add(label);
      }
      if (found.size > 0) {
        const labels = [...found];
        issues.push({
          rule: 'compare_claim',
          sectionIndex: i,
          labels,
          message: `sections[${i}](compare)에 ${labels.join('·')} 표현이 있습니다. 카테고리 공지의 사실만 쓰세요.`,
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
