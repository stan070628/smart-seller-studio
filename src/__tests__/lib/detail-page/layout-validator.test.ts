import { describe, it, expect } from 'vitest';
import { validateProLayout, sanitizeProLayout } from '@/lib/detail-page/layout-validator';

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
