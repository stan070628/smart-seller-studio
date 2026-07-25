import { describe, it, expect } from 'vitest';
import { validateProLayout, sanitizeProLayout, isNoiseStatItem } from '@/lib/detail-page/layout-validator';

/** 유효한 최소 섹션(6개) 생성 헬퍼 */
function validSections(count = 6): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    type: 'claude_layout',
    title: `섹션 ${i}`,
    blocks: [{ type: 'heading', text: `제목 ${i}`, size: 'xl' }],
    bgStyle: 'white',
  }));
}

describe('validateProLayout', () => {
  it('유효한 레이아웃은 isClean=true, error 없음', () => {
    const res = validateProLayout(validSections());
    expect(res.isClean).toBe(true);
    expect(res.violations.filter(v => v.severity === 'error')).toHaveLength(0);
  });

  it('한자가 있으면 cjk error', () => {
    const secs = validSections();
    (secs[0] as any).blocks[0].text = '溫度 관리';
    const res = validateProLayout(secs);
    expect(res.isClean).toBe(false);
    expect(res.violations.some(v => v.code === 'cjk')).toBe(true);
  });

  it('필수 필드 누락은 schema error', () => {
    const secs = validSections();
    (secs[1] as any).blocks[0] = { type: 'heading' }; // text/size 누락
    const res = validateProLayout(secs);
    expect(res.violations.some(v => v.code === 'schema')).toBe(true);
    expect(res.isClean).toBe(false);
  });

  it('union에 없는 알 수 없는 블록 타입은 schema error', () => {
    const secs = validSections();
    (secs[0] as any).blocks[0] = { type: 'made_up_block' };
    const res = validateProLayout(secs);
    expect(res.violations.some(v => v.code === 'schema')).toBe(true);
  });

  it('radar_chart/timeline은 유효(허용)', () => {
    const secs = validSections();
    (secs[0] as any).blocks = [
      { type: 'timeline', items: [{ stage: '1단계' }] },
      { type: 'radar_chart', axes: [{ label: 'A', value: 3 }] },
    ];
    const res = validateProLayout(secs);
    expect(res.violations.some(v => v.code === 'schema')).toBe(false);
  });

  it('빈 heading 텍스트는 empty_block warning', () => {
    const secs = validSections();
    (secs[0] as any).blocks[0].text = '   ';
    const res = validateProLayout(secs);
    expect(res.violations.some(v => v.code === 'empty_block' && v.severity === 'warning')).toBe(true);
  });

  it('연속 동일 섹션은 duplicate warning', () => {
    const secs = validSections();
    secs[2] = JSON.parse(JSON.stringify(secs[1]));
    const res = validateProLayout(secs);
    expect(res.violations.some(v => v.code === 'duplicate')).toBe(true);
  });

  it('섹션 수 범위(6~10) 밖은 section_count warning', () => {
    const res = validateProLayout(validSections(3));
    expect(res.violations.some(v => v.code === 'section_count')).toBe(true);
  });

  it('쿠팡 금지어는 prohibited error', () => {
    const secs = validSections();
    (secs[0] as any).blocks[0].text = '감염예방 효과';
    const res = validateProLayout(secs);
    expect(res.violations.some(v => v.code === 'prohibited')).toBe(true);
    expect(res.isClean).toBe(false);
  });

  it('U+FFFD 치환문자는 broken_text warning', () => {
    const secs = validSections();
    (secs[0] as any).blocks[0].text = '충전�기';
    const res = validateProLayout(secs);
    expect(res.violations.some(v => v.code === 'broken_text')).toBe(true);
  });

  it('배열이 아니면 schema error', () => {
    const res = validateProLayout({ not: 'array' });
    expect(res.isClean).toBe(false);
    expect(res.violations[0]?.code).toBe('schema');
  });
});

