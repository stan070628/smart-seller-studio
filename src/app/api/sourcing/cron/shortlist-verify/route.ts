/**
 * GET /api/sourcing/cron/shortlist-verify
 * Vercel Cron: 쇼트리스트 후보 일일 자동 재검증
 *
 * vercel.json:
 *   { "path": "/api/sourcing/cron/shortlist-verify", "schedule": "0 16 * * *" }
 *   → KST 01:00 매일 실행 (UTC 16:00)
 *
 * Vercel Cron은 GET으로 호출한다. 커밋 c86f118e에서 POST만 export한 라우트가
 * 405로 튕기고 로그도 남기지 않은 채 3개월간 조용히 중단된 사고가 있었다
 * (costco_collection_logs의 trigger_type이 전부 'manual', 'cron' 0건으로 발견됨).
 * 그러니 이 라우트는 반드시 GET을 export해야 한다 — "상태를 바꾸니 POST가 맞다"는
 * 이유로 바꾸지 말 것. Vercel이 실제로 호출하는 메서드가 GET이다.
 *
 * 왜 필요한가: 도매꾹 상품은 예고 없이 판매종료·삭제된다. 2026-07-31 실측에서
 * 3개월 방치된 후보 10건 중 4건이 이미 죽어 있었다.
 *
 * 인증:
 *   - Authorization: Bearer {CRON_SECRET} 헤더 확인
 *   - CRON_SECRET 미설정 시 인증 생략 (개발 편의) — costco/cron/route.ts,
 *     costco/naver-prices/route.ts와 동일 관례. (naver-prices/route.ts의 헤더
 *     주석은 같은 관례를 문서화했지만 실제 구현이 빠져 있어 선례로 인용하지 않는다.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { listForVerify } from '@/lib/sourcing/shortlist-db';
import {
  verifyOne,
  delay,
  NAVER_CALL_DELAY_MS,
  DEADLINE_SAFETY_MARGIN_MS,
  type ShortlistVerifyResult,
} from '@/lib/sourcing/shortlist-verify';

export const maxDuration = 300;

/** 1회 실행 상한. 처리 못한 나머지는 verified_at ASC 정렬 덕에 다음 cron이 이어받는다. */
const CRON_VERIFY_LIMIT = 100;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // title을 여기서 함께 받으므로 건마다 getShortlistItem을 다시 부르지 않는다.
  const targets = await listForVerify(CRON_VERIFY_LIMIT);

  if (targets.length === 0) {
    console.log('[cron/shortlist-verify] 검증 대상 없음');
    const empty: ShortlistVerifyResult = { verified: 0, skipped: 0, failed: 0, total: 0, remaining: 0 };
    return NextResponse.json(empty);
  }

  const startedAt = Date.now();
  const hardDeadlineMs = maxDuration * 1_000 - DEADLINE_SAFETY_MARGIN_MS;

  // verified: 실제로 검증되어 저장된 건수
  // skipped : verifyOne이 false를 반환한 건수 — 실패가 아니라 "이번엔 건너뜀,
  //           다음 cron이 재시도"다(도매꾹 일시 오류). 실패로 집계하지 않는다.
  // failed  : verifyOne 자체가 예외를 던진 건수(예상 밖 오류). 1건 실패가 나머지를
  //           막지 않도록 개별 try/catch로 격리한다.
  let verified = 0;
  let skipped = 0;
  let failed = 0;
  let processed = 0;

  for (const target of targets) {
    if (Date.now() - startedAt >= hardDeadlineMs) {
      console.warn(
        `[cron/shortlist-verify] deadline 도달, 조기 종료 (처리=${processed}/${targets.length})`,
      );
      break;
    }

    try {
      const ok = await verifyOne(target);
      if (ok) verified++;
      else skipped++;
    } catch (err) {
      console.error(`[cron/shortlist-verify] item_no=${target.itemNo} 검증 실패:`, err);
      failed++;
    }

    processed++;
    await delay(NAVER_CALL_DELAY_MS);
  }

  const remaining = targets.length - processed;

  console.log(
    `[cron/shortlist-verify] 완료: 대상=${targets.length}, 검증=${verified}, 스킵=${skipped}, ` +
      `실패=${failed}, 남음=${remaining}`,
  );

  const result: ShortlistVerifyResult = { verified, skipped, failed, total: targets.length, remaining };
  return NextResponse.json(result);
}
