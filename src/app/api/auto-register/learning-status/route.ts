import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getAutoModeStatus } from '@/lib/auto-register/learning-engine';
import type { SourceType } from '@/lib/auto-register/types';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof Response) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const sourceType = req.nextUrl.searchParams.get('sourceType') as SourceType | null;

  if (sourceType !== 'domeggook' && sourceType !== 'costco') {
    return NextResponse.json(
      { error: 'sourceType은 domeggook 또는 costco여야 합니다.' },
      { status: 400 }
    );
  }

  try {
    const status = await getAutoModeStatus(sourceType);
    return NextResponse.json({ status });
  } catch {
    return NextResponse.json(
      { error: '학습 상태 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