describe('sanitizeProLayout', () => {
  it('잔여 한자/U+FFFD를 삭제한다', () => {
    const secs = [{ type: 'claude_layout', title: '溫도�', blocks: [{ type: 'heading', text: '溫度관리', size: 'xl' }] }];
    const { sections } = sanitizeProLayout(secs);
    const s = sections[0] as any;
    expect(s.title).not.toMatch(/[一-鿿�]/);
    expect(s.blocks[0].text).toBe('관리');
  });

  it('빈 블록과 스키마 무효 블록을 제거한다', () => {
    const secs = [{
      type: 'claude_layout', title: 'T',
      blocks: [
        { type: 'heading', text: '   ', size: 'xl' },     // 빈 → 제거
        { type: 'made_up' },                               // 무효 → 제거
        { type: 'heading', text: '유효', size: 'lg' },      // 유지
      ],
    }];
    const { sections } = sanitizeProLayout(secs);
    const blocks = (sections[0] as any).blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('유효');
  });

  it('연속 중복 섹션을 하나로 합친다', () => {
    const a = { type: 'claude_layout', title: 'A', blocks: [{ type: 'heading', text: 'A', size: 'xl' }] };
    const { sections } = sanitizeProLayout([a, JSON.parse(JSON.stringify(a))]);
    expect(sections).toHaveLength(1);
  });

  it('교정 후 남은 위반을 warnings로 반환한다(예: 섹션 수 부족)', () => {
    const { warnings } = sanitizeProLayout([{ type: 'claude_layout', title: 'A', blocks: [{ type: 'heading', text: 'A', size: 'xl' }] }]);
    expect(warnings.some((w) => w.code === 'section_count')).toBe(true);
  });
});

describe('sanitizeProLayout — stat_row 위생', () => {
  /** stat_row 하나를 가진 섹션 */
  function statSection(items: Array<{ label: string; value: string; unit?: string }>): unknown {
    return {
      type: 'claude_layout',
      title: '지표',
      blocks: [
        { type: 'heading', text: '지표', size: 'xl' },
        { type: 'stat_row', items },
      ],
    };
  }

  function statBlockOf(section: unknown): { items?: unknown[] } | undefined {
    const blocks = (section as { blocks?: Array<{ type?: string; items?: unknown[] }> }).blocks ?? [];
    return blocks.find((b) => b.type === 'stat_row');
  }

  it('statHygiene 없으면 아무것도 지우지 않는다', () => {
    const secs = [statSection([
      { label: '소매 길이', value: '0', unit: 'cm' },
      { label: '사이즈', value: '4', unit: '단계' },
      { label: '가슴둘레', value: '95~110', unit: 'cm' },
    ])];
    const { sections } = sanitizeProLayout(secs);
    expect(statBlockOf(sections[0])!.items).toHaveLength(3);
  });

  it('치수 계열의 0값을 제거한다', () => {
    const secs = [statSection([
      { label: '소매 길이', value: '0', unit: 'cm' },
      { label: '가슴둘레', value: '95~110', unit: 'cm' },
      { label: '무게', value: '180', unit: 'g' },
    ])];
    const { sections } = sanitizeProLayout(secs, { statHygiene: true });
    const items = statBlockOf(sections[0])!.items as Array<{ label: string }>;
    expect(items.map((i) => i.label)).toEqual(['가슴둘레', '무게']);
  });

  it('치수가 아닌 0값은 남긴다 (설탕 0g은 정당한 지표)', () => {
    const secs = [statSection([
      { label: '설탕', value: '0', unit: 'g' },
      { label: '열량', value: '25', unit: 'kcal' },
    ])];
    const { sections } = sanitizeProLayout(secs, { statHygiene: true });
    expect(statBlockOf(sections[0])!.items).toHaveLength(2);
  });

  it('개수 단위가 unit에 있으면 제거한다', () => {
    const secs = [statSection([
      { label: '사이즈', value: '4', unit: '단계' },
      { label: '가슴둘레', value: '95~110', unit: 'cm' },
      { label: '무게', value: '180', unit: 'g' },
    ])];
    const { sections } = sanitizeProLayout(secs, { statHygiene: true });
    const items = statBlockOf(sections[0])!.items as Array<{ label: string }>;
    expect(items.map((i) => i.label)).toEqual(['가슴둘레', '무게']);
  });

  it('숫자와 개수 단위가 value에 결합된 경우도 제거한다', () => {
    const secs = [statSection([
      { label: '사이즈', value: '4단계' },
      { label: '컬러', value: '2종' },
      { label: '가슴둘레', value: '95~110', unit: 'cm' },
      { label: '무게', value: '180', unit: 'g' },
    ])];
    const { sections } = sanitizeProLayout(secs, { statHygiene: true });
    const items = statBlockOf(sections[0])!.items as Array<{ label: string }>;
    expect(items.map((i) => i.label)).toEqual(['가슴둘레', '무게']);
  });

  it('없음/무/-/N/A 값을 제거한다', () => {
    const secs = [statSection([
      { label: '소매', value: '없음' },
      { label: '부자재', value: '-' },
      { label: '가슴둘레', value: '95~110', unit: 'cm' },
      { label: '무게', value: '180', unit: 'g' },
    ])];
    const { sections } = sanitizeProLayout(secs, { statHygiene: true });
    const items = statBlockOf(sections[0])!.items as Array<{ label: string }>;
    expect(items.map((i) => i.label)).toEqual(['가슴둘레', '무게']);
  });

  it('남은 항목이 2개 미만이면 블록을 제거한다', () => {
    const secs = [statSection([
      { label: '소매 길이', value: '0', unit: 'cm' },
      { label: '사이즈', value: '4', unit: '단계' },
      { label: '무게', value: '180', unit: 'g' },
    ])];
    const { sections } = sanitizeProLayout(secs, { statHygiene: true });
    expect(statBlockOf(sections[0])).toBeUndefined();
  });

  it('columns.cols 안의 stat_row도 정리하고, 2개 미만이면 배열에서 뺀다', () => {
    const secs = [{
      type: 'claude_layout',
      title: '지표',
      blocks: [
        {
          type: 'columns',
          cols: [
            [{ type: 'stat_row', items: [
              { label: '소매 길이', value: '0', unit: 'cm' },
              { label: '무게', value: '180', unit: 'g' },
            ] }],
            [{ type: 'heading', text: '오른쪽', size: 'md' }],
          ],
        },
      ],
    }];
    const { sections } = sanitizeProLayout(secs, { statHygiene: true });
    const cols = ((sections[0] as { blocks: Array<{ cols: unknown[][] }> }).blocks[0]!).cols;
    // stat_row가 빠진 컬럼은 통째로 제거된다 (빈 flex 칸 렌더 방지)
    expect(cols).toHaveLength(1);
    expect(cols[0]).toHaveLength(1);
  });
});

