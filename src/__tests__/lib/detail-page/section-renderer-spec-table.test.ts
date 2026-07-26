import { describe, it, expect } from 'vitest';
import { renderSection } from '@/lib/detail-page/section-renderer';
import { zLayoutBlock, isEmptyBlock } from '@/lib/detail-page/layout-validator';
import type { DetailSection, DetailPageTheme, ClaudeLayoutContent } from '@/types/detail-page';

const THEME: DetailPageTheme = {
  palette: 'warm_cream',
  primaryColor: '#e07b54',
  accentColor: '#c45e3a',
  fontStyle: 'sans',
  imageLayout: 'fullbleed',
};

function makeSection(blocks: ClaudeLayoutContent['blocks']): DetailSection {
  return {
    id: 'test',
    type: 'claude_layout',
    content: { type: 'claude_layout', title: '테스트', blocks },
    attachedImages: [],
  };
}

const SIZE_TABLE = {
  type: 'spec_table' as const,
  columns: ['사이즈', '허리단면', '총장', '밑위'],
  rows: [
    ['M', '36', '42', '28'],
    ['L', '38', '43', '29'],
  ],
  unit: 'cm',
  note: '평면 실측이며 1~2cm 오차가 있을 수 있습니다.',
};

describe('spec_table 블록', () => {
  it('머리행·데이터행·단위·비고를 모두 렌더링한다', () => {
    const html = renderSection(makeSection([SIZE_TABLE]), THEME);
    expect(html).toContain('허리단면');
    expect(html).toContain('밑위');
    expect(html).toContain('>M<');
    expect(html).toContain('38');
    expect(html).toContain('단위: cm');
    expect(html).toContain('1~2cm 오차');
    expect(html).toContain('<table');
  });

  it('행 길이가 열 수보다 짧아도 열이 밀리지 않는다', () => {
    // 3열인데 데이터가 2칸뿐인 행 — 빈 셀로 채워 같은 td 개수를 유지해야 한다.
    const html = renderSection(makeSection([{
      type: 'spec_table',
      columns: ['항목', '값', '비고'],
      rows: [['소재', '면 100%', '겉감'], ['원산지', '베트남']],
    }]), THEME);
    const rows = html.split('<tr').slice(1);
    const bodyRows = rows.filter(r => r.includes('<td'));
    expect(bodyRows).toHaveLength(2);
    for (const r of bodyRows) {
      expect((r.match(/<td/g) ?? [])).toHaveLength(3);
    }
  });

  it('열이 5개를 넘으면 잘라낸다 — 390px에서 읽히지 않기 때문', () => {
    const html = renderSection(makeSection([{
      type: 'spec_table',
      columns: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      rows: [['1', '2', '3', '4', '5', '6', '7']],
    }]), THEME);
    expect(html).toContain('>E<');
    expect(html).not.toContain('>F<');
    expect(html).not.toContain('>G<');
    const headerRow = html.split('<tr')[1] ?? '';
    expect((headerRow.match(/<th/g) ?? [])).toHaveLength(5);
  });

  it('rows가 비면 표 껍데기를 남기지 않는다', () => {
    const html = renderSection(makeSection([{
      type: 'spec_table', columns: ['사이즈', '총장'], rows: [],
    }]), THEME);
    expect(html).not.toContain('<table');
    // 정화 단계에서도 빈 블록으로 잡혀야 한다
    expect(isEmptyBlock({ type: 'spec_table', columns: ['사이즈'], rows: [] })).toBe(true);
    expect(isEmptyBlock({ type: 'spec_table', columns: ['사이즈'], rows: [['M']] })).toBe(false);
  });

  it('스키마가 spec_table을 통과시킨다', () => {
    expect(zLayoutBlock.safeParse(SIZE_TABLE).success).toBe(true);
    // rows는 문자열 배열의 배열이어야 한다 — 숫자를 넣으면 거부
    expect(zLayoutBlock.safeParse({
      type: 'spec_table', columns: ['사이즈'], rows: [[36]],
    }).success).toBe(false);
  });
});
