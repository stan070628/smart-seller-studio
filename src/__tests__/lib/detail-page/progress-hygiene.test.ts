import { describe, it, expect } from 'vitest';
import {
  isGroundedProgressItem,
  cleanProgressBlocks,
  sanitizeProgressBars,
} from '@/lib/detail-page/progress-hygiene';

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

describe('퍼센트 특례 대조 — 숫자만 일치해서는 안 되고 "숫자%" 형태로 등장해야 한다', () => {
  it('숫자는 입력에 있지만 퍼센트로는 등장하지 않으면 거부한다', () => {
    // "가슴둘레 95cm"의 95는 있지만 "95%"라는 비율 주장 자체는 입력에 없다
    expect(isGroundedProgressItem({ label: '신축성', value: 95, displayValue: '95%' }, SOURCE)).toBe(false);
  });

  it('입력에 퍼센트 형태로 그대로 등장하면 통과한다', () => {
    const source = '폴리에스터 100% 소재';
    expect(isGroundedProgressItem({ label: '혼용률', value: 100, displayValue: '100%' }, source)).toBe(true);
  });

  it('공백이 섞인 퍼센트 표기도 정규화해 대조한다', () => {
    const source = '폴리에스터 100 % 소재';
    expect(isGroundedProgressItem({ label: '혼용률', value: 100, displayValue: '100%' }, source)).toBe(true);
  });

  it('퍼센트가 아닌 단위(g)는 이 특례의 영향을 받지 않는다', () => {
    expect(isGroundedProgressItem({ label: '무게', value: 70, displayValue: '180g' }, SOURCE)).toBe(true);
  });
});

describe('의도적으로 남겨둔 오탐·미탐 — 특성화 테스트', () => {
  it('단위 환산된 정당한 수치는 제거된다 (의도된 오탐)', () => {
    // 실제로는 무게 180g과 같은 값이지만 kg로 환산 표기하면 숫자 자체가 달라
    // 완전일치 대조에서 걸러진다. 단위 정규화를 추가하는 순간 이 테스트가 깨진다 —
    // 그건 의도된 설계 변경이므로 의식적으로 결정할 것.
    expect(isGroundedProgressItem({ label: '무게', value: 70, displayValue: '0.18kg' }, SOURCE)).toBe(false);
  });

  it('반올림된 정당한 수치는 제거된다 (의도된 오탐)', () => {
    // 실제 30초를 31초로 반올림/오기하면 완전일치 대조에서 걸러진다.
    expect(isGroundedProgressItem({ label: '건조', value: 85, displayValue: '31초' }, SOURCE)).toBe(false);
  });

  it('배수 표현은 숫자만 일치하면 통과한다 (의도된 미탐 — 알려진 한계)', () => {
    // "%"가 아닌 단위는 숫자만 대조하므로, 입력에 같은 숫자가 다른 단위로 존재하면
    // 지어낸 배수 주장도 통과한다. 퍼센트 특례를 다른 단위로 일반화하면 사라지는
    // 한계지만, 그 일반화는 커밋 5b0a49ba의 부분일치 오탐을 재현할 위험이 있어
    // 의도적으로 남겨두었다.
    const source = '3종 원단 혼용, 두께 1.5mm';
    expect(isGroundedProgressItem({ label: '건조 속도', value: 90, displayValue: '3배 빠름' }, source)).toBe(true);
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

describe('sanitizeProgressBars — layout-validator가 실제로 호출할 공개 진입점', () => {
  it('blocks가 배열이 아닌 섹션은 그대로 통과시킨다', () => {
    const sec = { id: 's1', title: '제목만 있는 섹션' };
    expect(sanitizeProgressBars(sec, SOURCE)).toEqual(sec);
  });

  it('섹션이 객체가 아니면 그대로 통과시킨다', () => {
    expect(sanitizeProgressBars(null, SOURCE)).toBeNull();
  });

  it('섹션의 progress_bar를 topLevel 규약으로 정리한다', () => {
    const sec = {
      id: 's1',
      blocks: [
        {
          type: 'progress_bar',
          items: [
            { label: '신축성', value: 92, displayValue: '높음' },
            { label: '흡수', value: 88, displayValue: '우수' },
            { label: '무게', value: 70, displayValue: '180g' },
          ],
        },
      ],
    };
    const out = sanitizeProgressBars(sec, SOURCE) as any;
    // 근거 있는 항목이 1개뿐 → topLevel 규약에 따라 items를 비워 pruneBlocks에 위임한다
    expect(out.blocks[0].items).toEqual([]);
  });

  it('원본 섹션과 그 blocks/items를 변형하지 않는다', () => {
    const original = {
      id: 's1',
      blocks: [
        {
          type: 'progress_bar',
          items: [
            { label: '무게', value: 70, displayValue: '180g' },
            { label: '신축성', value: 92, displayValue: '높음' },
          ],
        },
      ],
    };
    const snapshot = JSON.parse(JSON.stringify(original));
    sanitizeProgressBars(original, SOURCE);
    expect(original).toEqual(snapshot);
  });
});
