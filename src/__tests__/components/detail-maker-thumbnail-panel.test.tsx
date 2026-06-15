import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DetailMakerThumbnailPanel from '@/components/listing/detail-maker/DetailMakerThumbnailPanel';

const base = {
  refImageUrls: ['https://x/a.jpg'],
  isGenerating: false,
  error: null as string | null,
  onGenerate: vi.fn(),
};

describe('DetailMakerThumbnailPanel', () => {
  it('참조 이미지가 없으면 생성 버튼이 비활성이다', () => {
    render(<DetailMakerThumbnailPanel {...base} refImageUrls={[]} onGenerate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /AI 썸네일 생성/ })).toBeDisabled();
  });

  it('연출 방향이 5자 미만이면 버튼이 비활성이다', () => {
    render(<DetailMakerThumbnailPanel {...base} onGenerate={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/연출/), { target: { value: '짧음' } });
    expect(screen.getByRole('button', { name: /AI 썸네일 생성/ })).toBeDisabled();
  });

  it('참조 1장 + 방향 5자 이상이면 클릭 시 onGenerate(direction) 호출', () => {
    const onGenerate = vi.fn();
    render(<DetailMakerThumbnailPanel {...base} onGenerate={onGenerate} />);
    fireEvent.change(screen.getByPlaceholderText(/연출/), { target: { value: '화이트 스튜디오 배경' } });
    fireEvent.click(screen.getByRole('button', { name: /AI 썸네일 생성/ }));
    expect(onGenerate).toHaveBeenCalledWith('화이트 스튜디오 배경');
  });

  it('예시 칩 클릭 시 연출 방향 입력이 채워진다', () => {
    render(<DetailMakerThumbnailPanel {...base} onGenerate={vi.fn()} />);
    fireEvent.click(screen.getByText('화이트 스튜디오 배경, 조명 강조'));
    expect(screen.getByDisplayValue('화이트 스튜디오 배경, 조명 강조')).toBeInTheDocument();
  });
});
