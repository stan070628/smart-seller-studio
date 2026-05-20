import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AssetsInputPanel from '@/components/listing/assets/AssetsInputPanel';
import { useListingStore } from '@/store/useListingStore';

vi.mock('@/components/listing/assets/ConversationalDetailModal', () => ({
  default: ({ imageUrls, onClose }: { imageUrls: string[]; onClose: () => void }) => (
    <div data-testid="modal" data-image-count={String(imageUrls.length)} data-first-url={imageUrls[0] ?? ''}>
      <button onClick={onClose}>닫기</button>
    </div>
  ),
}));

describe('AssetsInputPanel', () => {
  it('URL/직접 업로드 모드 토글이 동작한다', () => {
    useListingStore.getState().resetAssetsDraft();
    render(<AssetsInputPanel onGenerate={() => {}} />);
    expect(screen.getByRole('radio', { name: /URL/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /직접 업로드/ }));
    expect(useListingStore.getState().assetsDraft.mode).toBe('upload');
  });

  it('URL 모드에서 빈 입력은 생성 버튼이 비활성화된다', () => {
    useListingStore.getState().updateAssetsDraft({ mode: 'url', url: '' });
    render(<AssetsInputPanel onGenerate={() => {}} />);
    expect(screen.getByRole('button', { name: /빠른 생성/ })).toBeDisabled();
  });

  it('ConversationalDetailModal에 detailFiles만 전달된다 (thumbnailFiles 제외)', async () => {
    const store = useListingStore.getState();
    store.resetAssetsDraft();
    store.updateAssetsDraft({
      mode: 'upload',
      thumbnailFiles: ['https://example.com/thumb1.jpg'],
      detailFiles: ['https://example.com/detail1.jpg', 'https://example.com/detail2.jpg'],
      category: 'basic',
    });
    store.updateSharedDraft({ name: '테스트 상품' });

    render(<AssetsInputPanel onGenerate={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /대화로 만들기/ }));

    const modal = await waitFor(() => screen.getByTestId('modal'));
    expect(modal.dataset.imageCount).toBe('2');
    expect(modal.dataset.firstUrl).toBe('https://example.com/detail1.jpg');
  });

  it('detailFiles가 없고 thumbnailFiles만 있으면 대화로 만들기 버튼이 비활성화된다', () => {
    const store = useListingStore.getState();
    store.resetAssetsDraft();
    store.updateAssetsDraft({
      mode: 'upload',
      thumbnailFiles: ['https://example.com/thumb1.jpg'],
      detailFiles: [],
      category: 'basic',
    });
    store.updateSharedDraft({ name: '테스트 상품' });

    render(<AssetsInputPanel onGenerate={() => {}} />);
    expect(screen.getByRole('button', { name: /대화로 만들기/ })).toBeDisabled();
  });
});
