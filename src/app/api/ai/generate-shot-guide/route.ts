/**
 * POST /api/ai/generate-shot-guide
 * detail_closeup 슬롯(promptHint)들을 사람용 폰 촬영 지시(ShotCard[])로 변환.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { callClaude } from '@/lib/ai/claude-cli';
import { parseShotGuideResponse } from '@/lib/detail-page/shot-guide';

export const maxDuration = 60;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 5 };

const RequestSchema = z.object({
  productInfo: z.object({
    name: z.string().min(1).max(200),
    points: z.array(z.string().transform(s => s.slice(0, 200))).default([]).transform(a => a.slice(0, 30)),
    category: z.string().max(100).default(''),
  }),
  shots: z.array(z.object({
    sectionTitle: z.string().max(200),
    promptHint: z.string().max(600).default(''),
  })).min(1).max(20),
});

const SYSTEM = `당신은 이커머스 상품 상세페이지용 "실사 촬영 가이드" 코치입니다.
입력으로 각 컷의 섹션 제목과 AI 연출 지시문(promptHint)이 주어집니다. 각 컷을, 판매자가 스마트폰으로 직접 찍을 수 있는 구체적 촬영 지시로 변환하세요.

각 컷마다 아래 JSON 객체를 정확히 하나 만드세요:
{ "sectionTitle": 입력의 섹션 제목 그대로, "subject": 무엇을 찍을지(제품의 어느 부위·특징), "angle": 구도·각도, "framing": 프레이밍(접사/매크로/풀샷 등), "lighting": 조명, "background": 배경, "tip": 실전 팁 한두 줄 }

규칙:
- 개인이 폰으로 재현 가능한 지시만(매크로/접사, 자연광, 깔끔한 무지/원목 배경 등). 스튜디오 장비·모델·복잡한 세팅 요구 금지.
- 상품명/포인트/promptHint에 없는 특징을 지어내지 마세요.
- 한국어, 구체적·실전적. "특별한 순간" 같은 추상 클리셰 금지.
- 입력 컷 개수와 순서를 그대로 1:1 유지.
- 출력은 JSON 배열만. 설명·코드펜스 없이: [ {...}, {...} ]`;

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'generate-shot-guide'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: '요청 형식이 올바르지 않습니다.', _debug: parsed.error.issues[0]?.message },
      { status: 400 }
    );
  }

  const { productInfo, shots } = parsed.data;
  const userPrompt = [
    `상품명: ${productInfo.name}`,
    productInfo.category ? `카테고리: ${productInfo.category}` : '',
    productInfo.points.length ? `핵심 포인트:\n${productInfo.points.map(p => `- ${p}`).join('\n')}` : '',
    '',
    '변환할 컷 목록:',
    ...shots.map((s, i) => `${i + 1}. [섹션: ${s.sectionTitle}] 연출지시: ${s.promptHint}`),
  ].filter(Boolean).join('\n');

  try {
    const raw = await callClaude(SYSTEM, userPrompt, 'sonnet', 4096);
    const cards = parseShotGuideResponse(raw);
    if (cards.length === 0) {
      return NextResponse.json({ success: false, error: '가이드 생성에 실패했습니다. 다시 시도해주세요.' }, { status: 502 });
    }
    return NextResponse.json({ success: true, data: { shots: cards } });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: '가이드 생성 중 오류가 발생했습니다.', _debug: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
