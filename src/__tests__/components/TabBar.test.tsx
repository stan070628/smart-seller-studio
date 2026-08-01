/**
 * TabBar.test.tsx
 * 탭 바 렌더링과 상호작용 테스트
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TabBar from '@/components/TabBar';
import { useTabStore } from '@/store/useTabStore';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
  useTabStore.setState({ tabs: [], activeId: null });
});

describe('TabBar', () => {
  it('열린 탭을 모두 그린다', () => {
    useTabStore.getState().openTab('/sourcing');
    useTabStore.getState().openTab('/orders');
    render(<TabBar />);

    expect(screen.getByText('소싱')).toBeInTheDocument();
    expect(screen.getByText('주문/매출')).toBeInTheDocument();
  });

  it('탭이 하나여도 표시한다 — 숨기면 레이아웃이 밀린다', () => {
    useTabStore.getState().openTab('/sourcing');
    const { container } = render(<TabBar />);

    expect(container.querySelector('[data-testid="tab-bar"]')).toBeInTheDocument();
  });

  it('탭이 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<TabBar />);

    expect(container.querySelector('[data-testid="tab-bar"]')).toBeNull();
  });

  it('탭을 클릭하면 그 href로 이동한다', async () => {
    useTabStore.getState().openTab('/sourcing?tab=discovery&page=3');
    useTabStore.getState().openTab('/orders');
    render(<TabBar />);

    await userEvent.click(screen.getByText('소싱'));

    expect(push).toHaveBeenCalledWith('/sourcing?tab=discovery&page=3');
  });

  it('닫기를 누르면 탭이 사라진다', async () => {
    useTabStore.getState().openTab('/sourcing');
    useTabStore.getState().openTab('/orders');
    render(<TabBar />);

    await userEvent.click(screen.getByLabelText('소싱 탭 닫기'));

    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(['orders']);
    // 닫기 클릭이 탭 자체의 클릭 핸들러로 버블링되면 안 된다.
    // (stopPropagation 누락 시 비활성 탭이라도 router.push가 불린다)
    expect(push).not.toHaveBeenCalled();
  });

  it('활성 탭을 닫으면 왼쪽 탭으로 이동한다', async () => {
    useTabStore.getState().openTab('/sourcing');
    useTabStore.getState().openTab('/orders');
    render(<TabBar />);

    await userEvent.click(screen.getByLabelText('주문/매출 탭 닫기'));

    // handleClose가 유발한 이동 한 번만 있어야 한다.
    // 버블링이 새어나가면 클릭한 탭 자신의 href로 추가 push가 발생한다.
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/sourcing');
  });

  it('편집 중인 탭에 표시가 붙는다', () => {
    useTabStore.getState().openTab('/editor');
    useTabStore.getState().setDirty('editor', true);
    render(<TabBar />);

    expect(screen.getByLabelText('편집 중')).toBeInTheDocument();
  });
});
