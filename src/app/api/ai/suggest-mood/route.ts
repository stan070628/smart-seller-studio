import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { getAnthropicClient } from '@/lib/ai/claude';
import { loadReferenceImages } from '@/lib/ai/reference-images';
import { MOOD_PRESETS, parseSuggestedMoodIds } from '@/lib/detail-page/mood-presets';

export const maxDuration = 30;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 15 };

const RequestBodySchema = z.object({
  productImageUrls: z.array(z.string().url()).min(1).max(3),
  productName: z.string().max(300).optional(),
});

function buildSystemPrompt(): string {
  const catalog = MOOD_PRESETS.map(
    (p) => `- ${p.id}: ${p.label} (${p.keywords.join(', ')})`,
  ).join('\n');

  return `You are an e-commerce art director. Given product image(s) and an optional product name, pick the 2-3 mood presets from the catalog below that best fit the product's visual character and target customer.

Mood preset catalog (choose by id only):
${catalog}

Rules:
- Return ONLY ids that exist in the catalog above. Never invent new ids.
- Return 2 or 3 ids, ordered best-fit first.
- Return ONLY valid JSON: {"moodIds": ["id1", "id2"]}`;
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult as NextResponse;

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'suggest-mood'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429, headers: { 'X-RateLimit-Reset': rl.resetAt.toString() } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? '잘못된 요청' },
      { status: 400 },
    );
  }

  try {
    const referenceImages = await loadReferenceImages({
      productImageUrls: parsed.data.productImageUrls,
    });

    // 이미지 로딩이 전부 실패하면 Claude 호출(비용·지연)을 낭비하지 않고 즉시 반환
    if (referenceImages.length === 0) {
      return NextResponse.json(
        { success: false, error: '상품 이미지를 불러오지 못했습니다.' },
        { status: 422 },
      );
    }

    const client = getAnthropicClient();

    type ContentBlock =
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
      | { type: 'text'; text: string };

    const userContent: ContentBlock[] = [];
    for (const ref of referenceImages) {
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: ref.mimeType, data: ref.base64 },
      });
    }
    userContent.push({
      type: 'text',
      text: parsed.data.productName
        ? `Product name: ${parsed.data.productName}\nPick 2-3 best-fit mood ids. Return only JSON.`
        : 'Pick 2-3 best-fit mood ids. Return only JSON.',
    });

    const claudeRes = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      system: buildSystemPrompt(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: userContent as any }],
    });

    const rawText = claudeRes.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    const moodIds = parseSuggestedMoodIds(rawText, MOOD_PRESETS.map((p) => p.id));

    // 추천이 비면 카탈로그 앞 2개로 폴백 (UI가 항상 뭔가 보여주도록)
    const finalIds = moodIds.length > 0 ? moodIds : MOOD_PRESETS.slice(0, 2).map((p) => p.id);

    return NextResponse.json({ success: true, data: { moodIds: finalIds } });
  } catch (error) {
    console.error('[/api/ai/suggest-mood] 오류:', error);
    if (error instanceof Error && error.message.includes('ANTHROPIC_API_KEY')) {
      return NextResponse.json({ success: false, error: 'Claude API 키가 설정되지 않았습니다.' }, { status: 503 });
    }
    if (error instanceof Error && (error.message.includes('overloaded') || error.message.includes('quota') || error.message.includes('RESOURCE_EXHAUSTED'))) {
      return NextResponse.json({ success: false, error: 'AI 서비스가 일시적으로 과부하 상태입니다.' }, { status: 503 });
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '무드 추천에 실패했습니다.' },
      { status: 500 },
    );
  }
}
