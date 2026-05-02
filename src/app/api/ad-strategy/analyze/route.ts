import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { getAnthropicClient } from '@/lib/ai/claude';
import {
  AD_STRATEGY_SYSTEM_PROMPT,
  buildAdStrategyUserPrompt,
  parseAdStrategyResponse,
} from '@/lib/ad-strategy/analyzer-prompt';
import type { CollectedData, AdStrategyReport } from '@/lib/ad-strategy/types';

const FIXED_USER_ID = 'cheong-yeon';

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  let body: { data?: CollectedData };
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: '요청 본문 파싱 실패' }, { status: 400 });
  }

  if (!body.data) {
    return Response.json({ success: false, error: 'data 필드가 필요합니다.' }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const userPrompt = buildAdStrategyUserPrompt(body.data, today);

  try {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: AD_STRATEGY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText =
      response.content[0].type === 'text' ? response.content[0].text : '';
    const report: AdStrategyReport = parseAdStrategyResponse(rawText);

    // 리포트 캐시 저장 (동일 수집 시점 행 업데이트)
    const supabase = getSupabaseServerClient();
    await supabase
      .from('ad_strategy_cache')
      .update({ report_json: report })
      .eq('user_id', FIXED_USER_ID)
      .eq('collected_at', body.data.collectedAt);

    return Response.json({ success: true, report });
  } catch (err) {
    console.error('[ad-strategy/analyze]', err);
    const message = err instanceof Error ? err.message : 'AI 분석 실패';
    return Response.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
