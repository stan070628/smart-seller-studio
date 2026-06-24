// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockScrape1688 = vi.fn();
vi.mock('@/lib/scraping/1688-scraper', () => ({ scrape1688: mockScrape1688 }));

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/listing/1688-scrape', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/listing/1688-scrape', () => {
  const originalEnv = process.env.ENABLE_1688_SCRAPE;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.ENABLE_1688_SCRAPE = '1';
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ENABLE_1688_SCRAPE;
    } else {
      process.env.ENABLE_1688_SCRAPE = originalEnv;
    }
  });

  it('유효한 1688 URL → 스펙 반환', async () => {
    mockScrape1688.mockResolvedValue({
      productName: '코튼 티셔츠',
      specs: [{ label: '소재', value: '면 100%' }],
    });
    const { POST } = await import('@/app/api/listing/1688-scrape/route');
    const res = await POST(makeRequest({ url: 'https://detail.1688.com/offer/123.html' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.productName).toBe('코튼 티셔츠');
    expect(json.specs).toHaveLength(1);
  });

  it('ENABLE_1688_SCRAPE 미설정 → 501', async () => {
    delete process.env.ENABLE_1688_SCRAPE;
    const { POST } = await import('@/app/api/listing/1688-scrape/route');
    const res = await POST(makeRequest({ url: 'https://detail.1688.com/offer/123.html' }));
    expect(res.status).toBe(501);
  });

  it('1688.com 외 도메인 → 400', async () => {
    const { POST } = await import('@/app/api/listing/1688-scrape/route');
    const res = await POST(makeRequest({ url: 'https://evil.com/offer/123.html' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain('1688.com');
  });

  it('hostname 우회 시도 차단 — evil.com?x=1688.com', async () => {
    const { POST } = await import('@/app/api/listing/1688-scrape/route');
    const res = await POST(makeRequest({ url: 'https://evil.com?x=1688.com' }));
    expect(res.status).toBe(400);
  });

  it('URL 누락 → 400', async () => {
    const { POST } = await import('@/app/api/listing/1688-scrape/route');
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('스크래퍼 에러 → 502', async () => {
    mockScrape1688.mockRejectedValue(new Error('캡차 감지'));
    const { POST } = await import('@/app/api/listing/1688-scrape/route');
    const res = await POST(makeRequest({ url: 'https://detail.1688.com/offer/123.html' }));
    const json = await res.json();
    expect(res.status).toBe(502);
    expect(json.success).toBe(false);
  });
});
