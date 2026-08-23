import { describe, it, expect } from 'vitest';
import { wrapRenderedSections, FONT_FAMILY_MAP } from '@/lib/detail-page/wrap-rendered';
import { appendPrivacyFooter } from '@/lib/detail-page-privacy';
import type { DetailPageTheme } from '@/types/detail-page';

const theme = (over: Partial<DetailPageTheme> = {}) =>
  ({ palette: 'cool_white', primaryColor: '#fff', accentColor: '#000',
     fontStyle: 'sans', imageLayout: 'fullbleed', ...over } as DetailPageTheme);

describe('wrapRenderedSections', () => {
  it('본문을 max-width 컨테이너로 감싸고 font-family를 넣는다', () => {
    // 이 래핑을 건너뛴 채 renderAllSections 결과를 그대로 등록하면 폭 래퍼와 폰트가
    // 둘 다 빠진다 — 2026-08-17 거실화(16349039276)에서 실제로 그렇게 나갔다.
    const html = wrapRenderedSections('<div>본문</div>', theme());
    expect(html).toContain('max-width:780px');
    expect(html).toContain('margin:0 auto');
    expect(html).toContain(`font-family:${FONT_FAMILY_MAP.sans}`);
    expect(html).toContain('<div>본문</div>');
  });

  it('mobile은 390px, 그 외는 780px를 쓴다', () => {
    expect(wrapRenderedSections('x', theme({ layoutMode: 'mobile' }))).toContain('max-width:390px');
    expect(wrapRenderedSections('x', theme({ layoutMode: 'desktop' }))).toContain('max-width:780px');
    expect(wrapRenderedSections('x', theme())).toContain('max-width:780px');
  });

  it('🔴 본문 폭과 고지 푸터 폭이 같다', () => {
    // 본문에 래퍼가 없으면 본문은 부모 폭을 무제한 따라가는데 푸터만 고정돼,
    // 넓은 화면에서 둘이 갈린다. 모바일만 열어보면 발견되지 않는 종류의 결함이다.
    for (const layoutMode of ['mobile', 'desktop'] as const) {
      const full = appendPrivacyFooter(wrapRenderedSections('<p>본문</p>', theme({ layoutMode })), layoutMode);
      const widths = [...full.matchAll(/max-width:(\d+px)/g)].map((m) => m[1]);
      expect(widths.length).toBeGreaterThanOrEqual(2); // 본문 래퍼 + 푸터 래퍼
      expect(new Set(widths).size).toBe(1);            // 전부 같은 폭
    }
  });

  it('fontStyle이 없어도 font-family:undefined를 쓰지 않는다', () => {
    const html = wrapRenderedSections('x', { } as DetailPageTheme);
    expect(html).not.toContain('undefined');
    expect(html).toContain('font-family:');
  });

  it('serif는 명조 계열로 매핑된다', () => {
    expect(wrapRenderedSections('x', theme({ fontStyle: 'serif' }))).toContain('Noto Serif KR');
  });
});
