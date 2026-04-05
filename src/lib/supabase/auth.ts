/**
 * Auth 유틸리티 (서버 컴포넌트 / API Route 전용)
 *
 * 기존 Supabase Auth를 제거하고 자체 JWT 인증(@/lib/auth)으로 교체.
 * - verifyAuth: 현재 로그인 사용자를 반환 (없으면 null)
 * - requireAuth: 로그인 필수 엔드포인트에서 사용, 미인증 시 401 Response 반환
 */

import { getCurrentUser } from '@/lib/auth';
import type { NextRequest } from 'next/server';

// ─────────────────────────────────────────
// 타입
// ─────────────────────────────────────────

export interface AuthResult {
  userId: string;
  email?: string;
}

// ─────────────────────────────────────────
// 공개 API
// ─────────────────────────────────────────

/**
 * 현재 요청의 쿠키에서 JWT를 검증하여 사용자 정보를 조회합니다.
 *
 * @param _request - 하위 호환성을 위해 수용하지만 실제로는 사용하지 않음
 *                   (토큰은 cookies()로 직접 읽음)
 * @returns 인증된 사용자 정보, 미인증 시 null
 */
export async function verifyAuth(
  _request?: NextRequest
): Promise<AuthResult | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return { userId: user.userId, email: user.email };
}

/**
 * 인증이 필수인 API Route에서 사용합니다.
 * 인증되지 않은 경우 401 JSON Response를 반환합니다.
 *
 * @param _request - 하위 호환성을 위해 수용하지만 실제로는 사용하지 않음
 * @example
 * const authResult = await requireAuth(request);
 * if (authResult instanceof Response) return authResult;
 * const { userId } = authResult;
 */
export async function requireAuth(
  _request?: NextRequest
): Promise<AuthResult | Response> {
  const auth = await verifyAuth();
  if (!auth) {
    return Response.json(
      { error: '인증이 필요합니다. 로그인 후 다시 시도해주세요.' },
      { status: 401 }
    );
  }
  return auth;
}
