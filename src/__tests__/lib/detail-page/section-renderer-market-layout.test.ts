/**
 * 마켓플레이스 호환 레이아웃 회귀 테스트
 *
 * 🔴 실측 2026-09-05(보태니컬 비누 상세를 네이버·쿠팡·토스에 올린 뒤 모바일 확인):
 *  1) 네이버 앱 상품상세 뷰어는 저장된 HTML의 display:flex / display:grid를 렌더하지
 *     않는다. HTML 자체는 손상 없이 저장되는데(재조회 시 flex 28개·grid 2개 그대로)
 *     화면에서는 자식이 전부 세로로 쌓인다. <table>은 정상 렌더된다.
 *  2) 마켓은 인라인 <svg>를 렌더하지 않고 소스 코드를 텍스트로 노출한다.
 *
 * 이 파일은 렌더러가 그 두 제약을 계속 지키는지 잡아둔다.
 */
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

function makeSection(content: ClaudeLayoutContent, imageUrls: string[] = []): DetailSection {
  return {
    id: 'market-1',
    type: 'claude_layout',
    content,
    attachedImages: imageUrls.map((url, i) => ({ url, order: i, processingMode: 'original' as const })),
  };
}

/** flex-direction:column(세로)은 허용된다 — 뷰어가 flex를 무시해도 결과가 같다. */
function horizontalFlexCount(html: string): number {
  return (html.match(/display:flex/g) ?? []).length - (html.match(/flex-direction:column/g) ?? []).length;
}

describe('icon_grid — grid 대신 table', () => {
  const section = makeSection({
    type: 'claude_layout',
    title: '',
    blocks: [
      {
        type: 'icon_grid',
        cols: 2,
        items: [
          { icon: 'pack_sealed', title: '낱개 밀봉' },
          { icon: 'pack_sealed', title: '대용량' },
          { icon: 'pack_sealed', title: '휴대' },
          { icon: 'pack_sealed', title: '보관' },
        ],
      },
    ],
  });

  it('table로 렌더되고 display:grid는 남지 않는다', () => {
    const html = renderSection(section, THEME);
    expect(html).toContain('<table');
    expect(html).toContain('table-layout:fixed');
    expect(html).not.toContain('display:grid');
    expect(html).not.toContain('grid-template-columns');
  });

  it('cols개씩 끊어 행으로 나뉜다 (2열 × 4항목 → 2행)', () => {
    const html = renderSection(section, THEME);
    expect(html.match(/<tr>/g)?.length).toBe(2);
    expect(html.match(/<td /g)?.length).toBe(4);
  });

  it('gap은 border-spacing으로 대체된다', () => {
    const html = renderSection(section, THEME);
    expect(html).toContain('border-spacing:8px 8px;');
  });
});

describe('columns — 좌우 2단은 table 1행', () => {
  const section = makeSection({
    type: 'claude_layout',
    title: '',
    blocks: [
      {
        type: 'columns',
        gap: 12,
        cols: [
          [{ type: 'heading', text: '왼쪽', size: 'md' }],
          [{ type: 'heading', text: '오른쪽', size: 'md' }],
        ],
      },
    ],
  });

  it('table로 렌더되고 가로 flex는 남지 않는다', () => {
    const html = renderSection(section, THEME);
    expect(html).toContain('<table');
    expect(html).toContain('왼쪽');
    expect(html).toContain('오른쪽');
    expect(horizontalFlexCount(html)).toBe(0);
  });

  it('두 단이 같은 행의 td 2개가 된다', () => {
    const html = renderSection(section, THEME);
    expect(html.match(/<tr>/g)?.length).toBe(1);
    expect(html.match(/<td /g)?.length).toBe(2);
  });
});

describe('process_flow', () => {
  const items = [
    { label: '1단계' },
    { label: '2단계' },
    { label: '3단계' },
  ];

  it('가로 방향 — table 1행이 되고 화살표 칸은 24px로 좁다', () => {
    const html = renderSection(
      makeSection({ type: 'claude_layout', title: '', blocks: [{ type: 'process_flow', items }] }),
      THEME,
    );
    expect(html).toContain('<table');
    expect(horizontalFlexCount(html)).toBe(0);
    // 스텝 3 + 화살표 2 = td 5개
    expect(html.match(/<td /g)?.length).toBe(5);
    expect(html.match(/width:24px;/g)?.length).toBe(2);
  });

  it('세로 방향 — flex-direction:column은 그대로 둔다 (무너져도 결과가 같다)', () => {
    const html = renderSection(
      makeSection({
        type: 'claude_layout',
        title: '',
        blocks: [{ type: 'process_flow', direction: 'vertical', items }],
      }),
      THEME,
    );
    expect(html).toContain('flex-direction:column');
    // 세로 컨테이너 1개 외의 가로 flex는 없어야 한다
    expect(horizontalFlexCount(html)).toBe(0);
  });
});

