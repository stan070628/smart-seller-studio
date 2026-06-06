import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SceneImageDrawer from '@/components/listing/assets/SceneImageDrawer';
import type { AiImageSlot } from '@/lib/detail-page/ai-html-builder';

const SLOTS: AiImageSlot[] = [
  { role: 'hero', url: 'https://example.com/hero.jpg', prompt: 'hero scene', isReplaced: false },
  { role: 'lifestyle', url: 'https://example.com/lifestyle.jpg', prompt: 'lifestyle scene', isReplaced: false },
];

describe('SceneImageDrawer', () => {
  it('선택된 씬 이름을 헤더에 표시한다', () => {
    render(
      <SceneImageDrawer
        slots={SLOTS}
        activeIndex={0}
        uploadedImages={[]}
        onReplace={vi.fn()}
        onClose={vi.fn()}
        onSelectScene={vi.fn()}
      />
    );
    expect(screen.getByText('메인 히어로 교체')).toBeInTheDocument();
  });

  it('닫기 버튼 클릭 시 onClose를 호출한다', () => {
    const onClose = vi.fn();
    render(
      <SceneImageDrawer
        slots={SLOTS}
        activeIndex={0}
        uploadedImages={[]}
        onReplace={vi.fn()}
        onClose={onClose}
        onSelectScene={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('←'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('업로드된 이미지 클릭 시 onReplace와 onClose를 호출한다', () => {
    const onReplace = vi.fn();
    const onClose = vi.fn();
    render(
      <SceneImageDrawer
        slots={SLOTS}
        activeIndex={1}
        uploadedImages={['https://example.com/uploaded.jpg']}
        onReplace={onReplace}
        onClose={onClose}
        onSelectScene={vi.fn()}
      />
    );
    fireEvent.click(screen.getByAltText('업로드 이미지 1').closest('button')!);
    expect(onReplace).toHaveBeenCalledWith(1, 'https://example.com/uploaded.jpg', true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('씬 전환 탭 클릭 시 onSelectScene을 호출한다', () => {
    const onSelectScene = vi.fn();
    render(
      <SceneImageDrawer
        slots={SLOTS}
        activeIndex={0}
        uploadedImages={[]}
        onReplace={vi.fn()}
        onClose={vi.fn()}
        onSelectScene={onSelectScene}
      />
    );
    fireEvent.click(screen.getByText('라이프스타일'));
    expect(onSelectScene).toHaveBeenCalledWith(1);
  });

  it('slots가 비어있거나 activeIndex가 범위 밖이면 null을 반환한다', () => {
    const { container } = render(
      <SceneImageDrawer
        slots={[]}
        activeIndex={0}
        uploadedImages={[]}
        onReplace={vi.fn()}
        onClose={vi.fn()}
        onSelectScene={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
