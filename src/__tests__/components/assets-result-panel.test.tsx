import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AssetsResultPanel from '@/components/listing/assets/AssetsResultPanel';
import { useListingStore } from '@/store/useListingStore';

describe('AssetsResultPanel', () => {
  it('생성 결과가 없으면 안내문을 표시한다', () => {
    useListingStore.getState().resetAssetsDraft();
    render(<AssetsResultPanel />);
    expect(screen.getByText(/자산을 먼저 생성/)).toBeInTheDocument();
  });

  it('썸네일과 상세 HTML이 있으면 미리보기와 액션이 노출된다', () => {
    useListingStore.getState().updateAssetsDraft({
      generatedThumbnails: ['data:image/png;base64,xxx'],
      generatedDetailHtml: '<div>x</div>',
    });
    render(<AssetsResultPanel />);
    expect(screen.getByRole('button', { name: /ZIP 다운로드/ })).toBeInTheDocument();
  });
});
