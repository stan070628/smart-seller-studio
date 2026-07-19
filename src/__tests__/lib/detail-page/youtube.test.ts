import { describe, it, expect } from 'vitest';
import { parseYoutubeUrl } from '@/lib/detail-page/youtube';

describe('parseYoutubeUrl', () => {
  it('youtu.be 단축 URL → 가로', () => {
    expect(parseYoutubeUrl('https://youtu.be/dQw4w9WgXcQ')).toEqual({ videoId: 'dQw4w9WgXcQ', aspect: 'horizontal' });
  });
  it('watch?v= URL → 가로', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s')).toEqual({ videoId: 'dQw4w9WgXcQ', aspect: 'horizontal' });
  });
  it('shorts URL → 세로', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toEqual({ videoId: 'dQw4w9WgXcQ', aspect: 'vertical' });
  });
  it('embed URL → 가로', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toEqual({ videoId: 'dQw4w9WgXcQ', aspect: 'horizontal' });
  });
  it('유효하지 않은 URL → null', () => {
    expect(parseYoutubeUrl('https://example.com/video')).toBeNull();
    expect(parseYoutubeUrl('그냥 텍스트')).toBeNull();
  });
});
