import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DetailMakerThumbnailGallery from '@/components/listing/detail-maker/DetailMakerThumbnailGallery';

const base = {
  thumbnails: ['https://x/1.jpg', 'https://x/2.jpg'],
  editingUrl: null as string | null,
  onDownload: vi.fn(),
  onRemove: vi.fn(),
  onEdit: vi.fn(),
};

describe('DetailMakerThumbnailGallery', () => {
  it('썸네일 개수만큼 이미지를 렌더한다', () => {
    render(<DetailMakerThumbnailGallery {...base} />);
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });

  it('다운로드 버튼 클릭 시 onDownload(url) 호출', () => {
    const onDownload = vi.fn();
    render(<DetailMakerThumbnailGallery {...base} onDownload={onDownload} />);
    fireEvent.click(screen.getAllByRole('button', { name: /다운로드/ })[0]);
    expect(onDownload).toHaveBeenCalledWith('https://x/1.jpg');
  });

  it('삭제 버튼 클릭 시 onRemove(url) 호출', () => {
    const onRemove = vi.fn();
    render(<DetailMakerThumbnailGallery {...base} onRemove={onRemove} />);
    fireEvent.click(screen.getAllByRole('button', { name: /삭제/ })[0]);
    expect(onRemove).toHaveBeenCalledWith('https://x/1.jpg');
  });

  it('AI 수정 → 프롬프트 입력 → 적용 시 onEdit(url, prompt) 호출', () => {
    const onEdit = vi.fn();
    render(<DetailMakerThumbnailGallery {...base} onEdit={onEdit} />);
    fireEvent.click(screen.getAllByRole('button', { name: /AI 수정/ })[0]);
    fireEvent.change(screen.getByPlaceholderText(/수정/), { target: { value: '배경 밝게' } });
    fireEvent.click(screen.getByRole('button', { name: /적용/ }));
    expect(onEdit).toHaveBeenCalledWith('https://x/1.jpg', '배경 밝게');
  });

  it('editingUrl인 항목은 수정 중 표시를 보여준다', () => {
    render(<DetailMakerThumbnailGallery {...base} editingUrl="https://x/1.jpg" />);
    expect(screen.getByText(/수정 중/)).toBeInTheDocument();
  });
});
