import { describe, it, expect } from 'vitest';
import { renderSection, renderAllSections } from '@/lib/detail-page/section-renderer';
import type { DetailSection, DetailPageTheme } from '@/types/detail-page';
import { PALETTES } from '@/lib/detail-page/palette-config';

// ---------------------------------------------------------------------------
// 테스트 픽스처 헬퍼
// ---------------------------------------------------------------------------

const WARM_CREAM_THEME: DetailPageTheme = {
  palette: 'warm_cream',
  primaryColor: '#F5F0E8',
  accentColor: '#7A5C10',
  fontStyle: 'mixed',
  imageLayout: 'fullbleed',
};

const DEEP_DARK_THEME: DetailPageTheme = {
  palette: 'deep_dark',
  primaryColor: '#1A1A1A',
  accentColor: '#FFC107',
  fontStyle: 'sans',
  imageLayout: 'fullbleed',
};

function baseSection(
  overrides: Partial<DetailSection> & Pick<DetailSection, 'type' | 'content'>,
): DetailSection {
  return {
    id: 'test-section-id',
    order: 0,
    attachedImages: [],
    aiInstruction: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// renderSection — hero
// ---------------------------------------------------------------------------

describe('renderSection — hero', () => {
  it('headline과 subheadline이 출력 HTML에 포함된다', () => {
    const section = baseSection({
      type: 'hero',
      content: { type: 'hero', headline: '최고의 텀블러', subheadline: '365일 차갑게' },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain('최고의 텀블러');
    expect(html).toContain('365일 차갑게');
  });

  it('data-section-id 속성에 섹션 id가 포함된다', () => {
    const section = baseSection({
      id: 'hero-001',
      type: 'hero',
      content: { type: 'hero', headline: 'H', subheadline: 'S' },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain('data-section-id="hero-001"');
  });

  it('warm_cream 팔레트 배경색(#F5F0E8)이 style 속성에 포함된다', () => {
    const section = baseSection({
      type: 'hero',
      content: { type: 'hero', headline: 'H', subheadline: 'S' },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain(PALETTES['warm_cream'].bg);
  });

  it('deep_dark 팔레트 배경색(#1A1A1A)이 style 속성에 포함된다', () => {
    const section = baseSection({
      type: 'hero',
      content: { type: 'hero', headline: 'H', subheadline: 'S' },
    });
    const html = renderSection(section, DEEP_DARK_THEME);
    expect(html).toContain(PALETTES['deep_dark'].bg);
  });

  it('첨부 이미지가 있으면 img 태그가 렌더링된다', () => {
    const section = baseSection({
      type: 'hero',
      content: { type: 'hero', headline: 'H', subheadline: 'S' },
      attachedImages: [{ url: 'https://example.com/img.jpg', order: 0, processingMode: 'original' }],
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain('<img');
    expect(html).toContain('https://example.com/img.jpg');
  });
});

// ---------------------------------------------------------------------------
// renderSection — selling_points
// ---------------------------------------------------------------------------

describe('renderSection — selling_points', () => {
  it('icon, title, description이 각 포인트마다 출력된다', () => {
    const section = baseSection({
      type: 'selling_points',
      content: {
        type: 'selling_points',
        points: [
          { icon: '🔥', title: '내열성', description: '200도까지 견딤' },
          { icon: '💧', title: '방수', description: '완전 방수 처리' },
        ],
      },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain('🔥');
    expect(html).toContain('내열성');
    expect(html).toContain('200도까지 견딤');
    expect(html).toContain('💧');
    expect(html).toContain('방수');
    expect(html).toContain('완전 방수 처리');
  });

  it('data-section-id 속성이 포함된다', () => {
    const section = baseSection({
      id: 'sp-abc',
      type: 'selling_points',
      content: { type: 'selling_points', points: [] },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain('data-section-id="sp-abc"');
  });
});

// ---------------------------------------------------------------------------
// renderSection — features
// ---------------------------------------------------------------------------

describe('renderSection — features', () => {
  it('각 아이템의 title과 description이 출력된다', () => {
    const section = baseSection({
      type: 'features',
      content: {
        type: 'features',
        items: [
          { title: '이중벽 구조', description: '진공 단열로 온도 유지' },
          { title: '인체공학 손잡이', description: '손목 피로 감소 설계' },
        ],
      },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain('이중벽 구조');
    expect(html).toContain('진공 단열로 온도 유지');
    expect(html).toContain('인체공학 손잡이');
    expect(html).toContain('손목 피로 감소 설계');
  });

  it('bgAlt 색상이 배경에 사용된다', () => {
    const section = baseSection({
      type: 'features',
      content: { type: 'features', items: [] },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain(PALETTES['warm_cream'].bgAlt);
  });
});

// ---------------------------------------------------------------------------
// renderSection — stats
// ---------------------------------------------------------------------------

describe('renderSection — stats', () => {
  it('value와 label이 출력된다', () => {
    const section = baseSection({
      type: 'stats',
      content: {
        type: 'stats',
        stats: [
          { value: '98%', label: '고객 만족도' },
          { value: '50,000+', label: '누적 판매량' },
        ],
      },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain('98%');
    expect(html).toContain('고객 만족도');
    expect(html).toContain('50,000+');
    expect(html).toContain('누적 판매량');
  });

  it('accent 색상이 숫자 스타일에 사용된다', () => {
    const section = baseSection({
      type: 'stats',
      content: { type: 'stats', stats: [{ value: '1', label: 'L' }] },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain(PALETTES['warm_cream'].accent);
  });
});

// ---------------------------------------------------------------------------
// renderSection — spec_table
// ---------------------------------------------------------------------------

describe('renderSection — spec_table', () => {
  it('label과 value가 테이블 행에 출력된다', () => {
    const section = baseSection({
      type: 'spec_table',
      content: {
        type: 'spec_table',
        specs: [
          { label: '소재', value: '스테인리스 스틸' },
          { label: '용량', value: '500ml' },
        ],
      },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain('소재');
    expect(html).toContain('스테인리스 스틸');
    expect(html).toContain('용량');
    expect(html).toContain('500ml');
  });

  it('table 태그가 포함된다', () => {
    const section = baseSection({
      type: 'spec_table',
      content: { type: 'spec_table', specs: [{ label: 'L', value: 'V' }] },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain('<table');
    expect(html).toContain('</table>');
  });
});

// ---------------------------------------------------------------------------
// renderSection — usage_steps
// ---------------------------------------------------------------------------

describe('renderSection — usage_steps', () => {
  it('각 단계 텍스트가 출력된다', () => {
    const section = baseSection({
      type: 'usage_steps',
      content: {
        type: 'usage_steps',
        steps: ['세척 후 사용', '뚜껑을 시계 방향으로 잠근다', '냉장 보관 가능'],
      },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain('세척 후 사용');
    expect(html).toContain('뚜껑을 시계 방향으로 잠근다');
    expect(html).toContain('냉장 보관 가능');
  });

  it('단계 번호가 1부터 순차적으로 렌더링된다', () => {
    const section = baseSection({
      type: 'usage_steps',
      content: { type: 'usage_steps', steps: ['첫 번째 단계', '두 번째 단계'] },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    // 번호 뱃지가 텍스트로 포함됨
    expect(html).toContain('>1<');
    expect(html).toContain('>2<');
  });

  it('bgAlt 색상이 배경에 사용된다', () => {
    const section = baseSection({
      type: 'usage_steps',
      content: { type: 'usage_steps', steps: ['단계'] },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain(PALETTES['warm_cream'].bgAlt);
  });
});

// ---------------------------------------------------------------------------
// renderSection — warning
// ---------------------------------------------------------------------------

describe('renderSection — warning', () => {
  it('각 경고 항목 텍스트가 출력된다', () => {
    const section = baseSection({
      type: 'warning',
      content: {
        type: 'warning',
        warnings: ['직사광선 노출 금지', '영하 20도 이하 보관 금지'],
      },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain('직사광선 노출 금지');
    expect(html).toContain('영하 20도 이하 보관 금지');
  });

  it('⚠️ 접두사가 각 경고 항목 앞에 붙는다', () => {
    const section = baseSection({
      type: 'warning',
      content: { type: 'warning', warnings: ['주의사항 하나'] },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain('⚠️');
  });

  it('고정 경고 배경색(#FFF3CD)이 사용된다 (팔레트 무관)', () => {
    const section = baseSection({
      type: 'warning',
      content: { type: 'warning', warnings: ['주의'] },
    });
    const htmlWarm = renderSection(section, WARM_CREAM_THEME);
    const htmlDark = renderSection(section, DEEP_DARK_THEME);
    expect(htmlWarm).toContain('#FFF3CD');
    expect(htmlDark).toContain('#FFF3CD');
  });

  it('고정 border-left 색상(#FFC107)이 사용된다', () => {
    const section = baseSection({
      type: 'warning',
      content: { type: 'warning', warnings: ['주의'] },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain('#FFC107');
  });
});

// ---------------------------------------------------------------------------
// renderSection — cta
// ---------------------------------------------------------------------------

describe('renderSection — cta', () => {
  it('text가 출력된다', () => {
    const section = baseSection({
      type: 'cta',
      content: { type: 'cta', text: '지금 바로 구매하기' },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain('지금 바로 구매하기');
  });

  it('accent 색상이 배경으로 사용된다', () => {
    const section = baseSection({
      type: 'cta',
      content: { type: 'cta', text: '구매' },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain(PALETTES['warm_cream'].accent);
  });

  it('deep_dark 팔레트 accentTextColor(#111111)가 텍스트 색상으로 사용된다', () => {
    const section = baseSection({
      type: 'cta',
      content: { type: 'cta', text: '구매' },
    });
    const html = renderSection(section, DEEP_DARK_THEME);
    expect(html).toContain(PALETTES['deep_dark'].accentTextColor);
  });
});

// ---------------------------------------------------------------------------
// XSS 방어 — escapeHtml
// ---------------------------------------------------------------------------

describe('XSS 방어 — escapeHtml', () => {
  it('<script> 태그가 &lt;script&gt;로 이스케이프된다', () => {
    const section = baseSection({
      type: 'hero',
      content: { type: 'hero', headline: '<script>alert("xss")</script>', subheadline: '' },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('큰따옴표(")가 &quot;로 이스케이프된다', () => {
    const section = baseSection({
      type: 'hero',
      content: { type: 'hero', headline: 'say "hello"', subheadline: '' },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain('&quot;');
  });

  it("작은따옴표(')가 &#39;로 이스케이프된다", () => {
    const section = baseSection({
      type: 'hero',
      content: { type: 'hero', headline: "it's fine", subheadline: '' },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain('&#39;');
  });

  it('앰퍼샌드(&)가 &amp;로 이스케이프된다', () => {
    const section = baseSection({
      type: 'hero',
      content: { type: 'hero', headline: 'A & B', subheadline: '' },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain('&amp;');
  });

  it('경고 섹션 content에서도 XSS가 이스케이프된다', () => {
    const section = baseSection({
      type: 'warning',
      content: { type: 'warning', warnings: ['<img onerror="alert(1)" src=x>'] },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;img');
  });

  it('spec_table label과 value에서도 XSS가 이스케이프된다', () => {
    const section = baseSection({
      type: 'spec_table',
      content: {
        type: 'spec_table',
        specs: [{ label: '<b>소재</b>', value: '100% <script>' }],
      },
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).not.toContain('<b>소재</b>');
    expect(html).toContain('&lt;b&gt;소재&lt;/b&gt;');
  });
});

// ---------------------------------------------------------------------------
// sanitizeUrl — javascript: URL 차단
// ---------------------------------------------------------------------------

describe('sanitizeUrl — 악성 URL 처리', () => {
  it('javascript: URL이 포함된 첨부 이미지는 렌더링되지 않는다', () => {
    const section = baseSection({
      type: 'hero',
      content: { type: 'hero', headline: 'H', subheadline: 'S' },
      attachedImages: [
        { url: 'javascript:alert("xss")', order: 0, processingMode: 'original' },
      ],
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<img');
  });

  it('data: URL은 렌더링되지 않는다', () => {
    const section = baseSection({
      type: 'selling_points',
      content: { type: 'selling_points', points: [] },
      attachedImages: [
        { url: 'data:text/html,<script>alert(1)</script>', order: 0, processingMode: 'original' },
      ],
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).not.toContain('<img');
  });

  it('https:// 로 시작하는 정상 URL은 렌더링된다', () => {
    const section = baseSection({
      type: 'hero',
      content: { type: 'hero', headline: 'H', subheadline: 'S' },
      attachedImages: [
        { url: 'https://cdn.example.com/image.jpg', order: 0, processingMode: 'original' },
      ],
    });
    const html = renderSection(section, WARM_CREAM_THEME);
    expect(html).toContain('<img');
    expect(html).toContain('https://cdn.example.com/image.jpg');
  });
});

// ---------------------------------------------------------------------------
// renderAllSections — 순서 정렬 및 복합 렌더링
// ---------------------------------------------------------------------------

describe('renderAllSections', () => {
  it('order 기준 오름차순으로 정렬되어 렌더링된다', () => {
    const sections: DetailSection[] = [
      baseSection({ id: 'cta-last', order: 2, type: 'cta', content: { type: 'cta', text: 'CTA 텍스트' } }),
      baseSection({ id: 'hero-first', order: 0, type: 'hero', content: { type: 'hero', headline: 'Hero 헤드라인', subheadline: '' } }),
      baseSection({ id: 'warn-mid', order: 1, type: 'warning', content: { type: 'warning', warnings: ['경고1'] } }),
    ];
    const html = renderAllSections(sections, WARM_CREAM_THEME);

    const heroPos = html.indexOf('Hero 헤드라인');
    const warnPos = html.indexOf('경고1');
    const ctaPos = html.indexOf('CTA 텍스트');

    expect(heroPos).toBeLessThan(warnPos);
    expect(warnPos).toBeLessThan(ctaPos);
  });

  it('각 섹션의 data-section-id가 모두 출력에 포함된다', () => {
    const sections: DetailSection[] = [
      baseSection({ id: 's1', order: 0, type: 'hero', content: { type: 'hero', headline: 'H', subheadline: '' } }),
      baseSection({ id: 's2', order: 1, type: 'cta', content: { type: 'cta', text: 'Buy' } }),
    ];
    const html = renderAllSections(sections, WARM_CREAM_THEME);
    expect(html).toContain('data-section-id="s1"');
    expect(html).toContain('data-section-id="s2"');
  });

  it('원본 sections 배열이 변경되지 않는다 (불변성 보장)', () => {
    const sections: DetailSection[] = [
      baseSection({ id: 'z', order: 1, type: 'cta', content: { type: 'cta', text: 'Z' } }),
      baseSection({ id: 'a', order: 0, type: 'hero', content: { type: 'hero', headline: 'A', subheadline: '' } }),
    ];
    const originalOrder = sections.map((s) => s.id);
    renderAllSections(sections, WARM_CREAM_THEME);
    expect(sections.map((s) => s.id)).toEqual(originalOrder);
  });

  it('빈 sections 배열 입력 시 빈 문자열을 반환한다', () => {
    const html = renderAllSections([], WARM_CREAM_THEME);
    expect(html).toBe('');
  });

  it('단일 섹션도 정상적으로 렌더링된다', () => {
    const sections: DetailSection[] = [
      baseSection({ id: 'solo', order: 0, type: 'hero', content: { type: 'hero', headline: '단독', subheadline: '' } }),
    ];
    const html = renderAllSections(sections, WARM_CREAM_THEME);
    expect(html).toContain('단독');
  });
});

// ---------------------------------------------------------------------------
// 팔레트 색상 반영 검증
// ---------------------------------------------------------------------------

describe('팔레트 색상 반영', () => {
  it('warm_cream과 deep_dark의 배경색이 서로 다르게 출력된다', () => {
    const section = baseSection({
      type: 'hero',
      content: { type: 'hero', headline: 'H', subheadline: 'S' },
    });
    const warmHtml = renderSection(section, WARM_CREAM_THEME);
    const darkHtml = renderSection(section, DEEP_DARK_THEME);
    // warm_cream bg = #F5F0E8, deep_dark bg = #1A1A1A — 배경색이 서로 다른 값임
    expect(warmHtml).toContain(PALETTES['warm_cream'].bg);  // #F5F0E8
    expect(darkHtml).toContain(PALETTES['deep_dark'].bg);   // #1A1A1A
    // warm_cream bg가 deep_dark bg와 다른 값임을 확인 (palette-config 기준 불변 사실)
    expect(PALETTES['warm_cream'].bg).not.toBe(PALETTES['deep_dark'].bg);
  });

  it('selling_points cardBg 색상이 팔레트에 따라 다르게 반영된다', () => {
    const section = baseSection({
      type: 'selling_points',
      content: {
        type: 'selling_points',
        points: [{ icon: '✅', title: 'T', description: 'D' }],
      },
    });
    const warmHtml = renderSection(section, WARM_CREAM_THEME);
    const darkHtml = renderSection(section, DEEP_DARK_THEME);
    expect(warmHtml).toContain(PALETTES['warm_cream'].cardBg);
    expect(darkHtml).toContain(PALETTES['deep_dark'].cardBg);
  });
});

// ---------------------------------------------------------------------------
// renderSection — attachedImages 2장 나란히 렌더링
// ---------------------------------------------------------------------------
describe('renderSection — attachedImages 2장', () => {
  const twoImageSection = baseSection({
    type: 'hero',
    content: { type: 'hero', headline: '제목', subheadline: '부제목' },
    attachedImages: [
      { url: 'https://example.com/img1.jpg', order: 0, processingMode: 'original' },
      { url: 'https://example.com/img2.jpg', order: 1, processingMode: 'original' },
    ],
  });

  it('2장 모두 img 태그로 렌더링된다', () => {
    const html = renderSection(twoImageSection, WARM_CREAM_THEME);
    expect(html).toContain('https://example.com/img1.jpg');
    expect(html).toContain('https://example.com/img2.jpg');
  });

  it('flex 컨테이너로 나란히 배치된다', () => {
    const html = renderSection(twoImageSection, WARM_CREAM_THEME);
    expect(html).toContain('display:flex;gap:8px;width:100%;box-sizing:border-box;');
    expect(html).toContain('width:50%');
  });

  it('한 장이 악성 URL이면 placeholder div가 삽입되고 flex 컨테이너는 유지된다', () => {
    const mixedSection = baseSection({
      type: 'hero',
      content: { type: 'hero', headline: '제목', subheadline: '부제목' },
      attachedImages: [
        { url: 'javascript:alert(1)', order: 0, processingMode: 'original' },
        { url: 'https://example.com/img2.jpg', order: 1, processingMode: 'original' },
      ],
    });
    const html = renderSection(mixedSection, WARM_CREAM_THEME);
    // flex 컨테이너는 유지되어야 함
    expect(html).toContain('display:flex;gap:8px;width:100%;box-sizing:border-box;');
    // 악성 URL은 출력에 포함되지 않아야 함
    expect(html).not.toContain('javascript:');
    // 유효한 URL은 렌더링되어야 함
    expect(html).toContain('https://example.com/img2.jpg');
  });

  it('2장 모두 악성 URL이면 빈 문자열 반환', () => {
    const bothMaliciousSection = baseSection({
      type: 'hero',
      content: { type: 'hero', headline: '제목', subheadline: '부제목' },
      attachedImages: [
        { url: 'javascript:alert(1)', order: 0, processingMode: 'original' },
        { url: 'javascript:alert(2)', order: 1, processingMode: 'original' },
      ],
    });
    const html = renderSection(bothMaliciousSection, WARM_CREAM_THEME);
    expect(html).not.toContain('display:flex');
    expect(html).not.toContain('javascript:');
  });

  it('1장만 있을 때는 단일 이미지 렌더링(width:100%)', () => {
    const oneImageSection = baseSection({
      type: 'hero',
      content: { type: 'hero', headline: '제목', subheadline: '부제목' },
      attachedImages: [
        { url: 'https://example.com/img1.jpg', order: 0, processingMode: 'original' },
      ],
    });
    const html = renderSection(oneImageSection, WARM_CREAM_THEME);
    expect(html).toContain('width:100%');
    expect(html).not.toContain('width:50%');
  });
});
