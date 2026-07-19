import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import YoutubeEditor from '@/components/listing/detail-editor/YoutubeEditor';
import type { DetailSection, YoutubeContent } from '@/types/detail-page';

function makeSection(content: Partial<YoutubeContent> = {}): DetailSection {
  return {
    id: 'sec-1',
    type: 'youtube',
    content: {
      type: 'youtube',
      url: '',
      videoId: '',
      aspect: 'horizontal',
      enabled: true,
      ...content,
    },
    attachedImages: [],
  };
}

describe('YoutubeEditor — URL 파싱', () => {
  it('유효한 Shorts URL 입력 시 videoId·aspect(vertical)로 onUpdate 호출', () => {
    const onUpdate = vi.fn();
    render(<YoutubeEditor section={makeSection()} onUpdate={onUpdate} />);
    const url = 'https://youtube.com/shorts/abcDEF12345';
    fireEvent.change(screen.getByPlaceholderText(/youtu\.be/), { target: { value: url } });
    expect(onUpdate).toHaveBeenCalledWith({ url, videoId: 'abcDEF12345', aspect: 'vertical' });
  });

  it('유효한 일반 watch URL 입력 시 aspect(horizontal)로 onUpdate 호출', () => {
    const onUpdate = vi.fn();
    render(<YoutubeEditor section={makeSection()} onUpdate={onUpdate} />);
    const url = 'https://www.youtube.com/watch?v=abcDEF12345';
    fireEvent.change(screen.getByPlaceholderText(/youtu\.be/), { target: { value: url } });
    expect(onUpdate).toHaveBeenCalledWith({ url, videoId: 'abcDEF12345', aspect: 'horizontal' });
  });

  it('잘못된 URL 입력 시 videoId 빈 문자열로 onUpdate 호출 + 에러 문구 표시', () => {
    const onUpdate = vi.fn();
    render(<YoutubeEditor section={makeSection()} onUpdate={onUpdate} />);
    const url = 'not-a-valid-url';
    fireEvent.change(screen.getByPlaceholderText(/youtu\.be/), { target: { value: url } });
    expect(onUpdate).toHaveBeenCalledWith({ url, videoId: '' });
    expect(screen.getByText('유튜브 URL을 확인해주세요.')).toBeInTheDocument();
  });

  it('입력값이 비면 url·videoId 모두 빈 문자열로 onUpdate 호출, 에러 문구 없음', () => {
    const onUpdate = vi.fn();
    render(
      <YoutubeEditor
        section={makeSection({ url: 'https://youtu.be/abcDEF12345', videoId: 'abcDEF12345' })}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/youtu\.be/), { target: { value: '' } });
    expect(onUpdate).toHaveBeenCalledWith({ url: '', videoId: '' });
    expect(screen.queryByText('유튜브 URL을 확인해주세요.')).not.toBeInTheDocument();
  });

  it('동일 videoId 재입력 시 aspect를 페이로드에 포함하지 않는다 (수동 토글 보존)', () => {
    const onUpdate = vi.fn();
    render(
      <YoutubeEditor
        section={makeSection({
          url: 'https://youtu.be/abcDEF12345',
          videoId: 'abcDEF12345',
          aspect: 'vertical', // 사용자가 수동으로 세로로 토글해둔 상태
        })}
        onUpdate={onUpdate}
      />,
    );
    const url = 'https://youtu.be/abcDEF12345 '; // 같은 videoId, 사소한 편집(끝 공백)
    fireEvent.change(screen.getByPlaceholderText(/youtu\.be/), { target: { value: url } });
    expect(onUpdate).toHaveBeenCalledWith({ url, videoId: 'abcDEF12345' });
  });
});
