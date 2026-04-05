/**
 * POST /api/auth/login
 *
 * 이메일/비밀번호로 로그인하고 JWT 쿠키를 발급합니다.
 * - 존재하지 않는 이메일이거나 비밀번호 불일치 시 401
 * - 성공 시 httpOnly 쿠키 설정
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  findUserByEmail,
  verifyPassword,
  createToken,
  COOKIE_NAME,
} from '@/lib/auth';

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
  if (typeof password !== 'string' || password.length === 0) {
    return NextResponse.json(
      { error: '비밀번호를 입력해주세요.' },
      { status: 400 }
    );
  }

  try {
    // 사용자 조회
    const user = await findUserByEmail(email);

    // 존재하지 않는 이메일과 비밀번호 불일치를 같은 메시지로 처리하여 사용자 열거 공격 방어
    if (!user) {
      return NextResponse.json(
        { error: '이메일 또는 비밀번호가 올바르지 않습니다.' },
        { status: 401 }
      );
    }

    const passwordMatch = await verifyPassword(password, user.password_hash);
    if (!passwordMatch) {
      return NextResponse.json(
        { error: '이메일 또는 비밀번호가 올바르지 않습니다.' },
        { status: 401 }
      );
    }

    // 토큰 발급
    const token = await createToken(user.id, user.email);

    const response = NextResponse.json(
      { success: true, user: { id: user.id, email: user.email } },
      { status: 200 }
    );

    // httpOnly 쿠키 설정
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    });

    return response;
  } catch (err) {
    console.error('[login] 로그인 오류:', err);
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.' },
      { status: 500 }
    );
  }
}
