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

describe('PATCH /api/sourcing/shortlist/[itemNo] — 1688 값', () => {
  beforeEach(() => {
    patchShortlist.mockReset();
    verifyOne.mockReset().mockResolvedValue(true);
    getShortlistItem.mockReset().mockResolvedValue({
      itemNo: 55788793, title: 't', orderQty: 10, logisticsSize: 'xsmall', coupangP25: 10500,
    });
  });

  it('정상값을 저장한다', async () => {
    const res = await PATCH(req({
      buyKrwTotal: 3867, buyCnyTotal: 17.5, orderQty1688: 2,
      exchangeRate1688: 220.97, intlShipPerUnit: 322,
    }), ctx);
    expect(res.status).toBe(200);
    expect(patchShortlist).toHaveBeenCalledWith(55788793, {
      buyKrwTotal: 3867, buyCnyTotal: 17.5, orderQty1688: 2,
      exchangeRate1688: 220.97, intlShipPerUnit: 322,
    });
  });

  it('null로 붙여넣기 값을 지울 수 있다', async () => {
    const res = await PATCH(req({
      buyKrwTotal: null, buyCnyTotal: null, orderQty1688: null,
      exchangeRate1688: null, intlShipPerUnit: null,
    }), ctx);
    expect(res.status).toBe(200);
    expect(patchShortlist).toHaveBeenCalled();
  });

  it('수량이 0 이하면 400이다', async () => {
    const res = await PATCH(req({ buyKrwTotal: 3867, orderQty1688: 0 }), ctx);
    expect(res.status).toBe(400);
    expect(patchShortlist).not.toHaveBeenCalled();
  });

  it('원화 합계가 음수면 400이다', async () => {
    const res = await PATCH(req({ buyKrwTotal: -1, orderQty1688: 2 }), ctx);
    expect(res.status).toBe(400);
    expect(patchShortlist).not.toHaveBeenCalled();
  });

  it('원화 합계가 소수면 400이다', async () => {
    const res = await PATCH(req({ buyKrwTotal: 3867.5, orderQty1688: 2 }), ctx);
    expect(res.status).toBe(400);
    expect(patchShortlist).not.toHaveBeenCalled();
  });

  it('원화 합계 자릿수가 밀리면 400이다', async () => {
    const res = await PATCH(req({ buyKrwTotal: 100_000_001, orderQty1688: 2 }), ctx);
    expect(res.status).toBe(400);
    expect(patchShortlist).not.toHaveBeenCalled();
  });

  // 위안 합계·환율은 소수라 정수 검사를 걸 수 없다. 숫자가 아닌 값이 그대로
  // numeric 컬럼에 들어가면 500이 나므로 400으로 먼저 막는다
  it('위안 합계가 숫자가 아니면 400이다', async () => {
    const res = await PATCH(req({ buyKrwTotal: 3867, buyCnyTotal: '17.5' }), ctx);
    expect(res.status).toBe(400);
    expect(patchShortlist).not.toHaveBeenCalled();
  });

  it('위안 합계가 음수면 400이다', async () => {
    const res = await PATCH(req({ buyCnyTotal: -17.5 }), ctx);
    expect(res.status).toBe(400);
    expect(patchShortlist).not.toHaveBeenCalled();
  });

  it('환율이 0 이하면 400이다', async () => {
    const res = await PATCH(req({ exchangeRate1688: 0 }), ctx);
    expect(res.status).toBe(400);
    expect(patchShortlist).not.toHaveBeenCalled();
  });

  it('환율 자릿수가 밀리면 400이다', async () => {
    const res = await PATCH(req({ exchangeRate1688: 22097 }), ctx);
    expect(res.status).toBe(400);
    expect(patchShortlist).not.toHaveBeenCalled();
  });

  it('국제배송비만 따로 고칠 수 있다', async () => {
    const res = await PATCH(req({ intlShipPerUnit: 500 }), ctx);
    expect(res.status).toBe(200);
    expect(patchShortlist).toHaveBeenCalledWith(55788793, { intlShipPerUnit: 500 });
  });

  it('국제배송비가 음수면 400이다', async () => {
    const res = await PATCH(req({ intlShipPerUnit: -1 }), ctx);
    expect(res.status).toBe(400);
    expect(patchShortlist).not.toHaveBeenCalled();
  });

  it('1688 값은 재검증을 부르지 않는다', async () => {
    await PATCH(req({ buyKrwTotal: 3867, orderQty1688: 2 }), ctx);
    // verifyOne은 도매꾹 판정용이다. 1688 원가는 조회 시 계산하므로 관계없다
    expect(verifyOne).not.toHaveBeenCalled();
  });
});
