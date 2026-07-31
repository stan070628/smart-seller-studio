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
import { verifyOne, type VerifyTarget } from '@/lib/sourcing/shortlist-verify';

export const maxDuration = 300;

/** 1회 요청 상한. naver-prices류 라우트의 limit 관례(기본 50)를 그대로 따른다. */
const MANUAL_VERIFY_LIMIT = 50;

/**
 * verifyOne 1건은 네이버 쇼핑 API를 최대 4회 호출한다(estimateCoupangPrice가
 * 상품명을 구간별로 쪼개 검색 — coupang-price.ts 참고). 여러 건을 배치로 돌릴 때는
 * 호출부가 페이싱을 넣어야 한다는 게 그 함수의 주석이 명시한 계약이고, 이 저장소의
 * 선례는 naver-prices/route.ts의 NAVER_CALL_DELAY_MS다. 같은 값을 쓴다.
 */
const NAVER_CALL_DELAY_MS = 200;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  // verified: 실제로 검증되어 저장된 건수
  // skipped: verifyOne이 false를 반환한 건수 — 실패가 아니라 "이번엔 건너뜀,
  //          다음 cron이 재시도"다(도매꾹 일시 오류). 에러로 집계하지 않는다.
  let verified = 0;
  let skipped = 0;

  // verifyOne은 도매꾹 일시 오류(DomeTransientError)를 내부에서 이미 잡아 false로
  // 바꿔 돌려주므로(shortlist-verify.ts), 여기서 다시 잡을 필요가 없다. 이 catch는
  // 그 외의 예상 밖 오류(DB 오류 등)만을 위한 것이다.
  try {
    for (const target of targets) {
      const ok = await verifyOne(target);
      if (ok) verified++;
      else skipped++;

      if (targets.length > 1) await delay(NAVER_CALL_DELAY_MS);
    }
  } catch (err) {
    console.error('[shortlist/verify] 재검증 실패', err);
    return NextResponse.json({ error: '재검증하지 못했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ verified, skipped, total: targets.length });
}
