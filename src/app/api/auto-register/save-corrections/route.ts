import { NextRequest, NextResponse } from 'next/server';
import { saveCorrections } from '@/lib/auto-register/learning-engine';
import type { FieldCorrection } from '@/lib/auto-register/types';

export async function POST(req: NextRequest) {
  // 요청 본문 파싱 (파싱 실패 시 null 반환)
  const body = (await req.json().catch(() => null)) as { corrections?: FieldCorrection[] } | null;

  // corrections 배열 검증
  if (!body?.corrections || !Array.isArray(body.corrections)) {
    return NextResponse.json(
      { error: 'corrections 배열이 필요합니다.' },
      { status: 400 }
    );
  }

  // 학습 엔진에 수정사항 저장
  await saveCorrections(body.corrections);

  return NextResponse.json({ ok: true });
}
