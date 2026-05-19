import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';

import { checkUrl } from '@/lib/listing/url-health-check';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  server.resetHandlers();
});

describe('checkUrl', () => {
  it('404 응답이면 dead를 반환한다', async () => {
    server.use(
      http.head('https://domeggook.com/main/item/itemView.php', () => {
        return new HttpResponse(null, { status: 404 });
      })
    );
    const result = await checkUrl('https://domeggook.com/main/item/itemView.php?uid=9999999');
    expect(result.status).toBe('dead');
    if (result.status === 'dead') {
      expect(result.httpStatus).toBe(404);
    }
  });

  it('410 응답이면 dead를 반환한다', async () => {
    server.use(
      http.head('https://detail.1688.com/offer/*', () => {
        return new HttpResponse(null, { status: 410 });
      })
    );
    const result = await checkUrl('https://detail.1688.com/offer/99999.html');
    expect(result.status).toBe('dead');
    if (result.status === 'dead') {
      expect(result.httpStatus).toBe(410);
    }
  });

  it('200 응답이면 alive를 반환한다', async () => {
    server.use(
      http.head('https://domeggook.com/main/item/itemView.php', () => {
        return new HttpResponse(null, { status: 200 });
      })
    );
    const result = await checkUrl('https://domeggook.com/main/item/itemView.php?uid=12345');
    expect(result.status).toBe('alive');
  });

  it('301 리다이렉트면 alive를 반환한다', async () => {
    server.use(
      http.head('https://example.com/product/1', () => {
        return new HttpResponse(null, {
          status: 301,
          headers: { Location: 'https://example.com/product/1-new' },
        });
      }),
      http.get('https://example.com/product/1', () => {
        return new HttpResponse(null, {
          status: 301,
          headers: { Location: 'https://example.com/product/1-new' },
        });
      }),
      http.head('https://example.com/product/1-new', () => {
        return new HttpResponse(null, { status: 200 });
      }),
      http.get('https://example.com/product/1-new', () => {
        return new HttpResponse(null, { status: 200 });
      })
    );
    const result = await checkUrl('https://example.com/product/1');
    expect(result.status).toBe('alive');
  });

  it('403 응답이면 skip을 반환한다 (geo-block 가능)', async () => {
    server.use(
      http.head('https://detail.1688.com/offer/*', () => {
        return new HttpResponse(null, { status: 403 });
      })
    );
    const result = await checkUrl('https://detail.1688.com/offer/99999.html');
    expect(result.status).toBe('skip');
    if (result.status === 'skip') {
      expect(result.reason).toContain('403');
    }
  });

  it('500 서버 오류면 skip을 반환한다', async () => {
    server.use(
      http.head('https://example.com/product/*', () => {
        return new HttpResponse(null, { status: 500 });
      })
    );
    const result = await checkUrl('https://example.com/product/1');
    expect(result.status).toBe('skip');
  });

  it('네트워크 오류면 skip을 반환한다', async () => {
    // MSW의 NetworkError를 사용하여 네트워크 오류 시뮬레이션
    server.use(
      http.head('https://network-error.example.com/product/*', () => {
        return HttpResponse.error();
      })
    );
    const result = await checkUrl('https://network-error.example.com/product/1');
    expect(result.status).toBe('skip');
    if (result.status === 'skip') {
      expect(result.reason).toContain('network');
    }
  });

  it('HEAD 메서드로 요청한다', async () => {
    let requestMethod = '';
    server.use(
      http.head('https://domeggook.com/main/item/itemView.php', ({ request }) => {
        requestMethod = request.method;
        return new HttpResponse(null, { status: 200 });
      })
    );
    await checkUrl('https://domeggook.com/main/item/itemView.php?uid=12345');
    expect(requestMethod).toBe('HEAD');
  });
});
