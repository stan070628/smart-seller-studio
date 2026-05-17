/**
 * AiEditModal — detail 컨텍스트의 텍스트·표 그룹 칩 분기 테스트.
 *
 * 검증: 텍스트 칩 클릭 후 실행 시 /api/ai/edit-image-text로 라우팅되고,
 *      시각 분위기 칩 클릭 후 실행 시 /api/ai/edit-thumbnail로 라우팅된다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import AiEditModal from '@/components/listing/AiEditModal';
import { server } from '../mocks/server';

const baseProps = {
  imageUrl: 'https://example.com/orig.jpg',
  imageFile: null,
  onClose: vi.fn(),
  onSave: vi.fn(),
};

describe('AiEditModal — detail 컨텍스트 텍스트 그룹 분기', () => {
  const editThumbnailSpy = vi.fn();
  const editImageTextSpy = vi.fn();

  beforeEach(() => {
    editThumbnailSpy.mockReset();
    editImageTextSpy.mockReset();
    server.use(
      http.post('/api/ai/edit-thumbnail', async ({ request }) => {
        editThumbnailSpy(await request.json());
        return HttpResponse.json({ success: true, data: { editedUrl: 'https://x.com/edited-visual.jpg' } });
      }),
      http.post('/api/ai/edit-image-text', async ({ request }) => {
        editImageTextSpy(await request.json());
        return HttpResponse.json({ success: true, data: { editedUrl: 'https://x.com/edited-text.jpg' } });
      }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('detail 컨텍스트에서 시각 분위기 + 텍스트·표 두 그룹이 모두 렌더된다', () => {
    render(<AiEditModal {...baseProps} context="detail" />);
    expect(screen.getByText(/시각 분위기/)).toBeInTheDocument();
    expect(screen.getByText(/텍스트·표/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /스튜디오 컷/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /강조\/가독성/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /자동 다듬기/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /표 데이터 수정/ })).toBeInTheDocument();
  });

  it('텍스트·표 그룹 칩 클릭 후 실행 시 /api/ai/edit-image-text로 라우팅', async () => {
    render(<AiEditModal {...baseProps} context="detail" />);

    fireEvent.click(screen.getByRole('button', { name: /자동 다듬기/ }));
    fireEvent.click(screen.getByRole('button', { name: /AI 편집 실행/ }));

    await waitFor(() => {
      expect(editImageTextSpy).toHaveBeenCalledTimes(1);
    });
    expect(editThumbnailSpy).not.toHaveBeenCalled();
    const body = editImageTextSpy.mock.calls[0][0];
    expect(body.imageUrl).toBe('https://example.com/orig.jpg');
    expect(body.instruction).toContain('자연스럽게 다듬');
  });

  it('시각 분위기 그룹 칩 클릭 후 실행 시 /api/ai/edit-thumbnail로 라우팅', async () => {
    render(<AiEditModal {...baseProps} context="detail" />);

    fireEvent.click(screen.getByRole('button', { name: /라이프스타일/ }));
    fireEvent.click(screen.getByRole('button', { name: /AI 편집 실행/ }));

    await waitFor(() => {
      expect(editThumbnailSpy).toHaveBeenCalledTimes(1);
    });
    expect(editImageTextSpy).not.toHaveBeenCalled();
    const body = editThumbnailSpy.mock.calls[0][0];
    expect(body.applyCoupangPolicy).toBe(false);
  });

  it('thumbnail 컨텍스트에서는 두 그룹이 보이지 않고 평면 칩만 렌더', () => {
    render(<AiEditModal {...baseProps} context="thumbnail" />);
    expect(screen.queryByText(/시각 분위기/)).not.toBeInTheDocument();
    expect(screen.queryByText(/텍스트·표/)).not.toBeInTheDocument();
    expect(screen.getByText(/빠른 선택/)).toBeInTheDocument();
  });

  it('detail 컨텍스트 + merge 모드에서는 두 그룹이 보이지 않음 (병합은 단일 이미지가 아님)', () => {
    render(
      <AiEditModal
        {...baseProps}
        imageUrl2="https://example.com/orig2.jpg"
        context="detail"
      />,
    );
    expect(screen.queryByText(/시각 분위기$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/텍스트·표/)).not.toBeInTheDocument();
    expect(screen.getByText(/빠른 선택/)).toBeInTheDocument();
  });
});
