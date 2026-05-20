import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import AssetsResultPanel from '@/components/listing/assets/AssetsResultPanel';
import { useListingStore } from '@/store/useListingStore';
import type { DetailSection } from '@/types/detail-page';

const makeSection = (): DetailSection => ({
  id: 'sec-1',
  type: 'hero',
  order: 0,
  content: { headline: '타이틀', subheadline: '서브타이틀' },
  attachedImages: [],
});

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

  it('detailPageSections가 빈 상태에서 채워지면 /api/detail-page/render를 호출한다', async () => {
    let renderCalled = false;
    server.use(
      http.post('/api/detail-page/render', () => {
        renderCalled = true;
        return HttpResponse.json({ html: '<div data-edit-path="content.headline">타이틀</div>' });
      }),
    );

    const store = useListingStore.getState();
    store.resetAssetsDraft();
    store.updateAssetsDraft({
      generatedThumbnails: ['https://example.com/t.jpg'],
      generatedDetailHtml: '<div>초기 HTML</div>',
      detailPageSections: [],
    });

    render(<AssetsResultPanel />);

    await act(async () => {
      store.updateAssetsDraft({ detailPageSections: [makeSection()] });
    });

    expect(renderCalled).toBe(true);
  });

  it('이미 sections가 있는 상태에서 추가 변경이 생겨도 render를 재호출하지 않는다', async () => {
    let renderCallCount = 0;
    server.use(
      http.post('/api/detail-page/render', () => {
        renderCallCount++;
        return HttpResponse.json({ html: '<div>ok</div>' });
      }),
    );

    const store = useListingStore.getState();
    store.resetAssetsDraft();
    store.updateAssetsDraft({
      generatedThumbnails: ['https://example.com/t.jpg'],
      generatedDetailHtml: '<div>기존 HTML</div>',
      detailPageSections: [makeSection()],
    });

    render(<AssetsResultPanel />);

    await act(async () => {
      store.updateAssetsDraft({
        detailPageSections: [makeSection(), { ...makeSection(), id: 'sec-2', order: 1 }],
      });
    });

    expect(renderCallCount).toBe(0);
  });
});
