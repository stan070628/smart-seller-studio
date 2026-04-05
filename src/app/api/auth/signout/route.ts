/**
 * POST /api/auth/signout
 *
 * auth_token 쿠키를 삭제하고 /login으로 리다이렉트합니다.
 */

import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';

export async function POST(): Promise<NextResponse> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

  // POST 후 GET 리다이렉트는 303 See Other 사용
  const response = NextResponse.redirect(new URL('/login', siteUrl), {
    status: 303,
  });

  // maxAge=0으로 쿠키 즉시 만료
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });

  return response;
}
