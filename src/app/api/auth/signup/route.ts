/**
 * POST /api/auth/signup
 *
 * 신규 사용자를 등록하고 JWT 쿠키를 발급합니다.
 * - 이메일 중복 체크
 * - 비밀번호 최소 6자 검증
 * - 성공 시 httpOnly 쿠키 설정
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUser, createToken, findUserByEmail, COOKIE_NAME } from '@/lib/auth';

// 쿠키 maxAge: 7일 (초 단위)
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: '요청 본문이 유효한 JSON이 아닙니다.' },
      { status: 400 }
    );
  }

  const { email, password } = body as Record<string, unknown>;

  // 입력값 기본 검증
  if (typeof email !== 'string' || !email.includes('@')) {
    return NextResponse.json(
      { error: '유효한 이메일을 입력해주세요.' },
      { status: 400 }
    );
  }
  if (typeof password !== 'string' || password.length < 6) {
    return NextResponse.json(
      { error: '비밀번호는 최소 6자 이상이어야 합니다.' },
      { status: 400 }
    );
  }

  try {
    // 이메일 중복 확인
    const existing = await findUserByEmail(email);
    if (existing) {
      return NextResponse.json(
        { error: '이미 가입된 이메일입니다. 로그인을 시도해주세요.' },
        { status: 409 }
      );
    }

    // 사용자 생성 및 토큰 발급
    const user = await createUser(email, password);
    const token = await createToken(user.id, user.email);

    const response = NextResponse.json(
      { success: true, user: { id: user.id, email: user.email } },
      { status: 201 }
    );

    // httpOnly 쿠키 설정 — JS에서 접근 불가하여 XSS 방어
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    });

    return response;
  } catch (err) {
    console.error('[signup] 회원가입 오류:', err);
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' },
      { status: 500 }
    );
  }
}
