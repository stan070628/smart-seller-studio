import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/listing/url-health-check', () => ({
  checkUrl: vi.fn(),
}));

const mockQuery = vi.fn();
vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: () => ({ query: mockQuery }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { GET } from '@/app/api/listing/sourcing/check-dead-urls/route';
import { checkUrl } from '@/lib/listing/url-health-check';

function makeRequest(token = 'test-secret') {
  return new NextRequest('http://localhost/api/listing/sourcing/check-dead-urls', {
    headers: { authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-secret');
  vi.stubEnv('RESEND_API_KEY', 'resend-key');
  vi.stubEnv('ALERT_EMAIL', 'test@example.com');
  vi.clearAllMocks();
  mockQuery.mockReset();
});

describe('인증', () => {
  it('잘못된 토큰이면 401을 반환한다', async () => {
    const res = await GET(makeRequest('wrong-token'));
    expect(res.status).toBe(401);
  });

  it('CRON_SECRET 미설정이면 500을 반환한다', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const res = await GET(makeRequest('any'));
    expect(res.status).toBe(500);
  });
});

describe('URL 없음', () => {
  it('온라인 소싱 레코드가 없으면 checked=0, dead=0을 반환한다', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.checked).toBe(0);
    expect(body.dead).toBe(0);
    expect(body.emailed).toBe(false);
  });
});

describe('dead URL 발견', () => {
  it('404 URL은 alerts에 INSERT하고 이메일을 발송한다', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        platform: 'coupang',
        product_id: '111',
        product_name: '캠핑 의자',
        sourcing_value: 'https://domeggook.com/product/9999',
      }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // 중복 알림 체크 — 없음
    mockQuery.mockResolvedValueOnce({ rows: [] }); // alerts INSERT

    vi.mocked(checkUrl).mockResolvedValueOnce({ status: 'dead', httpStatus: 404 });
    mockFetch.mockResolvedValueOnce({ ok: true }); // Resend 응답

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.checked).toBe(1);
    expect(body.dead).toBe(1);
    expect(body.emailed).toBe(true);

    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO alerts'),
    );
    expect(insertCall).toBeTruthy();
    expect(insertCall![1]).toContain('sourcing_url_dead');
    expect(insertCall![1]).toContain('coupang:111');
  });

  it('alive URL은 alerts INSERT를 호출하지 않는다', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        platform: 'naver',
        product_id: '222',
        product_name: '등산 모자',
        sourcing_value: 'https://domeggook.com/product/1234',
      }],
    });
    vi.mocked(checkUrl).mockResolvedValueOnce({ status: 'alive' });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.dead).toBe(0);
    expect(body.emailed).toBe(false);
    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO alerts'),
    );
    expect(insertCall).toBeUndefined();
  });

  it('skip URL은 alerts INSERT를 호출하지 않는다', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        platform: 'coupang',
        product_id: '333',
        product_name: '상품명',
        sourcing_value: 'https://detail.1688.com/offer/123.html',
      }],
    });
    vi.mocked(checkUrl).mockResolvedValueOnce({ status: 'skip', reason: 'HTTP 403' });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.dead).toBe(0);
    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO alerts'),
    );
    expect(insertCall).toBeUndefined();
  });

  it('최근 24시간 내 이미 알림 발생한 레코드는 중복 INSERT하지 않는다', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        platform: 'coupang',
        product_id: '444',
        product_name: '상품명',
        sourcing_value: 'https://domeggook.com/product/9999',
      }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 99 }] }); // 중복 알림 이미 존재

    vi.mocked(checkUrl).mockResolvedValueOnce({ status: 'dead', httpStatus: 404 });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.dead).toBe(0);
    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO alerts'),
    );
    expect(insertCall).toBeUndefined();
  });

  it('RESEND_API_KEY 없으면 이메일 미발송 + 앱 알림은 유지', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    mockQuery.mockResolvedValueOnce({
      rows: [{
        platform: 'coupang',
        product_id: '555',
        product_name: '상품명',
        sourcing_value: 'https://domeggook.com/product/9999',
      }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // 중복 없음
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT

    vi.mocked(checkUrl).mockResolvedValueOnce({ status: 'dead', httpStatus: 404 });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.dead).toBe(1);
    expect(body.emailed).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
