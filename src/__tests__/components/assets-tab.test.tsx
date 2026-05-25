import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import AssetsTab from '@/components/listing/assets/AssetsTab';
import { useListingStore } from '@/store/useListingStore';
import { server } from '../mocks/server';

// generate API 호출 여부를 추적하기 위한 spy
const generateSpy = vi.fn();

/** generate-detail-html API 응답에 사용할 mock content fixture (DetailPageContent 타입 준수) */
const MOCK_DETAIL_CONTENT = {
  headline: '테스트 헤드라인',
  subheadline: '테스트 서브헤드라인',
  sellingPoints: [
    { icon: '✓', title: '포인트 1', description: '설명 1' },
    { icon: '✓', title: '포인트 2', description: '설명 2' },
  ],
  features: [],
  specs: [],
  usageSteps: [],
  warnings: [],
  ctaText: '지금 구매',
};

describe('AssetsTab', () => {
  beforeEach(() => {
    generateSpy.mockReset();
    useListingStore.getState().resetAssetsDraft();
  });

  it('입력 + 결과 패널이 모두 렌더된다', () => {
    render(<AssetsTab />);
    expect(screen.getByRole('radio', { name: /URL/ })).toBeInTheDocument();
    expect(screen.getByText(/자산을 먼저 생성/)).toBeInTheDocument();
  });

  it('빠른 생성 버튼 클릭 시 generate API를 호출하고 결과를 store에 반영한다', async () => {
    // MSW 핸들러로 generate API 모킹
    server.use(
      http.post('/api/listing/assets/generate', ({ request }) => {
        generateSpy(request.url);
        return HttpResponse.json({
          success: true,
          data: { thumbnails: ['t1.png'], detailHtml: '<div></div>', detailImage: null },
        });
      }),
    );

    useListingStore.getState().updateAssetsDraft({ mode: 'url', url: 'https://x.com' });
    render(<AssetsTab />);
    fireEvent.click(screen.getByRole('button', { name: /자동 생성/ }));

    await waitFor(() => {
      expect(useListingStore.getState().assetsDraft.generatedThumbnails).toEqual(['t1.png']);
    });

    // generate API가 실제로 호출되었는지 확인
    expect(generateSpy).toHaveBeenCalledTimes(1);
    expect(generateSpy.mock.calls[0][0]).toContain('/api/listing/assets/generate');
  });
});

describe('handleGenerate - 첫 섹션 attachedImages 자동 연결', () => {
  beforeEach(() => {
    generateSpy.mockReset();
    useListingStore.getState().resetAssetsDraft();
  });

  it('업로드 모드에서 detailFiles가 첫 번째 섹션 attachedImages에 연결된다', async () => {
    // generate-detail-html API mock: content 포함 응답
    server.use(
      http.post('/api/ai/generate-detail-html', () =>
        HttpResponse.json({
          html: '<div>상세페이지</div>',
          content: MOCK_DETAIL_CONTENT,
        }),
      ),
    );

    const detailUrls = ['https://cdn.example.com/detail1.jpg', 'https://cdn.example.com/detail2.jpg'];

    // 업로드 모드 + detailFiles 설정
    useListingStore.getState().updateAssetsDraft({
      mode: 'upload',
      detailFiles: detailUrls,
      thumbnailFiles: ['https://cdn.example.com/thumb1.jpg'],
    });

    render(<AssetsTab />);
    fireEvent.click(screen.getByRole('button', { name: /자동 생성/ }));

    await waitFor(() => {
      const sections = useListingStore.getState().assetsDraft.detailPageSections;
      expect(sections.length).toBeGreaterThan(0);
    }, { timeout: 5000 });

    const sections = useListingStore.getState().assetsDraft.detailPageSections;
    // 첫 번째 섹션의 attachedImages에 detailFiles URL이 매핑되어야 한다
    expect(sections[0].attachedImages).toHaveLength(detailUrls.length);
    expect(sections[0].attachedImages[0]).toEqual({
      url: detailUrls[0],
      order: 0,
      processingMode: 'original',
    });
    expect(sections[0].attachedImages[1]).toEqual({
      url: detailUrls[1],
      order: 1,
      processingMode: 'original',
    });
    // 나머지 섹션의 attachedImages는 빈 배열이어야 한다
    if (sections.length > 1) {
      expect(sections[1].attachedImages).toEqual([]);
    }
  });

  it('업로드 모드에서 detailFiles가 없으면 thumbnailFiles가 첫 번째 섹션 attachedImages에 연결된다', async () => {
    server.use(
      http.post('/api/ai/generate-detail-html', () =>
        HttpResponse.json({
          html: '<div>상세페이지</div>',
          content: MOCK_DETAIL_CONTENT,
        }),
      ),
    );

    const thumbUrls = ['https://cdn.example.com/thumb1.jpg'];

    // detailFiles 없음 → thumbnailFiles 폴백
    useListingStore.getState().updateAssetsDraft({
      mode: 'upload',
      detailFiles: [],
      thumbnailFiles: thumbUrls,
    });

    render(<AssetsTab />);
    fireEvent.click(screen.getByRole('button', { name: /자동 생성/ }));

    await waitFor(() => {
      const sections = useListingStore.getState().assetsDraft.detailPageSections;
      expect(sections.length).toBeGreaterThan(0);
    }, { timeout: 5000 });

    const sections = useListingStore.getState().assetsDraft.detailPageSections;
    expect(sections[0].attachedImages).toHaveLength(thumbUrls.length);
    expect(sections[0].attachedImages[0]).toEqual({
      url: thumbUrls[0],
      order: 0,
      processingMode: 'original',
    });
  });

  it('URL 모드에서 AI 상세 생성 시 thumbnails가 첫 번째 섹션 attachedImages에 연결된다', async () => {
    const thumbnailUrls = ['https://cdn.example.com/scraped1.jpg', 'https://cdn.example.com/scraped2.jpg'];

    // URL 모드: /api/listing/assets/generate가 detailHtml 없이 thumbnails만 반환 → AI 상세 생성 fallback
    server.use(
      http.post('/api/listing/assets/generate', () =>
        HttpResponse.json({
          success: true,
          data: { thumbnails: thumbnailUrls, detailHtml: '' },
        }),
      ),
      http.post('/api/ai/generate-detail-html', () =>
        HttpResponse.json({
          html: '<div>상세페이지</div>',
          content: MOCK_DETAIL_CONTENT,
        }),
      ),
    );

    useListingStore.getState().updateAssetsDraft({ mode: 'url', url: 'https://supplier.com/product' });

    render(<AssetsTab />);
    fireEvent.click(screen.getByRole('button', { name: /자동 생성/ }));

    await waitFor(() => {
      const sections = useListingStore.getState().assetsDraft.detailPageSections;
      expect(sections.length).toBeGreaterThan(0);
    }, { timeout: 5000 });

    const sections = useListingStore.getState().assetsDraft.detailPageSections;
    expect(sections[0].attachedImages).toHaveLength(thumbnailUrls.length);
    expect(sections[0].attachedImages[0]).toEqual({
      url: thumbnailUrls[0],
      order: 0,
      processingMode: 'original',
    });
    expect(sections[0].attachedImages[1]).toEqual({
      url: thumbnailUrls[1],
      order: 1,
      processingMode: 'original',
    });
  });
});
