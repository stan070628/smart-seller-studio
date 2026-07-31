/**
 * shortlist-verify-routes.test.ts
 * 쇼트리스트 재검증 라우트 테스트 — 수동(POST)과 cron(GET).
 *
 * 레시피: listing-sourcing-check-dead-urls.test.ts, sourcing-costco-route.test.ts
 * (getSourcingPool·fetch 대신 이 두 라우트가 실제로 의존하는 shortlist-db·
 * shortlist-verify를 모킹한다는 점만 다르다).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// vi.hoisted로 선언해야 vi.mock 팩토리 내부에서 참조할 수 있다
const { mockListForVerify, mockGetShortlistItem, mockVerifyOne } = vi.hoisted(() => ({
  mockListForVerify: vi.fn(),
  mockGetShortlistItem: vi.fn(),
  mockVerifyOne: vi.fn(),
}));

vi.mock('@/lib/sourcing/shortlist-db', () => ({
  listForVerify: mockListForVerify,
  getShortlistItem: mockGetShortlistItem,
}));

// verifyOne만 모킹하고 NAVER_CALL_DELAY_MS·DEADLINE_SAFETY_MARGIN_MS·타입은 실제 값을
// 그대로 쓴다. delay도 모킹해 페이싱을 실제로 기다리지 않는다(테스트 속도).
vi.mock('@/lib/sourcing/shortlist-verify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sourcing/shortlist-verify')>();
  return {
    ...actual,
    verifyOne: mockVerifyOne,
    delay: vi.fn().mockResolvedValue(undefined),
  };
});

import { GET as cronGET } from '@/app/api/sourcing/cron/shortlist-verify/route';
import { POST as manualPOST } from '@/app/api/sourcing/shortlist/verify/route';

function target(itemNo: number) {
  return { itemNo, title: `상품 ${itemNo}`, orderQty: 10, logisticsSize: 'xsmall' as const };
}

function makeCronRequest(token?: string) {
  return new NextRequest('http://localhost/api/sourcing/cron/shortlist-verify', {
    headers: token !== undefined ? { authorization: `Bearer ${token}` } : undefined,
  });
}

function makeManualRequest(body: unknown) {
  return new NextRequest('http://localhost/api/sourcing/shortlist/verify', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListForVerify.mockReset();
  mockGetShortlistItem.mockReset();
  mockVerifyOne.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/sourcing/cron/shortlist-verify', () => {
  beforeEach(() => vi.stubEnv('CRON_SECRET', 'test-secret'));

  it('토큰이 불일치하면 401을 반환하고 검증을 시도하지 않는다', async () => {
    const res = await cronGET(makeCronRequest('wrong-token'));
    expect(res.status).toBe(401);
    expect(mockListForVerify).not.toHaveBeenCalled();
  });

  it('CRON_SECRET 미설정 시 인증 없이 통과한다', async () => {
    vi.stubEnv('CRON_SECRET', '');
    mockListForVerify.mockResolvedValueOnce([]);
    const res = await cronGET(makeCronRequest());
    expect(res.status).toBe(200);
  });

  it('올바른 토큰이면 200과 카운트를 반환한다', async () => {
    mockListForVerify.mockResolvedValueOnce([target(1), target(2), target(3)]);
    mockVerifyOne
      .mockResolvedValueOnce(true) // 검증됨
      .mockResolvedValueOnce(false) // 도매꾹 일시 오류 — skipped
      .mockResolvedValueOnce(true);

    const res = await cronGET(makeCronRequest('test-secret'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ verified: 2, skipped: 1, failed: 0, total: 3, remaining: 0 });
  });

  it('1건에서 예외가 나도 나머지가 처리되고 failed로 집계된다', async () => {
    mockListForVerify.mockResolvedValueOnce([target(1), target(2), target(3)]);
    mockVerifyOne
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('DB 오류'))
      .mockResolvedValueOnce(true);

    const res = await cronGET(makeCronRequest('test-secret'));
    const body = await res.json();

    expect(res.status).toBe(200);
    // 2번째 건이 예외를 던져도 3번째 건까지 처리된다 — 1건 실패가 나머지를 막지 않는다
    expect(mockVerifyOne).toHaveBeenCalledTimes(3);
    expect(body).toEqual({ verified: 2, skipped: 0, failed: 1, total: 3, remaining: 0 });
  });

  it('검증 대상이 없으면 전부 0으로 응답한다', async () => {
    mockListForVerify.mockResolvedValueOnce([]);
    const res = await cronGET(makeCronRequest('test-secret'));
    const body = await res.json();
    expect(body).toEqual({ verified: 0, skipped: 0, failed: 0, total: 0, remaining: 0 });
    expect(mockVerifyOne).not.toHaveBeenCalled();
  });

  it('데드라인 가드가 루프를 끊고 remaining을 옳게 계산한다', async () => {
    mockListForVerify.mockResolvedValueOnce([target(1), target(2), target(3)]);
    mockVerifyOne.mockResolvedValue(true);

    // Date.now() 호출 순서: 1회차=시작 시각, 2회차=1번째 항목 처리 전 검사(통과),
    // 3회차=2번째 항목 처리 전 검사(안전마진 초과로 탈출). maxDuration=300초,
    // DEADLINE_SAFETY_MARGIN_MS=30초 → hardDeadlineMs=270,000ms. 1,000,000ms 경과로
    // 확실히 초과시킨다 (off-by-one을 피하려고 여유 있게 큰 값을 쓴다).
    let call = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      call += 1;
      return call <= 2 ? 0 : 1_000_000;
    });

    const res = await cronGET(makeCronRequest('test-secret'));
    const body = await res.json();

    expect(mockVerifyOne).toHaveBeenCalledTimes(1);
    expect(body).toEqual({ verified: 1, skipped: 0, failed: 0, total: 3, remaining: 2 });
  });
});

describe('POST /api/sourcing/shortlist/verify', () => {
  it('itemNo가 쇼트리스트에 없으면 404를 반환한다', async () => {
    mockGetShortlistItem.mockResolvedValueOnce(null);
    const res = await manualPOST(makeManualRequest({ itemNo: 999 }));
    expect(res.status).toBe(404);
    expect(mockVerifyOne).not.toHaveBeenCalled();
  });

  it('itemNo가 지정되면 그 1건만 검증한다 (listForVerify를 부르지 않는다)', async () => {
    mockGetShortlistItem.mockResolvedValueOnce({
      itemNo: 42,
      title: '테스트 상품',
      orderQty: 10,
      logisticsSize: 'xsmall',
    });
    mockVerifyOne.mockResolvedValueOnce(true);

    const res = await manualPOST(makeManualRequest({ itemNo: 42 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ verified: 1, skipped: 0, total: 1, remaining: 0 });
    expect(mockListForVerify).not.toHaveBeenCalled();
    expect(mockVerifyOne).toHaveBeenCalledWith(
      expect.objectContaining({ itemNo: 42, title: '테스트 상품' }),
    );
  });

  it('itemNo 없이 배치로 호출하면 verified·skipped 카운트가 맞는다', async () => {
    mockListForVerify.mockResolvedValueOnce([target(1), target(2), target(3), target(4)]);
    mockVerifyOne
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const res = await manualPOST(makeManualRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ verified: 3, skipped: 1, total: 4, remaining: 0 });
  });

  it('배치 도중 예외가 나면 500과 함께 이미 처리된 부분 진행 상황을 반환한다', async () => {
    mockListForVerify.mockResolvedValueOnce([target(1), target(2), target(3)]);
    mockVerifyOne
      .mockResolvedValueOnce(true) // 1번째: 저장됨
      .mockRejectedValueOnce(new Error('DB 커넥션 끊김')); // 2번째: 예상 밖 오류

    const res = await manualPOST(makeManualRequest({}));
    const body = await res.json();

    expect(res.status).toBe(500);
    // 1건은 이미 saveVerifyResult로 커밋됐으므로 verified에 반영되어야 한다.
    // "아무것도 안 됨"으로 보이면 사용자가 이미 끝난 항목을 다시 검증시키게 된다.
    expect(body.verified).toBe(1);
    expect(body.skipped).toBe(0);
    expect(body.total).toBe(3);
    expect(body.remaining).toBe(2);
    expect(body.error).toContain('이미 처리된 항목은 저장되었습니다');
  });

  it('데드라인 가드가 루프를 끊고 remaining을 옳게 계산한다', async () => {
    mockListForVerify.mockResolvedValueOnce([target(1), target(2), target(3)]);
    mockVerifyOne.mockResolvedValue(true);

    let call = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      call += 1;
      return call <= 2 ? 0 : 1_000_000;
    });

    const res = await manualPOST(makeManualRequest({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockVerifyOne).toHaveBeenCalledTimes(1);
    expect(body).toEqual({ verified: 1, skipped: 0, total: 3, remaining: 2 });
  });
});
