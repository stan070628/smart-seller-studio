import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AssetsInputPanel from '@/components/listing/assets/AssetsInputPanel';
import { useListingStore } from '@/store/useListingStore';

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
    expect(screen.getByRole('button', { name: /자산 생성/ })).toBeDisabled();
  });
});
