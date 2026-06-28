import { describe, it, expect } from 'vitest';
import { renderSection } from '@/lib/detail-page/section-renderer';
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

describe('renderLayoutBlock — 신규 4개 블록', () => {
  it('progress_bar — 두 항목 렌더링, 퍼센트 너비 반영', () => {
    const html = renderSection(makeSection([{
      type: 'progress_bar',
      items: [
        { label: '나이아신', value: 100, displayValue: '100%', highlight: true },
        { label: '기준치', value: 80 },
      ],
    }]), THEME);
    expect(html).toContain('나이아신');
    expect(html).toContain('width:100%');
    expect(html).toContain('기준치');
    expect(html).toContain('width:80%');
  });

  it('process_flow — 화살표와 함께 항목 렌더링', () => {
    const html = renderSection(makeSection([{
      type: 'process_flow',
      items: [
        { label: '원재료' },
        { label: '발효', highlight: true },
        { label: '농축' },
      ],
    }]), THEME);
    expect(html).toContain('원재료');
    expect(html).toContain('발효');
    expect(html).toContain('농축');
    expect(html).toContain('→');
  });

  it('icon_grid — 3열 기본값, 아이콘과 제목 렌더링', () => {
    const html = renderSection(makeSection([{
      type: 'icon_grid',
      items: [
        { icon: '🧬', title: 'NMN 함유' },
        { icon: '✅', title: 'HACCP 인증' },
        { icon: '🔬', title: '핵심 포뮬러' },
      ],
    }]), THEME);
    expect(html).toContain('🧬');
    expect(html).toContain('NMN 함유');
    expect(html).toContain('HACCP 인증');
  });

  it('layout_bar_chart — SVG img 태그 + 데이터 포함', () => {
    const html = renderSection(makeSection([{
      type: 'layout_bar_chart',
      title: 'NAD+ 수치 변화',
      groups: ['Placebo', 'NMN'],
      groupColors: ['#d1d5db', '#c45e3a'],
      items: [
        { label: '4주', values: [5, 15] },
        { label: '8주', values: [6, 40] },
      ],
      unit: 'nmol/L',
    }]), THEME);
    expect(html).toContain('<img');
    expect(html).toContain('data:image/svg+xml;base64,');
    expect(html).toContain('NAD+ 수치 변화');
  });

  it('XSS 방어 — process_flow 레이블 escape', () => {
    const html = renderSection(makeSection([{
      type: 'process_flow',
      items: [{ label: '<script>alert(1)</script>' }],
    }]), THEME);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderLayoutBlock — Phase 2 블록', () => {
  it('radar_chart — SVG base64 img 반환, 모든 축 레이블 포함', () => {
    const html = renderSection(makeSection([{
      type: 'radar_chart',
      axes: [
        { label: 'NMN 함량', value: 90 },
        { label: '흡수율', value: 75 },
        { label: '안전성', value: 95 },
        { label: '가성비', value: 70 },
        { label: '원료 품질', value: 85 },
      ],
      color: '#6366f1',
    }]), THEME);
    // HTML에 img 태그와 base64 data URI 포함 확인
    expect(html).toContain('<img');
    expect(html).toContain('data:image/svg+xml;base64,');
    // SVG 내부 레이블 확인 (base64 디코딩)
    const base64Match = html.match(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/);
    expect(base64Match).not.toBeNull();
    const svgContent = Buffer.from(base64Match![1], 'base64').toString('utf-8');
    expect(svgContent).toContain('NMN 함량');
    expect(svgContent).toContain('흡수율');
  });

  it('radar_chart — XSS 방어: 축 레이블 escape (SVG base64 embed로 스크립트 미노출)', () => {
    const html = renderSection(makeSection([{
      type: 'radar_chart',
      axes: [{ label: '<script>xss</script>', value: 50 }],
    }]), THEME);
    // base64 img embed이므로 <script> 태그가 최종 HTML에 직접 노출되지 않아야 함
    expect(html).not.toContain('<script>');
    // SVG 내부에서 escapeHtml이 적용됐는지 base64 디코딩으로 검증
    const base64Match = html.match(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/);
    expect(base64Match).not.toBeNull();
    const svgContent = Buffer.from(base64Match![1], 'base64').toString('utf-8');
    expect(svgContent).toContain('&lt;script&gt;');
    expect(svgContent).not.toContain('<script>xss</script>');
  });

  it('radar_chart — 빈 axes 배열도 크래시 없이 img 미포함 반환', () => {
    const html = renderSection(makeSection([{
      type: 'radar_chart',
      axes: [],
    }]), THEME);
    // axes가 없으면 SVG/img를 렌더링하지 않음
    expect(html).not.toContain('<img');
    expect(html).not.toContain('data:image/svg+xml;base64,');
  });

  it('timeline — 가로 타임라인, 모든 stage 레이블 포함', () => {
    const html = renderSection(makeSection([{
      type: 'timeline',
      items: [
        { stage: '20대', value: '높음', highlight: false },
        { stage: '30-40대', value: '보통', highlight: true },
        { stage: '50대 이상', value: '낮음', highlight: false },
      ],
    }]), THEME);
    expect(html).toContain('20대');
    expect(html).toContain('30-40대');
    expect(html).toContain('50대 이상');
    expect(html).toContain('높음');
    expect(html).toContain('낮음');
  });

  it('timeline — highlight 항목은 강조 스타일 포함', () => {
    const html = renderSection(makeSection([{
      type: 'timeline',
      items: [
        { stage: '시작', highlight: false },
        { stage: '핵심', highlight: true },
        { stage: '완성', highlight: false },
      ],
    }]), THEME);
    expect(html).toContain('핵심');
    // highlight 항목이 강조 색상을 가져야 함 (accent 색상)
    const parts = html.split('핵심');
    // highlight 항목 주변에 accent 색상 스타일이 존재
    expect(parts[0]).toMatch(/background|background-color/);
  });

  it('timeline — XSS 방어: stage 레이블 escape', () => {
    const html = renderSection(makeSection([{
      type: 'timeline',
      items: [{ stage: '<script>xss</script>', value: '<b>bold</b>' }],
    }]), THEME);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('timeline — 빈 items 배열도 크래시 없이 빈 문자열 반환', () => {
    const html = renderSection(makeSection([{
      type: 'timeline',
      items: [],
    }]), THEME);
    // items가 없으면 렌더링하지 않음
    expect(html).not.toContain('timeline');
    // 빈 타임라인이 렌더링되지 않아야 함
  });
});
