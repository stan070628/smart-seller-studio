import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageWithToggle } from '@/components/listing/import1688/ResultPreview';

describe('ImageWithToggle', () => {
  it('translatedUrl이 있으면 디폴트로 한국어 이미지를 보여준다', () => {
    render(
      <ImageWithToggle
        originalUrl="https://orig/x.jpg"
        translatedUrl="https://cdn/x.jpg"
        alt="t"
      />
    );
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.src).toBe('https://cdn/x.jpg');
  });

  it('토글 클릭 시 src가 원본으로 바뀐다', () => {
    render(
      <ImageWithToggle
        originalUrl="https://orig/x.jpg"
        translatedUrl="https://cdn/x.jpg"
        alt="t"
      />
    );
    fireEvent.click(screen.getByRole('button'));
    const img = screen.getByRole('img') as HTMLImageElement;
    expect(img.src).toBe('https://orig/x.jpg');
  });

  it('translatedUrl이 null이면 토글 버튼이 없다', () => {
    render(
      <ImageWithToggle originalUrl="https://orig/y.jpg" translatedUrl={null} alt="t" />
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
