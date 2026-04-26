/**
 * Next.js Proxy (구 middleware)
 *
 * 역할:
 * 1. JWT 쿠키(auth_token)로 인증 상태 확인
 * 2. 비로그인 상태에서 보호된 경로 접근 시 /login으로 리다이렉트
 * 3. 로그인 상태에서 /login 접근 시 /로 리다이렉트
 */

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'fallback-secret-change-me'
);
const COOKIE_NAME = 'auth_token';

/** 인증 없이 접근 가능한 공개 경로 prefix */
const PUBLIC_PREFIXES = ['/login', '/api/', '/_next/', '/favicon.ico'];

// ─────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// ─────────────────────────────────────────
// Proxy 함수
// ─────────────────────────────────────────

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get(COOKIE_NAME)?.value;
  let isAuthenticated = false;

  if (token) {
    try {
      await jwtVerify(token, JWT_SECRET);
      isAuthenticated = true;
    } catch {
      // 만료되거나 유효하지 않은 토큰 — 미인증으로 처리
    }
  }

  const isPublic = isPublicPath(pathname);

  // 로그인 상태에서 /login 접근 시 홈으로 리다이렉트
  if (isAuthenticated && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.nextUrl));
  }

  // 비로그인 상태에서 보호된 경로 접근 시 /login으로 리다이렉트
  if (!isAuthenticated && !isPublic) {
    const loginUrl = new URL('/login', request.nextUrl);
    loginUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// ─────────────────────────────────────────
// Matcher 설정
// ─────────────────────────────────────────

export const config = {
  matcher: [
    /*
     * 다음 경로를 제외한 모든 요청에 Proxy 적용:
     * - api/ (API 라우트 — body cloning 방지, 인증은 각 핸들러에서 처리)
     * - _next/static (정적 파일)
     * - _next/image (이미지 최적화)
     * - favicon.ico
     * - 이미지/폰트 파일 확장자
     */
    '/((?!api/|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)',
  ],
};
