import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { runKeywordPipeline } from '@/lib/sourcing-agent/keyword-pipeline';

// Vercel Serverless 최대 실행 시간 (초)
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // Telegram webhook secret 검증
  const secret = req.headers.get('x-telegram-bot-api-secret-token');
  if (process.env.TELEGRAM_WEBHOOK_SECRET && secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // 요청 본문 파싱 실패는 무시 (Telegram은 재전송하지 않도록 200 반환)
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const message = (body as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
  const text = message?.text as string | undefined;
  const chatId = (message?.chat as Record<string, unknown>)?.id;

  // 텍스트 메시지가 아니면 무시
  if (!text || !chatId) {
    return NextResponse.json({ ok: true });
  }

  const keyword = text.trim();
  const chatIdStr = String(chatId);

  // 200 즉시 반환 후 백그라운드에서 파이프라인 실행
  after(runKeywordPipeline(keyword, chatIdStr));

  return NextResponse.json({ ok: true });
}
