import { describe, it, expect } from 'vitest';
import { isGroundedProgressItem, cleanProgressBlocks } from '@/lib/detail-page/progress-hygiene';

const SOURCE = '무게 180g, 건조 시간 30초, 가슴둘레 95cm까지 지원';

describe('isGroundedProgressItem', () => {
  it('입력에 등장하는 수치는 통과', () => {
    expect(isGroundedProgressItem({ label: '무게', value: 70, displayValue: '180g' }, SOURCE)).toBe(true);
  });

  it('입력에 없는 수치는 거부', () => {
    expect(isGroundedProgressItem({ label: '신축성', value: 92, displayValue: '92%' }, SOURCE)).toBe(false);
  });

  it('displayValue가 없으면 거부 — 렌더러가 바 길이를 그대로 노출한다', () => {
    expect(isGroundedProgressItem({ label: '신축성', value: 92 }, SOURCE)).toBe(false);
  });

  it('빈 displayValue도 거부', () => {
    expect(isGroundedProgressItem({ label: '신축성', value: 92, displayValue: '  ' }, SOURCE)).toBe(false);
  });

  it('숫자 없는 정성 표현은 거부', () => {
    expect(isGroundedProgressItem({ label: '신축성', value: 92, displayValue: '높음' }, SOURCE)).toBe(false);
    expect(isGroundedProgressItem({ label: '건조', value: 85, displayValue: 'Omni-Wick' }, SOURCE)).toBe(false);
  });

  it('여러 숫자 중 하나라도 입력에 없으면 거부', () => {
    expect(isGroundedProgressItem({ label: '범위', value: 50, displayValue: '180~200g' }, SOURCE)).toBe(false);
  });

  it('여러 숫자가 모두 입력에 있으면 통과', () => {
    expect(isGroundedProgressItem({ label: '범위', value: 50, displayValue: '30초/180g' }, SOURCE)).toBe(true);
  });

  it('소수점 수치도 완전일치로 판정한다', () => {
    expect(isGroundedProgressItem({ label: '두께', value: 40, displayValue: '1.5mm' }, '두께 1.5mm')).toBe(true);
    expect(isGroundedProgressItem({ label: '두께', value: 40, displayValue: '1.6mm' }, '두께 1.5mm')).toBe(false);
  });

  it('입력이 비어 있으면 모든 수치가 거부된다', () => {
    expect(isGroundedProgressItem({ label: '무게', value: 70, displayValue: '180g' }, '')).toBe(false);
  });
});

describe('cleanProgressBlocks', () => {
  it('근거 없는 item만 제거한다', () => {
    const blocks = [
      {
        type: 'progress_bar',
        items: [
          { label: '무게', value: 70, displayValue: '180g' },
          { label: '신축성', value: 92, displayValue: '높음' },
          { label: '건조', value: 85, displayValue: '30초' },
        ],
      },
    ];
    const out = cleanProgressBlocks(blocks, true, SOURCE) as any[];
    expect(out[0].items).toHaveLength(2);
    expect(out[0].items.map((i: any) => i.displayValue)).toEqual(['180g', '30초']);
  });

  it('남은 item이 2개 미만이면 items를 비워 pruneBlocks가 제거하게 한다 (topLevel)', () => {
    const blocks = [
      {
        type: 'progress_bar',
        items: [
          { label: '신축성', value: 92, displayValue: '높음' },
          { label: '흡수', value: 88, displayValue: '우수' },
          { label: '무게', value: 70, displayValue: '180g' },
        ],
      },
    ];
    const out = cleanProgressBlocks(blocks, true, SOURCE) as any[];
    expect(out[0].items).toEqual([]);
  });

  it('cols 안에서는 블록 자체를 제거한다', () => {
    const blocks = [
      {
        type: 'columns',
        cols: [
          [{ type: 'progress_bar', items: [{ label: 'x', value: 1, displayValue: '높음' }] }],
          [{ type: 'subtext', text: '남는다' }],
        ],
      },
    ];
    const out = cleanProgressBlocks(blocks, true, SOURCE) as any[];
    expect(out[0].cols).toHaveLength(1);
    expect(out[0].cols[0][0].type).toBe('subtext');
  });

  it('원래 1개였던 블록은 필터링이 없으면 그대로 둔다', () => {
    const blocks = [
      { type: 'progress_bar', items: [{ label: '무게', value: 70, displayValue: '180g' }] },
    ];
    const out = cleanProgressBlocks(blocks, true, SOURCE) as any[];
    expect(out[0].items).toHaveLength(1);
  });

  it('progress_bar가 아닌 블록은 건드리지 않는다', () => {
    const blocks = [{ type: 'heading', text: '제목', size: 'xl' }];
    expect(cleanProgressBlocks(blocks, true, SOURCE)).toEqual(blocks);
  });

  it('모든 컬럼이 비면 columns 블록을 드롭한다', () => {
    const blocks = [
      {
        type: 'columns',
        cols: [[{ type: 'progress_bar', items: [{ label: 'x', value: 1, displayValue: '높음' }] }]],
      },
    ];
    const out = cleanProgressBlocks(blocks, true, SOURCE) as any[];
    expect(out).toHaveLength(0);
  });
});
