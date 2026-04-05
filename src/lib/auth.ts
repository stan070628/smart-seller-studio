/**
 * 자체 인증 라이브러리
 *
 * Supabase Auth를 대체하며 Render PostgreSQL + JWT 쿠키 기반으로 동작합니다.
 * - bcryptjs: 비밀번호 해시/검증
 * - jose: JWT 생성/검증
 * - getSourcingPool: Render PostgreSQL 커넥션 풀
 */

import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { getSourcingPool } from '@/lib/sourcing/db';

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'fallback-secret-change-me'
);
const TOKEN_EXPIRY = '7d';
export const COOKIE_NAME = 'auth_token';
const BCRYPT_ROUNDS = 12;

// ─────────────────────────────────────────
// 타입
// ─────────────────────────────────────────

interface JwtPayload {
  userId: string;
  email: string;
}

interface DbUser {
  id: string;
  email: string;
  password_hash: string;
}

// ─────────────────────────────────────────
// 비밀번호 해시
// ─────────────────────────────────────────

/**
 * 평문 비밀번호를 bcrypt로 해시합니다.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * 평문 비밀번호와 저장된 해시를 비교합니다.
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ─────────────────────────────────────────
// JWT 생성/검증
// ─────────────────────────────────────────

/**
 * userId, email을 담은 서명된 JWT를 생성합니다. (유효기간 7일)
 */
export async function createToken(
  userId: string,
  email: string
): Promise<string> {
  return new SignJWT({ userId, email } satisfies JwtPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(JWT_SECRET);
}

/**
 * JWT를 검증하고 페이로드를 반환합니다. 유효하지 않으면 null을 반환합니다.
 */
export async function verifyToken(
  token: string
): Promise<{ userId: string; email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const { userId, email } = payload as unknown as JwtPayload;
    if (typeof userId !== 'string' || typeof email !== 'string') return null;
    return { userId, email };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────
// DB 조회
// ─────────────────────────────────────────

/**
 * 이메일로 사용자를 조회합니다. 없으면 null을 반환합니다.
 */
export async function findUserByEmail(
  email: string
): Promise<DbUser | null> {
  const pool = getSourcingPool();
  const result = await pool.query<DbUser>(
    'SELECT id, email, password_hash FROM auth_users WHERE email = $1 LIMIT 1',
    [email.toLowerCase().trim()]
  );
  return result.rows[0] ?? null;
}

/**
 * 새 사용자를 생성하고 생성된 id, email을 반환합니다.
 * 이메일이 이미 존재하면 에러를 throw합니다.
 */
export async function createUser(
  email: string,
  password: string
): Promise<{ id: string; email: string }> {
  const pool = getSourcingPool();
  const passwordHash = await hashPassword(password);
  const normalizedEmail = email.toLowerCase().trim();

  const result = await pool.query<{ id: string; email: string }>(
    `INSERT INTO auth_users (email, password_hash)
     VALUES ($1, $2)
     RETURNING id, email`,
    [normalizedEmail, passwordHash]
  );
  return result.rows[0];
}

// ─────────────────────────────────────────
// 현재 사용자 조회 (서버 컴포넌트 / API Route용)
// ─────────────────────────────────────────

/**
 * 요청 쿠키에서 auth_token을 읽고 현재 로그인 사용자를 반환합니다.
 * 미인증이거나 토큰이 만료된 경우 null을 반환합니다.
 *
 * 서버 컴포넌트 및 Route Handler에서만 호출 가능합니다.
 */
export async function getCurrentUser(): Promise<{
  userId: string;
  email: string;
} | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
}
