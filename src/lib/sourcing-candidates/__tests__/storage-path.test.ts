import { describe, it, expect } from 'vitest';
import { scanImagePath, offerImagePath } from '@/lib/sourcing-candidates/storage-path';

describe('storage-path', () => {
  it('스캔 이미지 경로에 사용자·스캔 uuid가 들어간다', () => {
    expect(scanImagePath('u1', 's1', 0)).toBe('sourcing-candidates/u1/scans/s1/0.jpg');
  });
  it('업체 이미지 경로', () => {
    expect(offerImagePath('u1', 'o1', 2)).toBe('sourcing-candidates/u1/offers/o1/2.jpg');
  });
  it('음수 순번은 거부', () => {
    expect(() => scanImagePath('u1', 's1', -1)).toThrow();
  });
});
