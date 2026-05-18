import { NextRequest, NextResponse } from 'next/server';
import { runSourcingAgentPipeline } from '@/lib/sourcing-agent/pipeline';

// Vercel 크론/수동 실행 모두 지원 — 최대 실행 시간 5분
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // CRON_SECRET 헤더로 인증 (개발 환경에서는 생략)
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET && process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const categoryId = typeof body.categoryId === 'number' ? body.categoryId : undefined;

    const result = await runSourcingAgentPipeline({ categoryId });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
