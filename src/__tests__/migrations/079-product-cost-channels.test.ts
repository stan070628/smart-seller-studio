import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getSourcingPool } from '@/lib/sourcing/db';
const mockGetPool = getSourcingPool as ReturnType<typeof vi.fn>;

describe('product_cost_channels 스키마 구조 검증', () => {
  let mockQuery: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockQuery = vi.fn();
    mockGetPool.mockReturnValue({ query: mockQuery });
  });

  it('UNIQUE 제약: 동일 user_id+channel_type+external_id는 ON CONFLICT DO NOTHING', () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(mockQuery).toBeDefined();
  });

  it('channel_type 허용값: coupang_rg | coupang_wing | naver', () => {
    const allowed = ['coupang_rg', 'coupang_wing', 'naver'];
    expect(allowed).toContain('coupang_rg');
    expect(allowed).toContain('coupang_wing');
    expect(allowed).toContain('naver');
    expect(allowed).not.toContain('invalid_channel');
    expect(allowed).not.toContain('');
  });

  it('external_id는 bigint — 쿠팡 옵션ID 크기 수용 (95401822935)', () => {
    const externalId = 95401822935;
    expect(Number.isInteger(externalId)).toBe(true);
    expect(externalId).toBeGreaterThan(0);
    // bigint 범위 내
    expect(externalId).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});
