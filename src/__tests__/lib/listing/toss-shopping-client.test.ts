import { describe, it, expect, vi, beforeEach } from 'vitest';

const proxyFetch = vi.fn();
vi.mock('@/lib/proxy-fetch', () => ({ proxyFetch: (...a: unknown[]) => proxyFetch(...a) }));

import { TossShoppingClient, getTossToken } from '@/lib/listing/toss-shopping-client';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('토스 주문 클라이언트 인증', () => {
  beforeEach(() => {
    proxyFetch.mockReset();
    vi.stubEnv('TOSS_SHOPPING_ACCESS_KEY', 'ak');
    vi.stubEnv('TOSS_SHOPPING_SECRET_KEY', 'sk');
  });

  it('Access Key·Secret Key로 토큰을 받아 Bearer로 조회하고, 한 인스턴스 안에서는 토큰을 한 번만 받는다', async () => {
    proxyFetch.mockImplementation(async (url: string) =>
      url.startsWith('https://oauth2.cert.toss.im/token')
        ? json({ access_token: 'tok-1', expires_in: 3599 })
        : json({ resultType: 'SUCCESS', success: { results: [], nextCursor: null } }));

    const c = new TossShoppingClient();
    await c.getOrdersPage({ startDate: '2026-09-26', endDate: '2026-09-27' });
    await c.getOrdersPage({ startDate: '2026-09-26', endDate: '2026-09-27' });

    const calls = proxyFetch.mock.calls.map((a) => a[0] as string);
    expect(calls.filter((u) => u.includes('oauth2.cert.toss.im'))).toHaveLength(1);
    const tokenBody = String((proxyFetch.mock.calls[0][1] as RequestInit).body);
    expect(tokenBody).toContain('client_id=ak');
    expect(tokenBody).toContain('scope=toss-shopping-fep%3Awrite');
    const orderInit = proxyFetch.mock.calls[1][1] as RequestInit;
    expect(new Headers(orderInit.headers).get('Authorization')).toBe('Bearer tok-1');
  });

  it('키가 없으면 토큰 발급을 부르지 않고 이유를 말한다', async () => {
    vi.stubEnv('TOSS_SHOPPING_ACCESS_KEY', '');
    await expect(getTossToken()).rejects.toThrow(/TOSS_SHOPPING_ACCESS_KEY/);
    expect(proxyFetch).not.toHaveBeenCalled();
  });

  it('발급 응답에 토큰이 없으면 HTTP 상태만 담아 실패한다(본문은 싣지 않는다)', async () => {
    proxyFetch.mockResolvedValue(json({ error: 'invalid_client', secret: 'x' }, 401));
    await expect(getTossToken()).rejects.toThrow('토스 토큰 발급 실패 (401)');
  });
});
