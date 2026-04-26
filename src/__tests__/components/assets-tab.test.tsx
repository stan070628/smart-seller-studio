import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import AssetsTab from '@/components/listing/assets/AssetsTab';
import { useListingStore } from '@/store/useListingStore';
import { server } from '../mocks/server';

// generate API 호출 여부를 추적하기 위한 spy
const generateSpy = vi.fn();

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

  it('자산 생성 버튼 클릭 시 generate API를 호출하고 결과를 store에 반영한다', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: /자산 생성/ }));

    await waitFor(() => {
      expect(useListingStore.getState().assetsDraft.generatedThumbnails).toEqual(['t1.png']);
    });

    // generate API가 실제로 호출되었는지 확인
    expect(generateSpy).toHaveBeenCalledTimes(1);
    expect(generateSpy.mock.calls[0][0]).toContain('/api/listing/assets/generate');
  });
});
