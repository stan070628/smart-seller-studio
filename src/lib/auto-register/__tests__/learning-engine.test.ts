import { describe, it, expect } from 'vitest';
import { computeFieldTrust, computeAutoModeStatus } from '../learning-engine';
import type { FieldTrustStatus } from '../types';

describe('computeFieldTrust', () => {
  it('5회 중 4회 통과(80%)이면 isTrusted=true', () => {
    const rows = [
      { was_corrected: false },
      { was_corrected: false },
      { was_corrected: false },
      { was_corrected: false },
      { was_corrected: true },
    ];
    const result = computeFieldTrust('sellerProductName', rows);
    expect(result.isTrusted).toBe(true);
    expect(result.trustScore).toBeCloseTo(0.8);
  });

  it('5회 중 3회 통과(60%)이면 isTrusted=false', () => {
    const rows = [
      { was_corrected: false },
      { was_corrected: false },
      { was_corrected: false },
      { was_corrected: true },
      { was_corrected: true },
    ];
    const result = computeFieldTrust('salePrice', rows);
    expect(result.isTrusted).toBe(false);
  });

  it('5회 미만이면 isTrusted=false', () => {
    const rows = [
      { was_corrected: false },
      { was_corrected: false },
      { was_corrected: false },
      { was_corrected: false },
    ];
    const result = computeFieldTrust('brand', rows);
    expect(result.isTrusted).toBe(false);
    expect(result.recentCount).toBe(4);
  });
});

describe('computeAutoModeStatus', () => {
  it('모든 필드가 신뢰됨이면 isAvailable=true', () => {
    const allTrusted: FieldTrustStatus[] = [
      'sellerProductName', 'displayCategoryCode', 'brand',
      'salePrice', 'originalPrice', 'stockQuantity',
      'deliveryChargeType', 'deliveryCharge', 'searchTags',
    ].map((f) => ({
      fieldName: f, recentCount: 5, acceptedCount: 5,
      trustScore: 1.0, isTrusted: true,
    }));
    const status = computeAutoModeStatus(allTrusted);
    expect(status.isAvailable).toBe(true);
    expect(status.untrustedFields).toHaveLength(0);
  });

  it('하나라도 미신뢰 필드가 있으면 isAvailable=false', () => {
    const statuses: FieldTrustStatus[] = [
      { fieldName: 'sellerProductName', recentCount: 5, acceptedCount: 5, trustScore: 1, isTrusted: true },
      { fieldName: 'displayCategoryCode', recentCount: 3, acceptedCount: 3, trustScore: 1, isTrusted: false },
    ];
    const status = computeAutoModeStatus(statuses);
    expect(status.isAvailable).toBe(false);
    expect(status.untrustedFields).toContain('displayCategoryCode');
  });
});
