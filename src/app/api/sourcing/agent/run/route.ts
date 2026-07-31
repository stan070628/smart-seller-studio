/**
 * POST /api/sourcing/agent/run
 * 발굴 탭에서 선택한 키워드를 파이프라인에 태운다.
 *
 * 텔레그램 웹훅과 같은 엔진(runKeywordPipeline)을 쓰되 실행 경로만 웹으로 연다.
 * 결과는 keyword_requests / keyword_results에 쌓이고, pass 판정은 shortlist로 간다.
 *
 * 시드를 전량 자동 투입하지 않는 설계이므로 크론 진입점(GET)은 두지 않는다.
 */

import { after } from 'next/server';
import { runKeywordPipeline } from '@/lib/sourcing-agent/keyword-pipeline';

export const maxDuration = 60;

/** 한 번에 받을 수 있는 키워드 수. API 호출량과 실행 시간을 묶어 제한한다 */
const MAX_KEYWORDS = 10;

/** 웹 실행은 텔레그램 chat_id가 없으므로 빈 문자열을 넘긴다 */
const NO_TELEGRAM_CHAT = '';

export async function POST(request: Request) {
  let payload: { keywords?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ success: false, error: '잘못된 요청 형식입니다.' }, { status: 400 });
  }

  const raw = Array.isArray(payload.keywords) ? payload.keywords : [];
  const keywords = raw
    .filter((k): k is string => typeof k === 'string')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  if (keywords.length === 0) {
    return Response.json({ success: false, error: '키워드를 하나 이상 지정하세요.' }, { status: 400 });
  }

  if (keywords.length > MAX_KEYWORDS) {
    return Response.json(
      { success: false, error: `한 번에 최대 ${MAX_KEYWORDS}개까지 실행할 수 있습니다.` },
      { status: 400 },
    );
  }

  // 응답을 먼저 돌려주고 백그라운드에서 순차 실행한다.
  // 동시 실행하면 네이버·도매꾹 API에 순간 부하가 몰린다.
  after(
    (async () => {
      for (const kw of keywords) {
        try {
          await runKeywordPipeline(kw, NO_TELEGRAM_CHAT);
        } catch (err) {
          console.error('[api/sourcing/agent/run] 파이프라인 실패:', kw, err);
        }
      }
    })(),
  );

  return Response.json({ success: true, data: { accepted: keywords.length } });
}
