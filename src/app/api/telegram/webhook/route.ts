import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { runKeywordPipeline } from '@/lib/sourcing-agent/keyword-pipeline';
import { extractMedia, saveTelegramMedia } from '@/lib/telegram/media';

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

  if (!chatId) {
    return NextResponse.json({ ok: true });
  }
  const chatIdStr = String(chatId);

  // 영상·사진은 Storage에 보관한다. 텍스트 파이프라인과 배타적으로 갈린다 —
  // 캡션이 달린 영상을 키워드로 오해해 소싱을 돌리면 안 된다.
  const media = extractMedia(message);
  if (media) {
    after(saveTelegramMedia(media, chatIdStr));
    return NextResponse.json({ ok: true });
  }

  // 텍스트도 미디어도 아니면 무시
  if (!text) {
    return NextResponse.json({ ok: true });
  }

  const keyword = text.trim();

  // 200 즉시 반환 후 백그라운드에서 파이프라인 실행
  after(runKeywordPipeline(keyword, chatIdStr));

  return NextResponse.json({ ok: true });
}
