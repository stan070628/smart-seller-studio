import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { mapProductToCoupangFields } from '@/lib/auto-register/ai-field-mapper';
import type { NormalizedProduct } from '@/lib/auto-register/types';

const AI_MAP_TIMEOUT_MS = 10_000;

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  let body: { product?: NormalizedProduct } | null;
  try {
    body = await req.json() as { product?: NormalizedProduct };
  } catch {
    return NextResponse.json({ error: '유효한 JSON 형식이 아닙니다.' }, { status: 400 });
  }

  if (!body?.product) {
    return NextResponse.json(
      { error: 'product 데이터가 필요합니다.' },
      { status: 400 },
    );
  }

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('TIMEOUT')), AI_MAP_TIMEOUT_MS),
  );

  try {
    const fields = await Promise.race([
      mapProductToCoupangFields(body.product),
      timeoutPromise,
    ]);
    return NextResponse.json({ fields });
  } catch (err) {
    if (err instanceof Error && err.message === 'TIMEOUT') {
      return NextResponse.json({ fields: null, timedOut: true }, { status: 504 });
    }
    return NextResponse.json(
      { error: 'AI 매핑 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
