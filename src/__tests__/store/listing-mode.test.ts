import { describe, it, expect, beforeEach } from 'vitest';
import { useListingStore } from '@/store/useListingStore';

describe('useListingStore — listingMode', () => {
  beforeEach(() => {
    useListingStore.setState({ listingMode: 'register' });
  });

  it('기본값은 register', () => {
    expect(useListingStore.getState().listingMode).toBe('register');
  });

  it("'browse'로 전환 가능", () => {
    useListingStore.getState().setListingMode('browse');
    expect(useListingStore.getState().listingMode).toBe('browse');
  });

  it("'assets'로 전환 가능", () => {
    useListingStore.getState().setListingMode('assets');
    expect(useListingStore.getState().listingMode).toBe('assets');
  });
});

describe('useListingStore — assetsDraft', () => {
  beforeEach(() => {
    useListingStore.getState().resetAssetsDraft();
  });

  it('초기 mode는 url, 입력은 비어 있다', () => {
    const d = useListingStore.getState().assetsDraft;
    expect(d.mode).toBe('url');
    expect(d.url).toBe('');
    expect(d.uploadedFiles).toEqual([]);
    expect(d.generatedThumbnails).toEqual([]);
    expect(d.generatedDetailHtml).toBe('');
    expect(d.isGenerating).toBe(false);
    expect(d.lastError).toBe(null);
  });

  it('updateAssetsDraft로 부분 업데이트가 가능하다', () => {
    useListingStore.getState().updateAssetsDraft({ url: 'https://x.com', mode: 'url' });
    const d = useListingStore.getState().assetsDraft;
    expect(d.url).toBe('https://x.com');
  });
});
