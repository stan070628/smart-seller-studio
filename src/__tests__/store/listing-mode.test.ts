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
