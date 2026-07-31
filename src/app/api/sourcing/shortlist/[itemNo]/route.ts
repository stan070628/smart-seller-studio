/**
 * DELETE /api/sourcing/shortlist/[itemNo]   삭제
 * PATCH  /api/sourcing/shortlist/[itemNo]   memo·사이즈·사입수량·보관여부·1688 사입값 수정
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  deleteShortlist,
  patchShortlist,
  getShortlistItem,
} from '@/lib/sourcing/shortlist-db';
import { verifyOne } from '@/lib/sourcing/shortlist-verify';
import type { LogisticsSize } from '@/types/shortlist';

const SIZES: LogisticsSize[] = ['xsmall', 'small', 'medium'];
/** 사입 수량 상한 — 이 이상은 사람이 직접 입력할 범위가 아니라 오타로 본다 */
const MAX_ORDER_QTY = 100000;

function parseItemNo(itemNo: string): number | null {
  const no = parseInt(itemNo, 10);
  return Number.isFinite(no) ? no : null;
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ itemNo: string }> },
) {
  const { itemNo } = await params;
  const no = parseItemNo(itemNo);
  if (no === null) {
    return NextResponse.json({ error: '잘못된 상품번호입니다.' }, { status: 400 });
  }

  try {
    await deleteShortlist(no);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[shortlist] 삭제 실패 itemNo=${no}`, err);
    return NextResponse.json({ error: '삭제하지 못했습니다.' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ itemNo: string }> },
) {
  const { itemNo } = await params;
  const no = parseItemNo(itemNo);
  if (no === null) {
    return NextResponse.json({ error: '잘못된 상품번호입니다.' }, { status: 400 });
  }

  let body: {
    memo?: string;
    logisticsSize?: LogisticsSize;
    orderQty?: number;
    isArchived?: boolean;
    coupangP25?: number | null;
    /** 1688 결제 확인 화면 붙여넣기 값. null이면 지운다 */
    buyKrwTotal?: number | null;
    buyCnyTotal?: number | null;
    orderQty1688?: number | null;
    exchangeRate1688?: number | null;
    intlShipPerUnit?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  if (body.logisticsSize !== undefined && !SIZES.includes(body.logisticsSize)) {
    return NextResponse.json({ error: '알 수 없는 물류 사이즈입니다.' }, { status: 400 });
  }
  if (body.orderQty !== undefined) {
    if (!Number.isInteger(body.orderQty) || body.orderQty < 1) {
      return NextResponse.json({ error: '사입 수량은 1 이상의 정수여야 합니다.' }, { status: 400 });
    }
    if (body.orderQty > MAX_ORDER_QTY) {
      return NextResponse.json(
        { error: `사입 수량은 ${MAX_ORDER_QTY} 이하여야 합니다.` },
        { status: 400 },
      );
    }
  }

  /** 쿠팡 실판가 상한 — 오타로 자릿수가 밀린 값을 거른다 */
  const MAX_COUPANG_PRICE = 10_000_000;

  if (body.coupangP25 !== undefined && body.coupangP25 !== null) {
    if (!Number.isInteger(body.coupangP25) || body.coupangP25 < 0) {
      return NextResponse.json({ error: '쿠팡 실판가는 0 이상의 정수여야 합니다.' }, { status: 400 });
    }
    if (body.coupangP25 > MAX_COUPANG_PRICE) {
      return NextResponse.json(
        { error: `쿠팡 실판가는 ${MAX_COUPANG_PRICE.toLocaleString()}원 이하여야 합니다.` },
        { status: 400 },
      );
    }
  }

  // ── 1688 붙여넣기 값 ────────────────────────────────────────────────
  // 상한은 자릿수가 밀린 입력을 거르는 용도다. 파서가 이미 검산을 하지만
  // API를 직접 부르는 경로도 있어 마지막 방어선을 여기 둔다.
  /** 1688 원화 합계 상한 */
  const MAX_BUY_KRW = 100_000_000;
  const MAX_QTY_1688 = 100_000;
  /** 위안 합계 상한 — 원화 상한을 환율 하한(100원/위안)으로 나눈 수준 */
  const MAX_BUY_CNY = 1_000_000;
  /** 원/위안 환율 상한 — 실제는 200 언저리라 소수점이 밀린 값을 잡는다 */
  const MAX_RATE_1688 = 10_000;
  /** 개당 국제배송비 상한 */
  const MAX_INTL_SHIP = 1_000_000;

  if (body.buyKrwTotal !== undefined && body.buyKrwTotal !== null) {
    if (
      !Number.isInteger(body.buyKrwTotal) ||
      body.buyKrwTotal < 0 ||
      body.buyKrwTotal > MAX_BUY_KRW
    ) {
      return NextResponse.json(
        { error: `1688 원화 합계는 0 이상 ${MAX_BUY_KRW.toLocaleString()}원 이하의 정수여야 합니다.` },
        { status: 400 },
      );
    }
  }
  // 위안 합계·환율은 소수라 정수 검사를 걸 수 없다. 숫자가 아닌 값이 그대로
  // numeric 컬럼에 들어가면 500이 나므로 여기서 400으로 막는다.
  if (body.buyCnyTotal !== undefined && body.buyCnyTotal !== null) {
    if (
      typeof body.buyCnyTotal !== 'number' ||
      !Number.isFinite(body.buyCnyTotal) ||
      body.buyCnyTotal < 0 ||
      body.buyCnyTotal > MAX_BUY_CNY
    ) {
      return NextResponse.json(
        { error: `1688 위안 합계는 0 이상 ${MAX_BUY_CNY.toLocaleString()}위안 이하의 숫자여야 합니다.` },
        { status: 400 },
      );
    }
  }
  if (body.orderQty1688 !== undefined && body.orderQty1688 !== null) {
    if (
      !Number.isInteger(body.orderQty1688) ||
      body.orderQty1688 < 1 ||
      body.orderQty1688 > MAX_QTY_1688
    ) {
      return NextResponse.json(
        { error: '1688 주문 수량은 1 이상의 정수여야 합니다.' },
        { status: 400 },
      );
    }
  }
  if (body.exchangeRate1688 !== undefined && body.exchangeRate1688 !== null) {
    if (
      typeof body.exchangeRate1688 !== 'number' ||
      !Number.isFinite(body.exchangeRate1688) ||
      body.exchangeRate1688 <= 0 ||
      body.exchangeRate1688 > MAX_RATE_1688
    ) {
      return NextResponse.json(
        { error: `1688 환율은 0 초과 ${MAX_RATE_1688.toLocaleString()} 이하의 숫자여야 합니다.` },
        { status: 400 },
      );
    }
  }
  if (body.intlShipPerUnit !== undefined && body.intlShipPerUnit !== null) {
    if (
      !Number.isInteger(body.intlShipPerUnit) ||
      body.intlShipPerUnit < 0 ||
      body.intlShipPerUnit > MAX_INTL_SHIP
    ) {
      return NextResponse.json(
        { error: `개당 국제배송비는 0 이상 ${MAX_INTL_SHIP.toLocaleString()}원 이하의 정수여야 합니다.` },
        { status: 400 },
      );
    }
  }

  try {
    await patchShortlist(no, body);

    // 원가·시세에 영향을 주는 값(물류 사이즈·사입 수량·쿠팡 실판가)이 바뀌면
    // 손익분기·판정을 다시 계산한다. verifyOne이 false를 반환해도(도매꾹 일시 오류)
    // 실패로 취급하지 않는다 — 다음 cron이 재시도한다.
    if (
      body.logisticsSize !== undefined ||
      body.orderQty !== undefined ||
      body.coupangP25 !== undefined
    ) {
      const item = await getShortlistItem(no);
      if (item) {
        await verifyOne({
          itemNo: no,
          title: item.title,
          orderQty: item.orderQty,
          logisticsSize: item.logisticsSize,
          coupangP25: item.coupangP25,
        });
      }
    }

    return NextResponse.json({ item: await getShortlistItem(no) });
  } catch (err) {
    console.error(`[shortlist] 수정 실패 itemNo=${no}`, err);
    return NextResponse.json({ error: '수정하지 못했습니다.' }, { status: 500 });
  }
}
