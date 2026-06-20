import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SceneEditPanel from '@/components/listing/detail-editor/SceneEditPanel';
import type { DetailSection } from '@/types/detail-page';

const sectionNoImage: DetailSection = {
  id: 'sec-1',
  type: 'hero',
  content: { type: 'hero', headline: '강력한 성능', subheadline: '최고의 선택' },
  attachedImages: [],
};

const sectionWithImage: DetailSection = {
  id: 'sec-2',
  type: 'point',
  content: { type: 'point', headline: '슬림 디자인', subheadline: '가볍게', pointLabel: null },
  attachedImages: [{ url: 'https://example.supabase.co/img/scene.jpg', order: 0, processingMode: 'original' }],
};

const baseProps = {
  uploadedUrls: ['https://example.supabase.co/img/a.jpg', 'https://example.supabase.co/img/b.jpg'],
  isEditing: false,
  error: null,
  onEdit: vi.fn().mockResolvedValue(undefined),
  onUndo: vi.fn(),
  onClose: vi.fn(),
};

describe('SceneEditPanel — 이미지 없을 때', () => {
  it('안내 배너를 표시한다', () => {
    render(<SceneEditPanel {...baseProps} section={sectionNoImage} />);
    expect(screen.getByText(/아직 생성된 이미지가 없어요/)).toBeInTheDocument();
  });

  it('현재 이미지 미리보기가 없다', () => {
    render(<SceneEditPanel {...baseProps} section={sectionNoImage} />);
    expect(screen.queryByAltText('현재 씬 이미지')).not.toBeInTheDocument();
  });

  it('"새로 생성" 버튼 텍스트가 노출된다', () => {
    render(<SceneEditPanel {...baseProps} section={sectionNoImage} />);
    expect(screen.getByRole('button', { name: /씬 이미지 새로 생성/ })).toBeInTheDocument();
  });
});

describe('SceneEditPanel — 이미지 있을 때', () => {
  it('현재 이미지 썸네일을 표시한다', () => {
    render(<SceneEditPanel {...baseProps} section={sectionWithImage} />);
    expect(screen.getByAltText('현재 씬 이미지')).toBeInTheDocument();
  });

  it('"수정 재생성" 버튼 텍스트가 노출된다', () => {
    render(<SceneEditPanel {...baseProps} section={sectionWithImage} />);
    expect(screen.getByRole('button', { name: /이미지 수정 재생성/ })).toBeInTheDocument();
  });

  it('prevSceneUrl이 있으면 되돌리기 버튼이 노출된다', () => {
    render(
      <SceneEditPanel
        {...baseProps}
        section={sectionWithImage}
        prevSceneUrl="https://example.supabase.co/img/prev.jpg"
      />,
    );
    expect(screen.getByRole('button', { name: /되돌리기/ })).toBeInTheDocument();
  });

  it('prevSceneUrl이 없으면 되돌리기 버튼이 없다', () => {
    render(<SceneEditPanel {...baseProps} section={sectionWithImage} />);
    expect(screen.queryByRole('button', { name: /되돌리기/ })).not.toBeInTheDocument();
  });
});

describe('SceneEditPanel — 레퍼런스 이미지', () => {
  it('"참고 이미지에서" 버튼 클릭 시 이미지 그리드가 표시된다', () => {
    render(<SceneEditPanel {...baseProps} section={sectionNoImage} />);
    fireEvent.click(screen.getByRole('button', { name: /참고 이미지에서/ }));
    const imgs = screen.getAllByRole('img');
    expect(imgs.length).toBeGreaterThanOrEqual(2);
  });

  it('이미지 선택 시 선택 카운트가 증가한다', () => {
    render(<SceneEditPanel {...baseProps} section={sectionNoImage} />);
    fireEvent.click(screen.getByRole('button', { name: /참고 이미지에서/ }));
    const imgs = screen.getAllByRole('img');
    fireEvent.click(imgs[0]);
    expect(screen.getByText(/1\/2/)).toBeInTheDocument();
  });

  it('최대 2장 초과 선택이 불가하다', () => {
    render(
      <SceneEditPanel
        {...baseProps}
        section={sectionNoImage}
        uploadedUrls={[
          'https://example.supabase.co/img/a.jpg',
          'https://example.supabase.co/img/b.jpg',
          'https://example.supabase.co/img/c.jpg',
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /참고 이미지에서/ }));
    const imgs = screen.getAllByRole('img');
    fireEvent.click(imgs[0]);
    fireEvent.click(imgs[1]);
    fireEvent.click(imgs[2]);
    expect(screen.getByText(/2\/2/)).toBeInTheDocument();
  });
});

describe('SceneEditPanel — 제출', () => {
  it('제출 버튼 클릭 시 onEdit이 instruction과 referenceImageUrls로 호출된다', async () => {
    const onEdit = vi.fn().mockResolvedValue(undefined);
    render(<SceneEditPanel {...baseProps} section={sectionNoImage} onEdit={onEdit} />);

    fireEvent.change(screen.getByPlaceholderText(/밝고 화사한/), {
      target: { value: '야외 카페 분위기' },
    });
    fireEvent.click(screen.getByRole('button', { name: /씬 이미지 새로 생성/ }));

    await waitFor(() => {
      expect(onEdit).toHaveBeenCalledWith({
        instruction: '야외 카페 분위기',
        referenceImageUrls: [],
      });
    });
  });

  it('isEditing=true이면 제출 버튼이 disabled 상태다', () => {
    render(<SceneEditPanel {...baseProps} section={sectionNoImage} isEditing={true} />);
    expect(screen.getByRole('button', { name: /생성 중/ })).toBeDisabled();
  });

  it('error prop이 있으면 에러 메시지를 표시한다', () => {
    render(
      <SceneEditPanel {...baseProps} section={sectionNoImage} error="씬 이미지 생성에 실패했습니다." />,
    );
    expect(screen.getByText('씬 이미지 생성에 실패했습니다.')).toBeInTheDocument();
  });

  it('닫기 버튼 클릭 시 onClose가 호출된다', () => {
    const onClose = vi.fn();
    render(<SceneEditPanel {...baseProps} section={sectionNoImage} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('되돌리기 버튼 클릭 시 onUndo가 호출된다', () => {
    const onUndo = vi.fn();
    render(
      <SceneEditPanel
        {...baseProps}
        section={sectionWithImage}
        prevSceneUrl="https://example.supabase.co/img/prev.jpg"
        onUndo={onUndo}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /되돌리기/ }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
