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
    render(<AssetsInputPanel onGenerate={() => {}} onAnalyze={() => {}} />);
    expect(screen.getByRole('radio', { name: /URL/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /직접 업로드/ }));
    expect(useListingStore.getState().assetsDraft.mode).toBe('upload');
  });

  it('URL 모드에서 빈 입력은 생성 버튼이 비활성화된다', () => {
    useListingStore.getState().updateAssetsDraft({ mode: 'url', url: '' });
    render(<AssetsInputPanel onGenerate={() => {}} onAnalyze={() => {}} />);
    expect(screen.getByRole('button', { name: /자동 생성/ })).toBeDisabled();
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

    render(<AssetsInputPanel onGenerate={() => {}} onAnalyze={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /AI와 함께 만들기/ }));

    const modal = await waitFor(() => screen.getByTestId('modal'));
    expect(modal.dataset.imageCount).toBe('2');
    expect(modal.dataset.firstUrl).toBe('https://example.com/detail1.jpg');
  });

  it('detailFiles가 없고 thumbnailFiles만 있어도 AI와 함께 만들기 버튼이 활성화된다', () => {
    const store = useListingStore.getState();
    store.resetAssetsDraft();
    store.updateAssetsDraft({
      mode: 'upload',
      thumbnailFiles: ['https://example.com/thumb1.jpg'],
      detailFiles: [],
      category: 'basic',
    });
    store.updateSharedDraft({ name: '테스트 상품' });

    render(<AssetsInputPanel onGenerate={() => {}} onAnalyze={() => {}} />);
    expect(screen.getByRole('button', { name: /AI와 함께 만들기/ })).not.toBeDisabled();
  });

  it('detailFiles가 없으면 ConversationalDetailModal에 thumbnailFiles가 폴백으로 전달된다', async () => {
    const store = useListingStore.getState();
    store.resetAssetsDraft();
    store.updateAssetsDraft({
      mode: 'upload',
      thumbnailFiles: ['https://example.com/thumb1.jpg'],
      detailFiles: [],
      category: 'basic',
    });
    store.updateSharedDraft({ name: '테스트 상품' });

    render(<AssetsInputPanel onGenerate={() => {}} onAnalyze={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /AI와 함께 만들기/ }));

    const modal = await waitFor(() => screen.getByTestId('modal'));
    expect(modal.dataset.imageCount).toBe('1');
    expect(modal.dataset.firstUrl).toBe('https://example.com/thumb1.jpg');
  });

  it('URL 모드에서 카테고리 선택 전에는 "AI와 함께 만들기" 버튼이 비활성화된다', () => {
    const store = useListingStore.getState();
    store.resetAssetsDraft();
    store.updateAssetsDraft({ mode: 'url', url: 'https://example.com/product', category: null });
    store.updateSharedDraft({ name: '테스트 상품' });

    render(<AssetsInputPanel onGenerate={() => {}} onAnalyze={() => {}} />);
    expect(screen.getByRole('button', { name: /AI와 함께 만들기/ })).toBeDisabled();
  });

  it('URL 모드에서 URL + 카테고리 입력 시 "AI와 함께 만들기" 버튼이 활성화된다', () => {
    const store = useListingStore.getState();
    store.resetAssetsDraft();
    store.updateAssetsDraft({ mode: 'url', url: 'https://example.com/product', category: 'basic' });
    store.updateSharedDraft({ name: '테스트 상품' });

    render(<AssetsInputPanel onGenerate={() => {}} onAnalyze={() => {}} />);
    expect(screen.getByRole('button', { name: /AI와 함께 만들기/ })).not.toBeDisabled();
  });

  it('이미지가 업로드된 슬롯에 다운로드 버튼(↓)이 렌더링된다', () => {
    const store = useListingStore.getState();
    store.resetAssetsDraft();
    store.updateAssetsDraft({
      mode: 'upload',
      thumbnailFiles: ['https://example.com/thumb1.jpg'],
      detailFiles: [],
    });

    render(<AssetsInputPanel onGenerate={() => {}} onAnalyze={() => {}} />);
    // 업로드된 이미지가 있을 때 다운로드 버튼이 렌더링되어야 한다
    expect(screen.getAllByRole('button', { name: /이미지 다운로드/ })).toHaveLength(1);
  });

  it('이미지가 여러 장 업로드된 경우 각 슬롯마다 다운로드 버튼이 렌더링된다', () => {
    const store = useListingStore.getState();
    store.resetAssetsDraft();
    store.updateAssetsDraft({
      mode: 'upload',
      thumbnailFiles: ['https://example.com/thumb1.jpg', 'https://example.com/thumb2.jpg'],
      detailFiles: ['https://example.com/detail1.jpg'],
    });

    render(<AssetsInputPanel onGenerate={() => {}} onAnalyze={() => {}} />);
    // 썸네일 2장 + 상세 1장 = 다운로드 버튼 총 3개
    expect(screen.getAllByRole('button', { name: /이미지 다운로드/ })).toHaveLength(3);
  });

  it('빈 슬롯(이미지 없음)에는 다운로드 버튼이 없다', () => {
    const store = useListingStore.getState();
    store.resetAssetsDraft();
    store.updateAssetsDraft({
      mode: 'upload',
      thumbnailFiles: [],
      detailFiles: [],
    });

    render(<AssetsInputPanel onGenerate={() => {}} onAnalyze={() => {}} />);
    expect(screen.queryAllByRole('button', { name: /이미지 다운로드/ })).toHaveLength(0);
  });
});
