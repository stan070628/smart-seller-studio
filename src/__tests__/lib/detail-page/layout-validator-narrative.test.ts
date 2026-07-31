import { describe, it, expect } from 'vitest';
import { validateProLayout, sanitizeProLayout } from '@/lib/detail-page/layout-validator';

function validSections(count = 6): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    type: 'claude_layout',
    title: `섹션 ${i}`,
    blocks: [{ type: 'heading', text: `제목 ${i}`, size: 'xl' }],
    bgStyle: 'white',
  }));
}

/** beat까지 갖춘 유효 레이아웃 6섹션 */
function narrativeSections(): unknown[] {
  const beats = ['hook', 'problem', 'solution', 'compare', 'detail', 'assure'];
  return beats.map((beat, i) => ({
    type: 'claude_layout',
    title: `섹션 ${i}`,
    beat,
    blocks:
      beat === 'compare'
        ? [
            {
              type: 'columns',
              cols: [[{ type: 'subtext', text: '기존' }], [{ type: 'subtext', text: '우리' }]],
            },
          ]
        : [{ type: 'heading', text: `제목 ${i}`, size: 'xl' }],
    bgStyle: 'white',
  }));
}

describe('narrative 플래그 게이트', () => {
  it('플래그가 꺼져 있으면 beat 없는 레이아웃도 isClean=true', () => {
    const res = validateProLayout(validSections());
    expect(res.isClean).toBe(true);
    expect(res.violations.some(v => v.code === 'narrative')).toBe(false);
  });

  it('플래그를 켜면 beat 누락이 error', () => {
    const res = validateProLayout(validSections(), { narrative: true });
    expect(res.isClean).toBe(false);
    expect(res.violations.some(v => v.code === 'narrative')).toBe(true);
  });

  it('beat를 갖춘 레이아웃은 플래그를 켜도 통과', () => {
    const res = validateProLayout(narrativeSections(), { narrative: true });
    expect(res.violations.filter(v => v.code === 'narrative' && v.severity === 'error')).toEqual([]);
  });

  it('섹션 단위 이슈는 path에 인덱스가 들어간다', () => {
    // 인덱스 2("solution")의 beat를 제거해 beat_missing을 유발 — 0이 아닌 인덱스를
    // 써야 "path에 인덱스가 그대로 들어가는지"(0이 기본값과 헷갈리지 않는지)가 검증된다
    const secs = narrativeSections() as Record<string, unknown>[];
    delete secs[2].beat;
    const res = validateProLayout(secs, { narrative: true });
    const issue = res.violations.find(v => v.code === 'narrative' && v.path.includes('[2]'));
    expect(issue).toBeDefined();
  });

  it('레이아웃 전역 이슈는 path가 sections다', () => {
    // compare 섹션을 detail로 바꿔 compare_missing 유발
    const secs = narrativeSections() as Record<string, unknown>[];
    secs[3].beat = 'detail';
    const res = validateProLayout(secs, { narrative: true });
    const issue = res.violations.find(v => v.code === 'narrative' && v.path === 'sections');
    expect(issue).toBeDefined();
  });

  it('warning severity가 error로 하드코딩되지 않고 그대로 전달된다', () => {
    // checkNarrative의 compare_claim은 severity:'warning'이다. 결선 코드가
    // issue.severity를 그대로 옮기지 않고 'error'로 고정해도 error 경로만
    // 테스트하면 걸러지지 않으므로, warning이 isClean을 꺼뜨리지 않는지까지 고정한다.
    const secs = narrativeSections() as Record<string, unknown>[];
    const compareBlocks = secs[3].blocks as Array<{ cols: Array<Array<{ text?: string }>> }>;
    compareBlocks[0].cols[0][0].text = '타사 대비 3배 빠른 건조';
    const res = validateProLayout(secs, { narrative: true });
    const warn = res.violations.find(v => v.code === 'narrative' && v.severity === 'warning');
    expect(warn).toBeDefined();
    expect(res.isClean).toBe(true);
  });
});

describe('beat 스키마', () => {
  it('beat는 optional이라 없어도 schema 위반이 아니다', () => {
    const res = validateProLayout(validSections());
    expect(res.violations.some(v => v.code === 'schema')).toBe(false);
  });

  it('beat 값이 유효하면 schema 위반이 아니다', () => {
    const res = validateProLayout(narrativeSections());
    expect(res.violations.some(v => v.code === 'schema')).toBe(false);
  });

  it('sanitize를 거쳐도 beat 필드가 보존된다', () => {
    const { sections } = sanitizeProLayout(narrativeSections());
    expect((sections[0] as any).beat).toBe('hook');
  });
});

describe('progress_bar provenance (provenanceSource 옵션)', () => {
  function withProgress(items: unknown[]): unknown[] {
    const secs = validSections();
    (secs[0] as any).blocks = [{ type: 'progress_bar', items }];
    return secs;
  }

  it('옵션이 없으면 progress_bar를 건드리지 않는다', () => {
    const secs = withProgress([
      { label: '신축성', value: 92, displayValue: '높음' },
      { label: '흡수', value: 88, displayValue: '우수' },
    ]);
    const { sections } = sanitizeProLayout(secs);
    expect((sections[0] as any).blocks[0].items).toHaveLength(2);
  });

  it('옵션이 있으면 근거 없는 item이 제거되고 블록째 사라진다', () => {
    const secs = withProgress([
      { label: '신축성', value: 92, displayValue: '높음' },
      { label: '흡수', value: 88, displayValue: '우수' },
    ]);
    const { sections } = sanitizeProLayout(secs, { provenanceSource: '무게 180g' });
    // items가 비면 pruneBlocks가 블록을 제거한다
    expect((sections[0] as any).blocks).toHaveLength(0);
  });

  it('근거 있는 수치는 살아남는다', () => {
    const secs = withProgress([
      { label: '무게', value: 70, displayValue: '180g' },
      { label: '건조', value: 60, displayValue: '30초' },
    ]);
    const { sections } = sanitizeProLayout(secs, { provenanceSource: '무게 180g, 건조 30초' });
    expect((sections[0] as any).blocks[0].items).toHaveLength(2);
  });

  it('빈 문자열 provenanceSource도 위생을 활성화한다 (undefined와 구분)', () => {
    const secs = withProgress([
      { label: '무게', value: 70, displayValue: '180g' },
      { label: '건조', value: 60, displayValue: '30초' },
    ]);
    const { sections } = sanitizeProLayout(secs, { provenanceSource: '' });
    // 입력이 비었으므로 모든 수치가 근거 없음 → 블록 제거
    expect((sections[0] as any).blocks).toHaveLength(0);
  });
});
