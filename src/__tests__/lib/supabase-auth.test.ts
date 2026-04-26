/**
 * supabase-auth.test.ts
 * src/lib/supabase/auth.ts 의 verifyAuth, requireAuth 단위 테스트
 *
 * 실제 getCurrentUser 호출 없이 @/lib/auth 를 vi.mock 으로 대체합니다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// @/lib/auth Mock — getCurrentUser 반환값을 테스트마다 제어합니다.
// vi.mock 은 파일 최상단으로 호이스팅되므로, mock 함수는 vi.hoisted 로 먼저 선언합니다.
// ---------------------------------------------------------------------------

const { mockGetCurrentUser } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getCurrentUser: mockGetCurrentUser,
}));

// ---------------------------------------------------------------------------
// 테스트 대상 import (mock 설정 이후)
// ---------------------------------------------------------------------------

import { verifyAuth, requireAuth } from '@/lib/supabase/auth';

// ---------------------------------------------------------------------------
// verifyAuth 테스트 (4개)
// ---------------------------------------------------------------------------

describe('verifyAuth', () => {
  beforeEach(() => {
    // mockOnce 큐까지 포함해 완전히 초기화합니다.
    mockGetCurrentUser.mockReset();
  });

  // ── 테스트 1 ──────────────────────────────────────────────────────────────
  it('getCurrentUser가 null을 반환하면 verifyAuth도 null을 반환한다', async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);

    const result = await verifyAuth();

    expect(result).toBeNull();
    expect(mockGetCurrentUser).toHaveBeenCalledOnce();
  });

  // ── 테스트 2 ──────────────────────────────────────────────────────────────
  it('getCurrentUser가 userId와 email을 반환하면 동일한 AuthResult를 반환한다', async () => {
    mockGetCurrentUser.mockResolvedValueOnce({
      userId: 'u1',
      email: 'a@a.com',
    });

    const result = await verifyAuth();

    expect(result).not.toBeNull();
    expect(result!.userId).toBe('u1');
    expect(result!.email).toBe('a@a.com');
  });

  // ── 테스트 3 ──────────────────────────────────────────────────────────────
  it('getCurrentUser가 email 없이 userId만 반환하면 email은 undefined이다', async () => {
    // getCurrentUser 반환 타입은 { userId: string; email: string } | null 이지만,
    // AuthResult의 email은 optional이므로 email 필드가 없는 경우도 방어적으로 검증합니다.
    mockGetCurrentUser.mockResolvedValueOnce({
      userId: 'u1',
    });

    const result = await verifyAuth();

    expect(result).not.toBeNull();
    expect(result!.userId).toBe('u1');
    expect(result!.email).toBeUndefined();
  });

  // ── 테스트 4 ──────────────────────────────────────────────────────────────
  it('request 인자 없이 호출해도 동작한다 (인자는 무시됨)', async () => {
    mockGetCurrentUser.mockResolvedValueOnce({
      userId: 'u2',
      email: 'b@b.com',
    });

    // _request 파라미터는 현재 구현에서 무시되므로 인자 없이 호출
    const result = await verifyAuth();

    expect(result).not.toBeNull();
    expect(result!.userId).toBe('u2');
    expect(result!.email).toBe('b@b.com');
  });
});

// ---------------------------------------------------------------------------
// requireAuth 테스트 (3개)
// ---------------------------------------------------------------------------

describe('requireAuth', () => {
  beforeEach(() => {
    // mockOnce 큐까지 포함해 완전히 초기화합니다.
    mockGetCurrentUser.mockReset();
  });

  // ── 테스트 1 ──────────────────────────────────────────────────────────────
  it('getCurrentUser가 null이면 status 401 Response를 반환한다', async () => {
    mockGetCurrentUser.mockResolvedValueOnce(null);

    const result = await requireAuth();

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);

    // 응답 본문에 에러 정보가 포함되어야 합니다.
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });

  // ── 테스트 2 ──────────────────────────────────────────────────────────────
  it('getCurrentUser가 유저를 반환하면 Response가 아닌 AuthResult를 반환한다', async () => {
    mockGetCurrentUser.mockResolvedValueOnce({
      userId: 'user-xyz',
      email: 'user@example.com',
    });

    const result = await requireAuth();

    // Response 인스턴스가 아니어야 합니다.
    expect(result).not.toBeInstanceOf(Response);
    const auth = result as { userId: string; email?: string };
    expect(auth.userId).toBe('user-xyz');
    expect(auth.email).toBe('user@example.com');
  });

  // ── 테스트 3 ──────────────────────────────────────────────────────────────
  it('반환값이 instanceof Response로 타입 분기 가능한지 확인한다', async () => {
    // 인증 성공 케이스
    mockGetCurrentUser.mockResolvedValueOnce({
      userId: 'user-ok',
      email: 'ok@example.com',
    });

    const successResult = await requireAuth();

    // instanceof Response → false (AuthResult)
    expect(successResult instanceof Response).toBe(false);
    if (!(successResult instanceof Response)) {
      // 타입 가드 이후 AuthResult 로 사용 가능합니다.
      expect(successResult.userId).toBe('user-ok');
    }

    // 인증 실패 케이스
    mockGetCurrentUser.mockResolvedValueOnce(null);

    const failResult = await requireAuth();

    // instanceof Response → true (401 Response)
    expect(failResult instanceof Response).toBe(true);
    if (failResult instanceof Response) {
      expect(failResult.status).toBe(401);
    }
  });
});
