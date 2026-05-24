import { describe, it, expect } from 'vitest';

describe('MobileCostcoList — product code detection', () => {
  const isProductCode = (s: string) => /^\d{6,7}$/.test(s);

  it('detects 7-digit number as product code', () => {
    expect(isProductCode('1234567')).toBe(true);
  });

  it('detects 6-digit number as product code', () => {
    expect(isProductCode('680806')).toBe(true);
  });

  it('rejects 5-digit number', () => {
    expect(isProductCode('12345')).toBe(false);
  });

  it('rejects 8-digit number', () => {
    expect(isProductCode('12345678')).toBe(false);
  });

  it('rejects text search', () => {
    expect(isProductCode('올리브오일')).toBe(false);
  });

  it('rejects mixed alphanumeric', () => {
    expect(isProductCode('123456a')).toBe(false);
  });
});
