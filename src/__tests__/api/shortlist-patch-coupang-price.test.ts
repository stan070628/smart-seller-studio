import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'u1' }),
}));

const patchShortlist = vi.fn();
const getShortlistItem = vi.fn();
vi.mock('@/lib/sourcing/shortlist-db', () => ({
  patchShortlist: (...a: unknown[]) => patchShortlist(...a),
  getShortlistItem: (...a: unknown[]) => getShortlistItem(...a),
}));

const verifyOne = vi.fn();
vi.mock('@/lib/sourcing/shortlist-verify', () => ({
  verifyOne: (...a: unknown[]) => verifyOne(...a),
}));

import { PATCH } from '@/app/api/sourcing/shortlist/[itemNo]/route';

function req(body: unknown) {
  return new NextRequest('http://localhost/api/sourcing/shortlist/55788793', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ itemNo: '55788793' }) };

describe('PATCH /api/sourcing/shortlist/[itemNo] — coupangP25', () => {
  beforeEach(() => {
    patchShortlist.mockReset();
    verifyOne.mockReset().mockResolvedValue(true);
    getShortlistItem.mockReset().mockResolvedValue({
      itemNo: 55788793, title: 't', orderQty: 10, logisticsSize: 'xsmall', coupangP25: 10500,
    });
  });

  it('정상값을 저장하고 재검증을 돌린다', async () => {
    const res = await PATCH(req({ coupangP25: 10500 }), ctx);
    expect(res.status).toBe(200);
    expect(patchShortlist).toHaveBeenCalledWith(55788793, { coupangP25: 10500 });
    // 시세가 바뀌면 판정·마진이 달라지므로 반드시 재계산되어야 한다
    expect(verifyOne).toHaveBeenCalled();
  });

  it('null로 지울 수 있다', async () => {
    const res = await PATCH(req({ coupangP25: null }), ctx);
    expect(res.status).toBe(200);
    expect(patchShortlist).toHaveBeenCalledWith(55788793, { coupangP25: null });
  });

  it('음수는 400이다', async () => {
    const res = await PATCH(req({ coupangP25: -1 }), ctx);
    expect(res.status).toBe(400);
    expect(patchShortlist).not.toHaveBeenCalled();
  });

  it('소수는 400이다', async () => {
    const res = await PATCH(req({ coupangP25: 1000.5 }), ctx);
    expect(res.status).toBe(400);
    expect(patchShortlist).not.toHaveBeenCalled();
  });

  it('1,000만원 초과는 400이다', async () => {
    const res = await PATCH(req({ coupangP25: 10_000_001 }), ctx);
    expect(res.status).toBe(400);
    expect(patchShortlist).not.toHaveBeenCalled();
  });
});
