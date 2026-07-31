/**
 * DELETE /api/sourcing/shortlist/[itemNo]   삭제
 * PATCH  /api/sourcing/shortlist/[itemNo]   memo·사이즈·사입수량·보관여부 수정
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
