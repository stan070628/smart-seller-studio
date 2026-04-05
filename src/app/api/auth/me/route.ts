/**
 * GET /api/auth/me
 *
 * 현재 로그인 사용자 정보를 반환합니다.
 * - 쿠키의 JWT를 검증하여 사용자 조회
 * - 미인증 시 401
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: '인증이 필요합니다.' },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { success: true, user: { id: user.userId, email: user.email } },
      { status: 200 }
    );
  } catch (err) {
    console.error('[me] 사용자 조회 오류:', err);
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
