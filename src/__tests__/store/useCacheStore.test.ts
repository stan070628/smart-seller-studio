/**
 * useCacheStore.test.ts
 * 키별 응답 캐시 스토어 단위 테스트
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useCacheStore } from '@/store/useCacheStore';

beforeEach(() => {
  useCacheStore.setState({ entries: {}, scroll: {} });
});

describe('setEntry', () => {
  it('데이터와 시각을 저장한다', () => {
    useCacheStore.getState().setEntry('orders:list', { rows: [1, 2] });

    const e = useCacheStore.getState().entries['orders:list'];
    expect(e.data).toEqual({ rows: [1, 2] });
    expect(e.error).toBeNull();
    expect(e.fetchedAt).toBeGreaterThan(0);
  });

  it('다시 저장하면 error가 지워진다', () => {
    useCacheStore.getState().setError('orders:list', '실패');
    useCacheStore.getState().setEntry('orders:list', { rows: [] });

    expect(useCacheStore.getState().entries['orders:list'].error).toBeNull();
  });
});

describe('setError', () => {
  it('이전 데이터를 지우지 않는다', () => {
    useCacheStore.getState().setEntry('orders:list', { rows: [1] });
    useCacheStore.getState().setError('orders:list', '네트워크 오류');

    const e = useCacheStore.getState().entries['orders:list'];
    expect(e.data).toEqual({ rows: [1] });
    expect(e.error).toBe('네트워크 오류');
  });

  it('캐시가 없던 키에도 엔트리를 만든다', () => {
    useCacheStore.getState().setError('orders:list', '실패');

    const e = useCacheStore.getState().entries['orders:list'];
    expect(e.data).toBeUndefined();
    expect(e.error).toBe('실패');
  });

  it('실패해도 마지막으로 성공한 시각을 갱신하지 않는다', () => {
    useCacheStore.getState().setEntry('orders:list', { rows: [1] });
    const fetchedAt = useCacheStore.getState().entries['orders:list'].fetchedAt;

    useCacheStore.getState().setError('orders:list', '실패');

    expect(useCacheStore.getState().entries['orders:list'].fetchedAt).toBe(fetchedAt);
  });
});

describe('invalidate', () => {
  beforeEach(() => {
    const s = useCacheStore.getState();
    s.setEntry('orders:list', 1);
    s.setEntry('orders:costs', 2);
    s.setEntry('sourcing:shortlist', 3);
    s.setScroll('orders', 120);
  });

  it('정확히 일치하는 키만 지운다', () => {
    useCacheStore.getState().invalidate('orders:list');

    expect(Object.keys(useCacheStore.getState().entries).sort()).toEqual([
      'orders:costs',
      'sourcing:shortlist',
    ]);
  });

  it('별표는 접두사로 일괄 삭제한다', () => {
    useCacheStore.getState().invalidate('orders:*');

    expect(Object.keys(useCacheStore.getState().entries)).toEqual(['sourcing:shortlist']);
  });

  it('접두사 삭제 시 같은 라우트의 스크롤 위치도 지운다', () => {
    useCacheStore.getState().invalidate('orders:*');

    expect(useCacheStore.getState().scroll['orders']).toBeUndefined();
  });

  it('접두사 삭제 시 같은 라우트의 하위 스크롤 컨테이너도 지운다', () => {
    useCacheStore.getState().setScroll('orders#list', 300);
    useCacheStore.getState().invalidate('orders:*');

    expect(useCacheStore.getState().scroll['orders#list']).toBeUndefined();
  });

  it('없는 키를 지워도 오류가 나지 않는다', () => {
    expect(() => useCacheStore.getState().invalidate('nope:*')).not.toThrow();
  });
});
