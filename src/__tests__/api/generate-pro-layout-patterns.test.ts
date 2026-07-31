import { describe, it, expect } from 'vitest';
import { CLAUDE_SYSTEM } from '@/app/api/ai/generate-pro-layout/system-prompt';
import { BENCHMARK_PATTERNS } from '@/lib/ai/prompts/benchmark-patterns';

describe('generate-pro-layout CLAUDE_SYSTEM', () => {
  it('벤치마킹 다이제스트를 주입한다', () => {
    expect(CLAUDE_SYSTEM).toContain(BENCHMARK_PATTERNS);
  });

  it('다이제스트를 규칙 뒤·JSON 반환 지시 앞에 배치한다', () => {
    const digestIdx = CLAUDE_SYSTEM.indexOf(BENCHMARK_PATTERNS);
    const rulesIdx = CLAUDE_SYSTEM.indexOf('CONSISTENCY & PACING');
    const returnIdx = CLAUDE_SYSTEM.indexOf('Return ONLY valid JSON array');
    expect(rulesIdx).toBeGreaterThan(-1);
    expect(digestIdx).toBeGreaterThan(rulesIdx);
    expect(returnIdx).toBeGreaterThan(digestIdx);
  });

  it('기존 핵심 규칙(한자 금지)을 보존한다', () => {
    expect(CLAUDE_SYSTEM).toContain('NEVER use Chinese characters');
  });
});

// ── 규칙 라벨 정합성 ──
// 프롬프트가 여러 작업에서 동시에 커지면서 "아래 R2를 따른다"처럼 존재하지 않는
// 규칙을 가리키는 참조가 실제로 들어왔다(R 계열 규칙은 애초에 없었다). LLM은 없는
// 항목을 조용히 무시하거나 엉뚱한 규칙을 적용하므로 눈에 띄지 않는다. 코드로 고정한다.
//
// 검사 대상은 문자 접두 라벨(C/D/N/R + 숫자)뿐이다. DESIGN RULES의 숫자 라벨(1~12)은
// "12자", "1~2cm", "390px" 같은 본문 수치와 구별할 수 없어 오탐만 만든다.

/** 줄 머리의 "C7." 형태를 정의, 그 밖의 등장을 참조로 보고 정의 없는 참조를 찾는다 */
function findDanglingRuleRefs(prompt: string): string[] {
  // hex 색상(#C4A012)이 라벨로 오탐되지 않게 먼저 지운다
  const text = prompt.replace(/#[0-9a-fA-F]{3,8}\b/g, '');
  const defined = new Set<string>();
  for (const m of text.matchAll(/^\s*([CDNR]\d{1,2})\./gm)) defined.add(m[1]);

  const refs = new Set<string>();
  for (const line of text.split('\n')) {
    const body = line.replace(/^\s*[CDNR]\d{1,2}\./, ''); // 정의 라벨 자신은 참조가 아니다
    for (const m of body.matchAll(/\b([CDNR]\d{1,2})\b/g)) refs.add(m[1]);
  }
  return [...refs].filter((r) => !defined.has(r)).sort();
}

/** 같은 라벨이 두 번 정의됐는지 — 규칙을 추가하다 번호를 재사용한 흔적 */
function findDuplicateRuleLabels(prompt: string): string[] {
  const seen = new Map<string, number>();
  for (const m of prompt.matchAll(/^\s*([CDNR]\d{1,2})\./gm)) {
    seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([label]) => label).sort();
}

describe('CLAUDE_SYSTEM 규칙 라벨 정합성', () => {
  it('존재하지 않는 규칙을 가리키는 참조가 없다', () => {
    expect(findDanglingRuleRefs(CLAUDE_SYSTEM)).toEqual([]);
  });

  it('같은 라벨을 두 번 정의하지 않는다', () => {
    expect(findDuplicateRuleLabels(CLAUDE_SYSTEM)).toEqual([]);
  });

  it('참조 검출이 실제로 동작한다 (R2 회귀 재현)', () => {
    const broken = [
      'C8. 사이즈 sublabel은 실측을 먼저 쓴다.',
      '  실측을 모르면 표를 만들지 말고 아래 R2를 따른다.',
      'C9. 카테고리별 필수 정보는 spec_table로 묶는다.',
    ].join('\n');
    expect(findDanglingRuleRefs(broken)).toEqual(['R2']);
  });

  it('정의된 규칙을 가리키는 참조는 통과시킨다', () => {
    const ok = 'C8. 실측 항목이 3개 이상이면 C9의 spec_table을 쓴다.\nC9. 필수 정보 표.';
    expect(findDanglingRuleRefs(ok)).toEqual([]);
  });

  it('hex 색상을 라벨 참조로 오해하지 않는다', () => {
    const withHex = 'C1. groupColors 예시: #C4A012, #D3E5F0 을 쓴다.';
    expect(findDanglingRuleRefs(withHex)).toEqual([]);
  });
});
