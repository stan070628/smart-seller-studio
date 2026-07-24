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
