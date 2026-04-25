import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { saveCorrections } from '@/lib/auto-register/learning-engine';
import type { FieldCorrection } from '@/lib/auto-register/types';

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { corrections?: FieldCorrection[] } | null;

  if (!body?.corrections || !Array.isArray(body.corrections)) {
    return NextResponse.json(
      { error: 'corrections 배열이 필요합니다.' },
      { status: 400 }
    );
  }

  try {
    await saveCorrections(body.corrections);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: '수정사항 저장 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
