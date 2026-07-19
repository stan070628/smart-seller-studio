import { describe, it, expect } from 'vitest';
import { renderSection } from '@/lib/detail-page/section-renderer';
import type { DetailSection, DetailPageTheme } from '@/types/detail-page';

const theme: DetailPageTheme = {
  palette: 'warm_cream', primaryColor: '#111111', accentColor: '#6366f1',
  fontStyle: 'sans', imageLayout: 'composed',
};

function ytSection(overrides: Record<string, unknown> = {}): DetailSection {
  return {
    id: 'y1', type: 'youtube', order: 0, attachedImages: [],
    content: { type: 'youtube', url: 'https://youtu.be/abc12345678', videoId: 'abc12345678', aspect: 'horizontal', enabled: true, ...overrides },
  } as DetailSection;
}

describe('renderYoutube', () => {
  it('preview 모드 → iframe embed', () => {
    const html = renderSection(ytSection(), theme, 'preview');
    expect(html).toContain('<iframe');
    expect(html).toContain('youtube.com/embed/abc12345678');
  });
  it('export 모드 → 썸네일 img + 링크 (iframe 없음)', () => {
    const html = renderSection(ytSection({ exportThumbnailUrl: 'https://cdn.example.com/t.jpg' }), theme, 'export');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('https://cdn.example.com/t.jpg');
    expect(html).toContain('href="https://youtu.be/abc12345678"');
  });
  it('enabled=false → 빈 문자열', () => {
    expect(renderSection(ytSection({ enabled: false }), theme, 'preview').trim()).toBe('');
  });
  it('videoId 없음 → 빈 문자열', () => {
    expect(renderSection(ytSection({ videoId: '' }), theme, 'preview').trim()).toBe('');
  });
  it('세로(shorts) preview → 9:16 컨테이너', () => {
    const html = renderSection(ytSection({ aspect: 'vertical' }), theme, 'preview');
    expect(html).toContain('9 / 16');
  });
  it('caption 렌더링', () => {
    const html = renderSection(ytSection({ caption: '동영상제공:유투버varoachi' }), theme, 'preview');
    expect(html).toContain('동영상제공:유투버varoachi');
  });
  it('caption escape 처리', () => {
    const html = renderSection(ytSection({ caption: '<script>x</script>' }), theme, 'preview');
    expect(html).not.toContain('<script>x</script>');
  });
  it('javascript: href 무력화', () => {
    const html = renderSection(ytSection({ url: 'javascript:alert(1)' }), theme, 'export');
    expect(html).not.toContain('javascript:alert');
  });
  it('malformed videoId → 빈 문자열', () => {
    const html = renderSection(ytSection({ videoId: '"><img src=x onerror=y>' }), theme, 'preview');
    expect(html.trim()).toBe('');
  });
  it('sectionAttrs 로 data-section-id 부여', () => {
    const html = renderSection(ytSection(), theme, 'preview');
    expect(html).toContain('data-section-id="y1"');
  });
});
