import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StoryboardEditor from '@/components/listing/detail-maker/StoryboardEditor';
import type { SceneStoryboardItem } from '@/types/detail-page';

// dnd-kit은 DOM 환경 없이 테스트하기 어려우므로 mock
vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core');
  return {
    ...actual,
    DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});
vi.mock('@dnd-kit/sortable', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/sortable')>('@dnd-kit/sortable');
  return {
    ...actual,
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      transition: null,
    }),
    SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

const makeScene = (overrides: Partial<SceneStoryboardItem> = {}): SceneStoryboardItem => ({
  id: 'scene-1',
  title: '전면샷',
  description: '제품 정면 강조',
  prompt: 'Studio lighting on white background...',
  sourceImageIndex: 0,
  mode: 'ai',
  ...overrides,
});

const baseProps = {
  scenes: [makeScene()],
  uploadedUrls: ['https://x/a.jpg'],
  isHtmlReady: true,
  isGeneratingScenes: false,
  onScenesChange: vi.fn(),
  onGenerate: vi.fn(),
};

describe('StoryboardEditor', () => {
  it('씬 제목 input이 렌더링된다', () => {
    render(<StoryboardEditor {...baseProps} />);
    expect(screen.getByDisplayValue('전면샷')).toBeInTheDocument();
  });

  it('씬 추가 버튼 클릭 시 onScenesChange에 기존+새 씬 배열 전달', () => {
    const onScenesChange = vi.fn();
    render(<StoryboardEditor {...baseProps} onScenesChange={onScenesChange} />);
    fireEvent.click(screen.getByText(/씬 추가/));
    expect(onScenesChange).toHaveBeenCalledOnce();
    const called = onScenesChange.mock.calls[0][0] as SceneStoryboardItem[];
    expect(called).toHaveLength(2);
    expect(called[1]).toMatchObject({ title: '새 씬', mode: 'ai', sourceImageIndex: 0 });
  });

  it('isHtmlReady=false 이면 씬 이미지 생성 버튼이 disabled', () => {
    render(<StoryboardEditor {...baseProps} isHtmlReady={false} />);
    expect(screen.getByRole('button', { name: /씬 이미지 생성/ })).toBeDisabled();
  });

  it('isHtmlReady=true, isGeneratingScenes=false 이면 씬 이미지 생성 버튼 활성화', () => {
    render(<StoryboardEditor {...baseProps} isHtmlReady={true} isGeneratingScenes={false} />);
    expect(screen.getByRole('button', { name: /② 씬 이미지 생성/ })).not.toBeDisabled();
  });

  it('씬 이미지 생성 버튼 클릭 시 onGenerate 호출', () => {
    const onGenerate = vi.fn();
    render(<StoryboardEditor {...baseProps} onGenerate={onGenerate} />);
    fireEvent.click(screen.getByRole('button', { name: /② 씬 이미지 생성/ }));
    expect(onGenerate).toHaveBeenCalledOnce();
  });

  it('제목 수정 시 onScenesChange가 업데이트된 씬으로 호출됨', () => {
    const onScenesChange = vi.fn();
    render(<StoryboardEditor {...baseProps} onScenesChange={onScenesChange} />);
    fireEvent.change(screen.getByDisplayValue('전면샷'), { target: { value: '새 제목' } });
    expect(onScenesChange).toHaveBeenCalledWith([
      expect.objectContaining({ title: '새 제목' }),
    ]);
  });

  it('삭제 버튼 클릭 시 씬이 제거된 빈 배열 전달', () => {
    const onScenesChange = vi.fn();
    render(<StoryboardEditor {...baseProps} onScenesChange={onScenesChange} />);
    fireEvent.click(screen.getByRole('button', { name: /🗑/ }));
    expect(onScenesChange).toHaveBeenCalledWith([]);
  });

  it('isGeneratingScenes=true 이면 버튼 텍스트가 "씬 이미지 생성 중…"으로 변경되고 disabled', () => {
    render(<StoryboardEditor {...baseProps} isGeneratingScenes={true} />);
    const btn = screen.getByRole('button', { name: /씬 이미지 생성 중/ });
    expect(btn).toBeDisabled();
  });

  it('isHtmlReady=false 이면 "상세페이지 HTML 생성 중…" 안내 텍스트 노출', () => {
    render(<StoryboardEditor {...baseProps} isHtmlReady={false} />);
    expect(screen.getByText(/상세페이지 HTML 생성 중/)).toBeInTheDocument();
  });
});
