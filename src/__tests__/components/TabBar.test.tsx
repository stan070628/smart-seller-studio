/**
 * TabBar.test.tsx
 * 탭 바 렌더링과 상호작용 테스트
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import TabBar from '@/components/TabBar';
import { useTabStore } from '@/store/useTabStore';
import { useCacheStore } from '@/store/useCacheStore';
import { C } from '@/lib/design-tokens';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
  useTabStore.setState({ tabs: [], activeId: null });
  useCacheStore.setState({ entries: {}, scroll: {} });
});

describe('TabBar', () => {
  // 이 테스트는 파일 안에서 반드시 가장 먼저 실행돼야 한다.
  // TabBar는 모듈 스코프 변수 hasHydrated로 "하이드레이션을 이미 통과했는지"를
  // 기억한다 (AppShell 재마운트 시 플레이스홀더 깜빡임을 없애기 위해서다).
  // 아래의 다른 테스트가 먼저 client render(<TabBar />)를 한 번이라도 하면
  // useEffect가 hasHydrated를 true로 굳혀버려서, 이 테스트가 기대하는
  // "서버 렌더는 항상 마운트 전 상태로 시작한다"는 전제가 깨진다.
  it('서버 렌더에서는 탭을 그리지 않는다 — 하이드레이션 불일치 방지', () => {
    useTabStore.getState().openTab('/sourcing');

    expect(renderToString(<TabBar />)).not.toContain('소싱');
  });

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

  it('탭이 없으면 탭을 그리지 않되 자리는 남긴다', () => {
    const { container } = render(<TabBar />);

    expect(container.querySelector('[data-testid="tab-bar"]')).toBeNull();
    expect(container.firstElementChild).toHaveStyle({ height: '36px' });
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

  it('활성 탭만 강조 스타일을 갖는다', () => {
    useTabStore.getState().openTab('/sourcing');
    useTabStore.getState().openTab('/orders');
    render(<TabBar />);

    const activeTab = screen.getByText('주문/매출').closest('div')!;
    const inactiveTab = screen.getByText('소싱').closest('div')!;

    expect(activeTab).toHaveStyle({ backgroundColor: C.card });
    expect(activeTab).toHaveStyle({ borderBottomColor: C.accent });
    expect(inactiveTab).toHaveStyle({ color: C.textSub });
  });

  it('마지막 탭을 닫으면 대시보드로 간다', async () => {
    useTabStore.getState().openTab('/sourcing');
    render(<TabBar />);

    await userEvent.click(screen.getByLabelText('소싱 탭 닫기'));

    expect(push).toHaveBeenCalledWith('/dashboard');
  });

  it('첫 탭이 활성일 때 닫으면 오른쪽 탭의 주소로 이동한다', async () => {
    useTabStore.getState().openTab('/sourcing');
    useTabStore.getState().openTab('/orders?tab=cost');
    useTabStore.getState().openTab('/sourcing'); // 첫 탭을 다시 활성화
    render(<TabBar />);

    await userEvent.click(screen.getByLabelText('소싱 탭 닫기'));

    expect(push).toHaveBeenCalledWith('/orders?tab=cost');
  });

  it('캐시가 있는 탭에 마지막 갱신 시각을 보여준다', () => {
    useTabStore.getState().openTab('/sourcing');
    useCacheStore.getState().setEntry('sourcing:shortlist', { items: [] });
    render(<TabBar />);

    expect(screen.getByText('· 방금')).toBeInTheDocument();
  });

  it('캐시가 없는 탭에는 시각을 보여주지 않는다', () => {
    useTabStore.getState().openTab('/orders');
    render(<TabBar />);

    expect(screen.queryByText(/방금|분 전|시간 전/)).toBeNull();
  });

  it('다른 라우트의 캐시는 세지 않는다', () => {
    useTabStore.getState().openTab('/orders');
    useCacheStore.getState().setEntry('sourcing:shortlist', { items: [] });
    render(<TabBar />);

    expect(screen.queryByText('· 방금')).toBeNull();
  });
});
