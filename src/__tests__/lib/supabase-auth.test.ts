/**
 * supabase-auth.test.ts
 * src/lib/supabase/auth.ts 의 verifyAuth, requireAuth 단위 테스트
 *
 * 실제 Supabase 호출 없이 getSupabaseServerClient 를 vi.mock 으로 대체합니다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Supabase 서버 클라이언트 Mock
// ---------------------------------------------------------------------------

// getUser mock 함수를 모듈 레벨에서 선언하되,
// getSupabaseServerClient 는 매 호출마다 이 함수를 참조하는 새 객체를 반환합니다.
const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  // factory 함수로 감싸지 않고, 항상 동일한 mockGetUser 를 참조하도록 구성
  getSupabaseServerClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}));

// ---------------------------------------------------------------------------
// 테스트 대상 import (mock 설정 이후)
// ---------------------------------------------------------------------------

import { verifyAuth, requireAuth } from '@/lib/supabase/auth';

// ---------------------------------------------------------------------------
// 헬퍼: NextRequest 생성
// ---------------------------------------------------------------------------

function makeRequest(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) {
    headers['Authorization'] = authHeader;
  }
  return new NextRequest('http://localhost:3000/api/test', {
    method: 'GET',
    headers,
  });
}

// ---------------------------------------------------------------------------
// verifyAuth 테스트 (6개)
// ---------------------------------------------------------------------------

describe('verifyAuth', () => {
  beforeEach(() => {
    // vi.clearAllMocks() 는 mockOnce 큐를 비우지 않으므로
    // mockReset() 으로 구현체(큐 포함) 까지 완전히 초기화합니다.
    mockGetUser.mockReset();
  });

  // ── 테스트 1 ──────────────────────────────────────────────────────────────
  it('유효한 Bearer 토큰 → { userId, email } 반환', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'user-abc', email: 'test@example.com' } },
      error: null,
    });

    const request = makeRequest('Bearer valid-token-123');
    const result = await verifyAuth(request);

    expect(result).not.toBeNull();
    expect(result!.userId).toBe('user-abc');
    expect(result!.email).toBe('test@example.com');
    expect(mockGetUser).toHaveBeenCalledOnce();
    expect(mockGetUser).toHaveBeenCalledWith('valid-token-123');
  });

  // ── 테스트 2 ──────────────────────────────────────────────────────────────
  it('Authorization 헤더 없음 → null 반환', async () => {
    const request = makeRequest(); // Authorization 헤더 미포함
    const result = await verifyAuth(request);

    expect(result).toBeNull();
    // getUser 는 호출되지 않아야 함
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  // ── 테스트 3 ──────────────────────────────────────────────────────────────
  it('Bearer 형식이 아닌 헤더 → null 반환', async () => {
    // "Basic ..." 또는 "Token ..." 등 Bearer 로 시작하지 않는 경우
    const request = makeRequest('Basic dXNlcjpwYXNz');
    const result = await verifyAuth(request);

    expect(result).toBeNull();
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  // ── 테스트 4 ──────────────────────────────────────────────────────────────
  it('빈 토큰 (Bearer 뒤에 공백만) → null 반환', async () => {
    // "Bearer " 이후 실제 토큰이 없거나 공백만 있는 경우
    // auth.ts 의 구현: authHeader.slice(7) → 빈 문자열 또는 공백
    // getUser('') 는 Supabase 에러를 반환할 것이므로 → null
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Invalid JWT' },
    });

    const request = makeRequest('Bearer ');
    const result = await verifyAuth(request);

    // token 이 빈 문자열이므로 getUser 를 호출해도 에러/null user → null 반환
    expect(result).toBeNull();
  });

  // ── 테스트 5 ──────────────────────────────────────────────────────────────
  it('Supabase getUser 가 error 반환 시 → null 반환', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'JWT expired', status: 401 },
    });

    const request = makeRequest('Bearer expired-token');
    const result = await verifyAuth(request);

    expect(result).toBeNull();
    expect(mockGetUser).toHaveBeenCalledOnce();
  });

  // ── 테스트 6 ──────────────────────────────────────────────────────────────
  it('Supabase getUser user 가 null 일 때 → null 반환', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    const request = makeRequest('Bearer valid-but-revoked-token');
    const result = await verifyAuth(request);

    expect(result).toBeNull();
    expect(mockGetUser).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// requireAuth 테스트 (3개)
// ---------------------------------------------------------------------------

describe('requireAuth', () => {
  beforeEach(() => {
    // mockOnce 큐까지 포함해 완전히 초기화
    mockGetUser.mockReset();
  });

  // ── 테스트 1 ──────────────────────────────────────────────────────────────
  it('유효한 토큰 → AuthResult 반환 (Response 아님)', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'user-xyz', email: 'user@example.com' } },
      error: null,
    });

    const request = makeRequest('Bearer good-token');
    const result = await requireAuth(request);

    // Response 인스턴스가 아니어야 함
    expect(result).not.toBeInstanceOf(Response);
    // AuthResult 구조 확인
    const auth = result as { userId: string; email?: string };
    expect(auth.userId).toBe('user-xyz');
    expect(auth.email).toBe('user@example.com');
  });

  // ── 테스트 2 ──────────────────────────────────────────────────────────────
  it('인증 실패 → Response 인스턴스 반환, status 401', async () => {
    // Authorization 헤더 없음 → verifyAuth 가 null 반환 → requireAuth 가 401 Response 반환
    const request = makeRequest();
    const result = await requireAuth(request);

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);

    // 응답 본문에 에러 정보가 포함되어야 함
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBeTruthy();
    expect(body.code).toBe('UNAUTHORIZED');
  });

  // ── 테스트 3 ──────────────────────────────────────────────────────────────
  it('반환값이 instanceof Response 로 타입 분기 가능한지 확인', async () => {
    // 인증 성공 케이스
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'user-ok', email: 'ok@example.com' } },
      error: null,
    });
    const successRequest = makeRequest('Bearer success-token');
    const successResult = await requireAuth(successRequest);

    // instanceof Response → false (AuthResult)
    expect(successResult instanceof Response).toBe(false);
    if (!(successResult instanceof Response)) {
      // 타입 가드 이후 AuthResult 로 사용 가능
      expect(successResult.userId).toBe('user-ok');
    }

    // 인증 실패 케이스
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'invalid token' },
    });
    const failRequest = makeRequest('Bearer bad-token');
    const failResult = await requireAuth(failRequest);

    // instanceof Response → true (401 Response)
    expect(failResult instanceof Response).toBe(true);
    if (failResult instanceof Response) {
      expect(failResult.status).toBe(401);
    }
  });
});