describe('option_grid — grid 대신 table, 카드 내부 세로 flex는 유지', () => {
  it('table로 렌더되고 카드의 flex-direction:column은 남는다', () => {
    const html = renderSection(
      makeSection({
        type: 'claude_layout',
        title: '',
        blocks: [
          { type: 'option_grid', cols: 2, items: [{ label: 'S' }, { label: 'M' }] },
        ],
      }),
      THEME,
    );
    expect(html).toContain('<table');
    expect(html).not.toContain('display:grid');
    expect(html.match(/flex-direction:column/g)?.length).toBe(2);
    expect(horizontalFlexCount(html)).toBe(0);
  });
});

describe('icon_grid 아이콘 — iconUrls 주입', () => {
  const section = makeSection({
    type: 'claude_layout',
    title: '',
    blocks: [
      {
        type: 'icon_grid',
        cols: 2,
        items: [
          { icon: 'pack_sealed', title: '낱개 밀봉' },
          { icon: 'duration_clock', title: '오래' },
        ],
      },
    ],
  });

  it('iconUrls를 주면 <img>로 렌더하고 인라인 <svg>는 남지 않는다', () => {
    const html = renderSection(section, THEME, 'export', {
      iconUrls: {
        pack_sealed: 'https://cdn.example.com/icons/pack.png',
        duration_clock: 'https://cdn.example.com/icons/clock.png',
      },
    });
    expect(html).toContain('<img src="https://cdn.example.com/icons/pack.png"');
    expect(html).toContain('<img src="https://cdn.example.com/icons/clock.png"');
    expect(html).not.toContain('<svg');
  });

  it('iconUrls를 주지 않으면 기존 인라인 SVG를 유지한다 (앱 미리보기용)', () => {
    const html = renderSection(section, THEME);
    expect(html).toContain('<svg');
    expect(html).not.toContain('<img src="https://cdn.example.com');
  });

  it('맵에 없는 키는 인라인 SVG로 폴백한다', () => {
    const html = renderSection(section, THEME, 'export', {
      iconUrls: { pack_sealed: 'https://cdn.example.com/icons/pack.png' },
    });
    expect(html).toContain('<img src="https://cdn.example.com/icons/pack.png"');
    expect(html).toContain('<svg');
  });

  it('악성 URL은 걸러지고 인라인 SVG로 폴백한다', () => {
    const html = renderSection(section, THEME, 'export', {
      iconUrls: { pack_sealed: 'javascript:alert(1)' },
    });
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<svg');
  });
});

describe('stat_row / bullet_list / timeline도 table로 낸다', () => {
  it('stat_row — 가로 flex 없음', () => {
    const html = renderSection(
      makeSection({
        type: 'claude_layout',
        title: '',
        blocks: [{ type: 'stat_row', items: [{ value: '99', unit: '%', label: '만족도' }, { value: '3', label: '일' }] }],
      }),
      THEME,
    );
    expect(html).toContain('<table');
    expect(horizontalFlexCount(html)).toBe(0);
  });

  it('bullet_list — 기호와 본문이 같은 행의 td 2개가 된다', () => {
    const html = renderSection(
      makeSection({
        type: 'claude_layout',
        title: '',
        blocks: [{ type: 'bullet_list', icon: 'check', items: ['첫째', '둘째'] }],
      }),
      THEME,
    );
    expect(html.match(/<tr>/g)?.length).toBe(2);
    expect(html.match(/<td /g)?.length).toBe(4);
    expect(horizontalFlexCount(html)).toBe(0);
  });

  it('timeline — 가로 flex 없음', () => {
    const html = renderSection(
      makeSection({
        type: 'claude_layout',
        title: '',
        blocks: [{ type: 'timeline', items: [{ stage: '주문' }, { stage: '출고' }, { stage: '배송' }] }],
      }),
      THEME,
    );
    expect(html).toContain('<table');
    expect(html.match(/<td /g)?.length).toBe(3);
    expect(horizontalFlexCount(html)).toBe(0);
  });
});