describe('isNoiseStatItem', () => {
  const NOISE: Array<[string, string, string]> = [
    ['소매 길이', '0', 'cm'],
    ['사이즈', '4', '단계'],
    ['사이즈', '4단계', ''],
    ['컬러', '2종', ''],
    ['색상', '2', '종'],
    ['사이즈 단계', '4', ''],
    ['소매', '없음', ''],
    ['부자재', '-', ''],
  ];

  const LEGIT: Array<[string, string, string]> = [
    ['설탕', '0', 'g'],
    ['유해물질', '0', '%'],
    ['두께 오차', '0', 'mm'],
    ['길이 변형', '0', '%'],
    ['주름', '0', '개'],
    ['누적 판매', '12000', '개'],
    ['보증 기간', '24', '개월'],
    ['개봉 후 사용기간', '12', '개월'],
    ['최종 등급', '3', ''],
    ['각종 인증', '5', ''],
    ['세트 구성 중량', '500', 'g'],
    ['세트당 수량', '3', ''],
    ['색상 유지력', '95', '%'],
    ['단계별 온도 조절', '5', ''],
    ['가슴둘레', '95~110', 'cm'],
    ['무게', '180', 'g'],
    ['폭발 위험', '0', '건'],
  ];

  it.each(NOISE)('노이즈로 판정: %s / %s / %s', (label, value, unit) => {
    expect(isNoiseStatItem({ label, value, unit })).toBe(true);
  });

  it.each(LEGIT)('정당한 지표로 유지: %s / %s / %s', (label, value, unit) => {
    expect(isNoiseStatItem({ label, value, unit })).toBe(false);
  });
});
