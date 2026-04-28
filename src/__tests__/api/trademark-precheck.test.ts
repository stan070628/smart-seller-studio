// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/sourcing/legal/precheck', () => ({
  precheckTrademark: vi.fn(),
}));

vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: () => ({
    query: vi.fn().mockResolvedValue({ rows: [{ id: 1 }] }),
  }),
}));

import { POST } from '@/app/api/sourcing/trademark-precheck/route';
import { precheckTrademark } from '@/lib/sourcing/legal/precheck';

const mocked = vi.mocked(precheckTrademark);

describe('POST /api/sourcing/trademark-precheck', () => {
  beforeEach(() => mocked.mockReset());

  it('단일 상품명 사전체크 → 결과 배열 반환', async () => {
    mocked.mockResolvedValue({
      status: 'safe',
      issue: null,
      canProceed: true,
      brandCandidate: null,
    });

    const req = new NextRequest('http://x/api/sourcing/trademark-precheck', {
      method: 'POST',
      body: JSON.stringify({ titles: ['일반 텀블러'] }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results).toHaveLength(1);
    expect(json.results[0].status).toBe('safe');
  });

  it('빈 titles 배열 → 400', async () => {
    const req = new NextRequest('http://x/api/sourcing/trademark-precheck', {
      method: 'POST',
      body: JSON.stringify({ titles: [] }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('titles 배열 없음 → 400', async () => {
    const req = new NextRequest('http://x/api/sourcing/trademark-precheck', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('titles 길이 50 초과 → 400 (rate limit)', async () => {
    const titles = Array.from({ length: 51 }, (_, i) => `item ${i}`);
    const req = new NextRequest('http://x/api/sourcing/trademark-precheck', {
      method: 'POST',
      body: JSON.stringify({ titles }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('blocked 결과는 canProceed=false 포함', async () => {
    mocked.mockResolvedValue({
      status: 'blocked',
      issue: {
        layer: 'trademark',
        severity: 'RED',
        code: 'TRADEMARK_BLOCK',
        message: '[발주차단] 등록상표 충돌',
        detail: {},
      },
      canProceed: false,
      brandCandidate: 'XYZ',
    });

    const req = new NextRequest('http://x/api/sourcing/trademark-precheck', {
      method: 'POST',
      body: JSON.stringify({ titles: ['XYZ 컵'] }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(json.results[0].canProceed).toBe(false);
    expect(json.results[0].status).toBe('blocked');
  });
});
