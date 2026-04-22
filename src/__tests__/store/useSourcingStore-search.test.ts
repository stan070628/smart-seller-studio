import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSourcingStore } from '@/store/useSourcingStore';

// 원본 fetchAnalysis 함수를 저장
const originalFetchAnalysis = useSourcingStore.getState().fetchAnalysis;

describe('useSourcingStore — setSearchQuery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    // 원본 함수로 복원
    useSourcingStore.setState({ fetchAnalysis: originalFetchAnalysis, searchQuery: '', page: 1 });
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
    const state = useSourcingStore.getState();
    const fetchAnalysis = vi.spyOn(state, 'fetchAnalysis').mockResolvedValue(undefined);
    state.setSearchQuery('디스팬서');
    expect(fetchAnalysis).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(fetchAnalysis).toHaveBeenCalledTimes(1);
  });

  it('300ms 내에 연속 호출 시 마지막 호출만 fetchAnalysis를 실행한다', async () => {
    const state = useSourcingStore.getState();
    const fetchAnalysis = vi.spyOn(state, 'fetchAnalysis').mockResolvedValue(undefined);

    state.setSearchQuery('디');
    vi.advanceTimersByTime(100);
    state.setSearchQuery('디스');
    vi.advanceTimersByTime(100);
    state.setSearchQuery('디스팬서');
    vi.advanceTimersByTime(300);
    expect(fetchAnalysis).toHaveBeenCalledTimes(1);
  });
});
