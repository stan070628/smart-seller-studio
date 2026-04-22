import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSourcingStore } from '@/store/useSourcingStore';

describe('useSourcingStore — setSearchQuery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    useSourcingStore.setState({ searchQuery: '', page: 1 });
  });

  it('setSearchQuery 호출 시 searchQuery 상태가 업데이트된다', () => {
    useSourcingStore.getState().setSearchQuery('디스팬서');
    expect(useSourcingStore.getState().searchQuery).toBe('디스팬서');
  });

  it('setSearchQuery 호출 시 page가 1로 리셋된다', () => {
    useSourcingStore.setState({ page: 3 });
    useSourcingStore.getState().setSearchQuery('테스트');
    expect(useSourcingStore.getState().page).toBe(1);
  });

  it('setSearchQuery 호출 후 300ms가 지나면 fetchAnalysis가 호출된다', async () => {
    let callCount = 0;
    const originalFetch = useSourcingStore.getState().fetchAnalysis;
    useSourcingStore.setState({
      fetchAnalysis: async () => {
        callCount++;
      },
    });

    useSourcingStore.getState().setSearchQuery('디스팬서');
    expect(callCount).toBe(0);
    vi.advanceTimersByTime(300);
    expect(callCount).toBe(1);

    useSourcingStore.setState({ fetchAnalysis: originalFetch });
  });

  it('300ms 내에 연속 호출 시 마지막 호출만 fetchAnalysis를 실행한다', async () => {
    let callCount = 0;
    const originalFetch = useSourcingStore.getState().fetchAnalysis;
    useSourcingStore.setState({
      fetchAnalysis: async () => {
        callCount++;
      },
    });

    useSourcingStore.getState().setSearchQuery('디');
    vi.advanceTimersByTime(100);
    useSourcingStore.getState().setSearchQuery('디스');
    vi.advanceTimersByTime(100);
    useSourcingStore.getState().setSearchQuery('디스팬서');
    vi.advanceTimersByTime(300);
    expect(callCount).toBe(1);

    useSourcingStore.setState({ fetchAnalysis: originalFetch });
  });
});
