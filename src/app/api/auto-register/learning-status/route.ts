import { NextRequest, NextResponse } from 'next/server';
import { getAutoModeStatus } from '@/lib/auto-register/learning-engine';
import type { SourceType } from '@/lib/auto-register/types';

export async function GET(req: NextRequest) {
  const sourceType = req.nextUrl.searchParams.get('sourceType') as SourceType | null;

  // sourceType 검증: domeggook 또는 costco여야 함
  if (sourceType !== 'domeggook' && sourceType !== 'costco') {
    return NextResponse.json(
      { error: 'sourceType은 domeggook 또는 costco여야 합니다.' },
      { status: 400 }
    );
  }

  const status = await getAutoModeStatus(sourceType);
  return NextResponse.json({ status });
}
