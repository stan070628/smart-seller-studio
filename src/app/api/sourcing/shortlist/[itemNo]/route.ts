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
    console.error('[shortlist] 삭제 실패', err);
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
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  if (body.logisticsSize !== undefined && !SIZES.includes(body.logisticsSize)) {
    return NextResponse.json({ error: '알 수 없는 물류 사이즈입니다.' }, { status: 400 });
  }
  if (body.orderQty !== undefined && body.orderQty < 1) {
    return NextResponse.json({ error: '사입 수량은 1 이상이어야 합니다.' }, { status: 400 });
  }

  try {
    await patchShortlist(no, body);

    // 원가에 영향을 주는 값(물류 사이즈·사입 수량)이 바뀌면 손익분기를 다시 계산한다.
    // verifyOne이 false를 반환해도(도매꾹 일시 오류) 실패로 취급하지 않는다 —
    // 다음 cron이 재시도한다.
    if (body.logisticsSize !== undefined || body.orderQty !== undefined) {
      const item = await getShortlistItem(no);
      if (item) {
        await verifyOne({
          itemNo: no,
          title: item.title,
          orderQty: item.orderQty,
          logisticsSize: item.logisticsSize,
        });
      }
    }

    return NextResponse.json({ item: await getShortlistItem(no) });
  } catch (err) {
    console.error('[shortlist] 수정 실패', err);
    return NextResponse.json({ error: '수정하지 못했습니다.' }, { status: 500 });
  }
}
