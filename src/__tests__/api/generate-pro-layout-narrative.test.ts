import { describe, it, expect } from 'vitest';
import { validateProLayout, sanitizeProLayout } from '@/lib/detail-page/layout-validator';

/**
 * 라우트가 구성하는 layoutOpts와 동일한 형태로 검증이 동작하는지 확인한다.
 * (라우트 자체는 Claude 호출을 포함해 통합 테스트 대상이 아니다.)
 */
describe('생성 경로 옵션 조합', () => {
  const layoutOpts = {
    statHygiene: true,
    narrative: true,
    provenanceSource: '무게 180g 건조 30초',
  };

  function sections(beats: string[]): unknown[] {
    return beats.map((beat, i) => ({
      type: 'claude_layout',
      title: `섹션 ${i}`,
      beat,
      blocks:
        beat === 'compare'
          ? [{ type: 'columns', cols: [[{ type: 'subtext', text: 'a' }], [{ type: 'subtext', text: 'b' }]] }]
          : [{ type: 'heading', text: `제목 ${i}`, size: 'xl' }],
      bgStyle: 'white',
    }));
  }

  it('서사를 갖춘 레이아웃은 error 없이 통과', () => {
    const secs = sections(['hook', 'problem', 'solution', 'compare', 'detail', 'assure']);
    const res = validateProLayout(secs, layoutOpts);
    expect(res.violations.filter(v => v.severity === 'error')).toEqual([]);
  });

  it('compare가 없으면 error → repair 트리거', () => {
    const secs = sections(['hook', 'detail', 'usecase', 'option', 'evidence', 'assure']);
    const res = validateProLayout(secs, layoutOpts);
    expect(res.isClean).toBe(false);
  });

  it('근거 없는 progress_bar가 생성 경로에서 제거된다', () => {
    const secs = sections(['hook', 'problem', 'solution', 'compare', 'detail', 'assure']) as any[];
    secs[4].blocks = [
      {
        type: 'progress_bar',
        items: [
          { label: '신축성', value: 92, displayValue: '높음' },
          { label: '흡수', value: 88, displayValue: 'Omni-Wick' },
        ],
      },
    ];
    const { sections: out } = sanitizeProLayout(secs, layoutOpts);
    expect((out[4] as any).blocks).toHaveLength(0);
  });
});
