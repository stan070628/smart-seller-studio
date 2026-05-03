// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { truncateTitle, buildSvgOverlay } from '@/lib/listing/import-1688-thumbnail';

describe('truncateTitle', () => {
  it('20자 이하는 그대로 반환', () => {
    expect(truncateTitle('짧은 제목')).toBe('짧은 제목');
  });

  it('20자 초과는 20자로 잘라 ... 추가', () => {
    const long = '가'.repeat(25);
    const result = truncateTitle(long);
    expect(result).toBe('가'.repeat(20) + '...');
  });
});

describe('buildSvgOverlay', () => {
  it('500×500 SVG 문자열을 반환한다', () => {
    const svg = buildSvgOverlay('테스트 상품');
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="500"');
    expect(svg).toContain('테스트 상품');
  });

  it('특수문자를 이스케이프한다', () => {
    const svg = buildSvgOverlay('<script>xss</script>');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});
