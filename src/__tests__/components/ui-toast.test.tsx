import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { toast, Toaster } from '@/components/ui/toast';

describe('toast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('toast.error가 빨강 메시지를 렌더하고 3.5초 후 사라진다', () => {
    render(<Toaster />);
    act(() => { toast.error('실패했어요'); });
    expect(screen.getByText('실패했어요')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3500); });
    expect(screen.queryByText('실패했어요')).not.toBeInTheDocument();
  });

  it('toast.success 메시지도 렌더된다', () => {
    render(<Toaster />);
    act(() => { toast.success('완료!'); });
    expect(screen.getByText('완료!')).toBeInTheDocument();
  });
});
