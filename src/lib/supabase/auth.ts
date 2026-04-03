/**
 * Supabase Auth 유틸리티 (API Route 전용)
 * 개인 사용 모드: 인증 없이 고정 userId 반환
 */

import { NextRequest } from "next/server";

// ─────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────

export interface AuthResult {
  userId: string;
  email?: string;
}

// 개인 사용자 고정 ID (Supabase DB user_id 컬럼에 저장될 값)
const OWNER_USER_ID = "00000000-0000-0000-0000-000000000001"

/**
 * 인증 없이 고정 userId 반환 (개인 사용 모드)
 */
export async function verifyAuth(
  _request: NextRequest
): Promise<AuthResult | null> {
  return { userId: OWNER_USER_ID }
}

/**
 * 인증 없이 고정 userId 반환 (개인 사용 모드)
 */
export async function requireAuth(
  _request: NextRequest
): Promise<AuthResult | Response> {
  return { userId: OWNER_USER_ID }
}
