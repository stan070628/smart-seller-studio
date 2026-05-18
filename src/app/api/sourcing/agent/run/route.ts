import { NextRequest, NextResponse } from 'next/server';
import { runSourcingAgentPipeline } from '@/lib/sourcing-agent/pipeline';

// Vercel 크론/수동 실행 모두 지원 — 최대 실행 시간 5분
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // Authorization 헤더가 있으면 CRON_SECRET 검증 (Vercel cron 자동 호출용)
  // 헤더가 없으면 UI에서의 수동 실행으로 허용
  const authHeader = req.headers.get('authorization');
  if (authHeader) {
    const secret = authHeader.replace('Bearer ', '');
    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const body = await req.json().catch(() => ({}));
    const categoryId = typeof body.categoryId === 'number' ? body.categoryId : undefined;

    const result = await runSourcingAgentPipeline({ categoryId });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
