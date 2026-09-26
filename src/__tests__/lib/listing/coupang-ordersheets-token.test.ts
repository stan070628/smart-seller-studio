import { describe, it, expect, vi, beforeAll } from 'vitest';

// M5 — 발주서 nextToken은 URL에 인코딩해 싣는다(토큰에 +·/·= 가 섞이면 서명·조회가 어긋난다)
describe('CoupangClient.getOrders nextToken', () => {
  beforeAll(() => {
    process.env.COUPANG_ACCESS_KEY = 'test-access';
    process.env.COUPANG_SECRET_KEY = 'test-secret';
    process.env.COUPANG_VENDOR_ID = 'A00000000';
  });

  it('nextToken을 encodeURIComponent로 싣는다', async () => {
    const { CoupangClient } = await import('@/lib/listing/coupang-client');
    const c = new CoupangClient();
    const req = vi.fn(async () => ({ code: 'SUCCESS', message: '', data: [], nextToken: null }));
    (c as unknown as { request: typeof req }).request = req;
    await c.getOrders({ createdAtFrom: '2026-09-26', createdAtTo: '2026-09-27', status: 'ACCEPT', nextToken: 'a+b/c=d&e' });
    const url = (req.mock.calls[0] as unknown as [string, string])[1];
    expect(url).toContain(`nextToken=${encodeURIComponent('a+b/c=d&e')}`);
    expect(url).not.toContain('nextToken=a+b');
  });
});
