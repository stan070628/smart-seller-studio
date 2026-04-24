import { NextRequest, NextResponse } from 'next/server';
import { mapProductToCoupangFields } from '@/lib/auto-register/ai-field-mapper';
import type { NormalizedProduct } from '@/lib/auto-register/types';

export async function POST(req: NextRequest) {
  // 요청 body 파싱
  const body = await req.json().catch(() => null) as { product?: NormalizedProduct } | null;
  if (!body?.product) {
    return NextResponse.json(
      { error: 'product 데이터가 필요합니다.' },
      { status: 400 },
    );
  }

  // 10초 타임아웃
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('TIMEOUT')), 10_000),
  );

  try {
    const fields = await Promise.race([
      mapProductToCoupangFields(body.product),
      timeoutPromise,
    ]);
    return NextResponse.json({ fields });
  } catch (err) {
    if (err instanceof Error && err.message === 'TIMEOUT') {
      // 타임아웃 시 빈 필드 반환 — UI가 빈 wizard로 진입
      return NextResponse.json({ fields: null, timedOut: true });
    }
    return NextResponse.json(
      { error: 'AI 매핑 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
