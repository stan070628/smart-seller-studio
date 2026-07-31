/**
 * POST /api/sourcing/shortlist/verify
 * 쇼트리스트 후보 수동 재검증.
 *
 * body: { itemNo?: number }
 *   - itemNo 지정 시 그 1건만 검증한다. 쇼트리스트에 없으면 404.
 *   - 미지정 시 verified_at이 오래된 것부터 최대 MANUAL_VERIFY_LIMIT건을 검증한다
 *     (1회 요청이 무한정 길어지는 것을 막는 타임아웃 방어).
 *
 * 사용자가 버튼을 눌러 직접 호출하는 엔드포인트라 POST다. Vercel Cron이 아니므로
 * GET일 필요가 없다 — 매일 자동 재검증은 /api/sourcing/cron/shortlist-verify가 맡는다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listForVerify, getShortlistItem } from '@/lib/sourcing/shortlist-db';
import {
  verifyOne,
  delay,
  NAVER_CALL_DELAY_MS,
  DEADLINE_SAFETY_MARGIN_MS,
  type VerifyTarget,
  type ShortlistVerifyResult,
} from '@/lib/sourcing/shortlist-verify';

export const maxDuration = 300;

/** 1회 요청 상한. naver-prices류 라우트의 limit 관례(기본 50)를 그대로 따른다. */
const MANUAL_VERIFY_LIMIT = 50;

const bodySchema = z.object({
  itemNo: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  const rawBody = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { itemNo } = parsed.data;

  let targets: VerifyTarget[];

  if (itemNo !== undefined) {
    const item = await getShortlistItem(itemNo);
    if (!item) {
      return NextResponse.json(
        { error: `쇼트리스트에 없는 상품번호입니다: ${itemNo}` },
        { status: 404 },
      );
    }
    targets = [
      {
        itemNo: item.itemNo,
        title: item.title,
        orderQty: item.orderQty,
        logisticsSize: item.logisticsSize,
      },
    ];
  } else {
    targets = await listForVerify(MANUAL_VERIFY_LIMIT);
  }

  const startedAt = Date.now();
  const hardDeadlineMs = maxDuration * 1_000 - DEADLINE_SAFETY_MARGIN_MS;
  const total = targets.length;

  // verified : 실제로 검증되어 저장된 건수
  // skipped  : verifyOne이 false를 반환한 건수 — 실패가 아니라 "이번엔 건너뜀,
  //            다음 cron이 재시도"다(도매꾹 일시 오류). 에러로 집계하지 않는다.
  // remaining: 데드라인 때문에 이번 요청에서 아예 손도 못 댄 건수. skipped와 달리
  //            verifyOne을 호출조차 하지 않았다 — 남은 건 그대로 verified_at이
  //            안 갱신되므로 다음 수동 호출이나 cron이 오래된 순서 그대로 이어받는다.
  //
  // 이 세 카운터를 try 밖에서 선언하는 이유: verifyOne은 건별로 saveVerifyResult를
  // 커밋한다. 50건 중 38번째에서 예외가 나도 앞의 37건은 이미 저장돼 있는데,
  // catch에서 이 카운터를 못 돌려주면 응답은 "아무것도 안 됨"처럼 보인다.
  // 그러면 사용자가 이미 끝난 절반을 다시 검증시키게 된다.
  let verified = 0;
  let skipped = 0;
  let processed = 0;

  // verifyOne은 도매꾹 일시 오류(DomeTransientError)를 내부에서 이미 잡아 false로
  // 바꿔 돌려주므로(shortlist-verify.ts), 여기서 다시 잡을 필요가 없다. 이 catch는
  // 그 외의 예상 밖 오류(DB 오류 등)만을 위한 것이다.
  try {
    for (const target of targets) {
      if (Date.now() - startedAt >= hardDeadlineMs) {
        console.warn(
          `[shortlist/verify] deadline 도달, 조기 종료 (처리=${processed}/${total})`,
        );
        break;
      }

      const ok = await verifyOne(target);
      if (ok) verified++;
      else skipped++;

      processed++;
      if (targets.length > 1) await delay(NAVER_CALL_DELAY_MS);
    }
  } catch (err) {
    console.error(`[shortlist/verify] 재검증 실패 (${processed}/${total} 처리됨)`, err);
    // 부분 진행 상황을 ShortlistVerifyResult 필드 그대로 함께 반환한다 — verifyOne이
    // 건별로 커밋하므로 이 시점에 verified·skipped는 이미 저장된 실제 결과다.
    // 이걸 버리고 error만 돌려주면 "38건 중 37건 완료"가 "전부 실패"로 보여
    // 사용자가 끝난 항목을 헛되이 다시 검증시키게 된다.
    const partial: Partial<ShortlistVerifyResult> & { error: string } = {
      error: '재검증 중 오류가 발생했습니다. 이미 처리된 항목은 저장되었습니다.',
      verified,
      skipped,
      remaining: total - processed,
      total,
    };
    return NextResponse.json(partial, { status: 500 });
  }

  const result: ShortlistVerifyResult = { verified, skipped, total, remaining: total - processed };
  return NextResponse.json(result);
}
