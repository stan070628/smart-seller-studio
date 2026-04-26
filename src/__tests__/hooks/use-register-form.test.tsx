/**
 * use-register-form.test.tsx
 * useRegisterForm 훅 단위 테스트
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRegisterForm } from '@/hooks/useRegisterForm';
import { useListingStore } from '@/store/useListingStore';

describe('useRegisterForm', () => {
  beforeEach(() => {
    useListingStore.getState().resetSharedDraft();
  });

  it('초기 errors는 빈 객체', () => {
    const { result } = renderHook(() => useRegisterForm());
    expect(result.current.errors).toEqual({});
  });

  it('상품명 빈 상태로 validate하면 name 에러를 반환', () => {
    const { result } = renderHook(() => useRegisterForm());
    act(() => { result.current.validate(); });
    expect(result.current.errors.name).toBeTruthy();
  });

  it('썸네일 0장이면 images 에러를 반환', () => {
    useListingStore.getState().updateSharedDraft({ name: '테스트' });
    const { result } = renderHook(() => useRegisterForm());
    act(() => { result.current.validate(); });
    expect(result.current.errors.images).toBeTruthy();
  });

  it('buildPayloadData는 sharedDraft 내용을 그대로 매핑한다', () => {
    useListingStore.getState().updateSharedDraft({
      name: '테스트',
      salePrice: '10000',
      stock: '100',
      thumbnailImages: ['t1.jpg'],
    });
    const { result } = renderHook(() => useRegisterForm());
    const payload = result.current.buildPayloadData();
    expect(payload.name).toBe('테스트');
    expect(payload.salePrice).toBe(10000);
    expect(payload.stock).toBe(100);
    expect(payload.thumbnailImages).toEqual(['t1.jpg']);
  });
});
