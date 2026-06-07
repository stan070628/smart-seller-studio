// src/__tests__/store/assets-draft-crop-state.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useListingStore } from '@/store/useListingStore';

describe('AssetsDraft 크롭 상태', () => {
  beforeEach(() => {
    const { result } = renderHook(() => useListingStore());
    act(() => result.current.resetAssetsDraft());
  });

  it('초기 상태에 pendingCrops, confirmedCrops, isAnalyzing이 있다', () => {
    const { result } = renderHook(() => useListingStore());
    const { assetsDraft } = result.current;
    expect(assetsDraft.pendingCrops).toBeNull();
    expect(assetsDraft.confirmedCrops).toBeNull();
    expect(assetsDraft.isAnalyzing).toBe(false);
  });

  it('updateAssetsDraft로 pendingCrops를 설정할 수 있다', () => {
    const { result } = renderHook(() => useListingStore());
    const crop = {
      id: 'crop-hero-1',
      originalImageUrl: 'https://example.com/original.jpg',
      croppedImageUrl: 'https://example.com/cropped.jpg',
      sectionType: 'hero' as const,
    };
    act(() => result.current.updateAssetsDraft({ pendingCrops: [crop] }));
    expect(result.current.assetsDraft.pendingCrops).toEqual([crop]);
  });

  it('resetAssetsDraft 후 pendingCrops가 null로 초기화된다', () => {
    const { result } = renderHook(() => useListingStore());
    const crop = {
      id: 'crop-1',
      originalImageUrl: 'https://example.com/img.jpg',
      croppedImageUrl: 'https://example.com/img.jpg',
      sectionType: 'hero' as const,
    };
    act(() => result.current.updateAssetsDraft({ pendingCrops: [crop], isAnalyzing: true }));
    act(() => result.current.resetAssetsDraft());
    expect(result.current.assetsDraft.pendingCrops).toBeNull();
    expect(result.current.assetsDraft.isAnalyzing).toBe(false);
  });
});
