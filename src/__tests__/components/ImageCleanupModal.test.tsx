import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImageCleanupModal from '@/components/common/ImageCleanupModal';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const SUPABASE_URL = 'https://abcdef.supabase.co/storage/v1/test.jpg';
const FAKE_BASE64 = 'abc123==';

function makeGeminiOk() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ imageBase64: FAKE_BASE64, mimeType: 'image/jpeg' }),
  });
}
function makeUploadOk(url = 'https://abcdef.supabase.co/storage/v1/result.jpg') {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true, url }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ImageCleanupModal', () => {
  it('select 단계: 이미지와 "제거 실행" 버튼 렌더링', () => {
    render(
      <ImageCleanupModal
        imageUrl={SUPABASE_URL}
        onReplace={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        canAdd={true}
      />,
    );
    expect(screen.getByAltText('원본 이미지')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '제거 실행' })).toBeDisabled();
  });

  it('충분한 드래그 후 "제거 실행" 버튼 활성화', () => {
    render(
      <ImageCleanupModal
        imageUrl={SUPABASE_URL}
        onReplace={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        canAdd={true}
      />,
    );
    const img = screen.getByAltText('원본 이미지');
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 200, height: 200,
      right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    });

    fireEvent.mouseDown(img, { clientX: 20, clientY: 20 });
    fireEvent.mouseMove(img, { clientX: 80, clientY: 80 });
    fireEvent.mouseUp(img);

    expect(screen.getByRole('button', { name: '제거 실행' })).toBeEnabled();
  });

  it('너무 작은 드래그(< 2%) — 버튼 비활성', () => {
    render(
      <ImageCleanupModal
        imageUrl={SUPABASE_URL}
        onReplace={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        canAdd={true}
      />,
    );
    const img = screen.getByAltText('원본 이미지');
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 200, height: 200,
      right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    });

    fireEvent.mouseDown(img, { clientX: 20, clientY: 20 });
    fireEvent.mouseMove(img, { clientX: 22, clientY: 22 });
    fireEvent.mouseUp(img);

    expect(screen.getByRole('button', { name: '제거 실행' })).toBeDisabled();
  });

  it('[제거 실행] → processing → preview 단계 전환', async () => {
    makeGeminiOk();
    render(
      <ImageCleanupModal
        imageUrl={SUPABASE_URL}
        onReplace={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        canAdd={true}
      />,
    );
    const img = screen.getByAltText('원본 이미지');
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 200, height: 200,
      right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.mouseDown(img, { clientX: 20, clientY: 20 });
    fireEvent.mouseMove(img, { clientX: 80, clientY: 80 });
    fireEvent.mouseUp(img);

    fireEvent.click(screen.getByRole('button', { name: '제거 실행' }));
    await waitFor(() => expect(screen.getByText('정리됨')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '교체' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새로 추가' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 실행' })).toBeInTheDocument();
  });

  it('[교체] → upload-ai 호출 후 onReplace(url) 호출', async () => {
    makeGeminiOk();
    const onReplace = vi.fn();
    const RESULT_URL = 'https://abcdef.supabase.co/storage/v1/result.jpg';
    makeUploadOk(RESULT_URL);

    render(
      <ImageCleanupModal
        imageUrl={SUPABASE_URL}
        onReplace={onReplace}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        canAdd={true}
      />,
    );

    const img = screen.getByAltText('원본 이미지');
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 200, height: 200,
      right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.mouseDown(img, { clientX: 20, clientY: 20 });
    fireEvent.mouseMove(img, { clientX: 80, clientY: 80 });
    fireEvent.mouseUp(img);
    fireEvent.click(screen.getByRole('button', { name: '제거 실행' }));
    await waitFor(() => screen.getByRole('button', { name: '교체' }));

    fireEvent.click(screen.getByRole('button', { name: '교체' }));
    await waitFor(() => expect(onReplace).toHaveBeenCalledWith(RESULT_URL));
  });

  it('[새로 추가] — canAdd=false이면 비활성화', async () => {
    makeGeminiOk();
    render(
      <ImageCleanupModal
        imageUrl={SUPABASE_URL}
        onReplace={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        canAdd={false}
      />,
    );
    const img = screen.getByAltText('원본 이미지');
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 200, height: 200,
      right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.mouseDown(img, { clientX: 20, clientY: 20 });
    fireEvent.mouseMove(img, { clientX: 80, clientY: 80 });
    fireEvent.mouseUp(img);
    fireEvent.click(screen.getByRole('button', { name: '제거 실행' }));
    await waitFor(() => screen.getByRole('button', { name: '새로 추가' }));

    expect(screen.getByRole('button', { name: '새로 추가' })).toBeDisabled();
  });

  it('[다시 실행] → select 단계로 리셋', async () => {
    makeGeminiOk();
    render(
      <ImageCleanupModal
        imageUrl={SUPABASE_URL}
        onReplace={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        canAdd={true}
      />,
    );
    const img = screen.getByAltText('원본 이미지');
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 200, height: 200,
      right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.mouseDown(img, { clientX: 20, clientY: 20 });
    fireEvent.mouseMove(img, { clientX: 80, clientY: 80 });
    fireEvent.mouseUp(img);
    fireEvent.click(screen.getByRole('button', { name: '제거 실행' }));
    await waitFor(() => screen.getByRole('button', { name: '다시 실행' }));

    fireEvent.click(screen.getByRole('button', { name: '다시 실행' }));
    expect(screen.getByAltText('원본 이미지')).toBeInTheDocument();
    expect(screen.queryByText('정리됨')).not.toBeInTheDocument();
  });

  it('API 오류 → 에러 메시지 표시 + select 단계 유지', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: '처리 중 오류가 발생했습니다.' }),
    });
    render(
      <ImageCleanupModal
        imageUrl={SUPABASE_URL}
        onReplace={vi.fn()}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        canAdd={true}
      />,
    );
    const img = screen.getByAltText('원본 이미지');
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 200, height: 200,
      right: 200, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.mouseDown(img, { clientX: 20, clientY: 20 });
    fireEvent.mouseMove(img, { clientX: 80, clientY: 80 });
    fireEvent.mouseUp(img);
    fireEvent.click(screen.getByRole('button', { name: '제거 실행' }));

    await waitFor(() =>
      expect(screen.getByText('처리 중 오류가 발생했습니다.')).toBeInTheDocument(),
    );
    expect(screen.getByAltText('원본 이미지')).toBeInTheDocument();
  });
});
