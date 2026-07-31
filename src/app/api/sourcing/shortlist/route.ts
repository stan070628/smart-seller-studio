/**
 * GET    /api/sourcing/shortlist          목록 조회
 * POST   /api/sourcing/shortlist          후보 추가 (추가 즉시 1회 검증)
 * PATCH  /api/sourcing/shortlist          사입 수량 일괄 변경
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  listShortlist,
  insertShortlist,
  getShortlistItem,
  setOrderQtyAll,
} from '@/lib/sourcing/shortlist-db';
import { fetchDomeSnapshot, verifyOne, DomeTransientError } from '@/lib/sourcing/shortlist-verify';
import { extractItemNoFromUrl } from '@/lib/sourcing/domeggook-url-parser';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';

/** 사입 수량 미지정 시 기본값 */
const DEFAULT_ORDER_QTY = 10;

export async function GET(req: NextRequest) {
  const includeArchived = req.nextUrl.searchParams.get('archived') === 'true';
  try {
    return NextResponse.json({ items: await listShortlist(includeArchived) });
  } catch (err) {
    console.error('[shortlist] 목록 조회 실패', err);
    return NextResponse.json({ error: '목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: { input?: string; orderQty?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  const raw = (body.input ?? '').trim();
  if (!raw) {
    return NextResponse.json({ error: '상품번호 또는 도매꾹 URL을 입력하세요.' }, { status: 400 });
  }

  // 숫자만 있으면 상품번호로, 아니면 도매꾹 URL로 해석한다
  const itemNo = /^\d+$/.test(raw) ? parseInt(raw, 10) : extractItemNoFromUrl(raw);
  if (!itemNo) {
    return NextResponse.json(
      { error: '상품번호 또는 도매꾹 URL을 인식하지 못했습니다.' },
      { status: 400 },
    );
  }

  const orderQty = body.orderQty && body.orderQty > 0 ? body.orderQty : DEFAULT_ORDER_QTY;

  try {
    const snapshot = await fetchDomeSnapshot(itemNo);
    if (snapshot === null) {
      return NextResponse.json(
        { error: '도매꾹에 존재하지 않는 상품입니다.' },
        { status: 404 },
      );
    }

    const detail = await getDomeggookClient().getItemView(itemNo);
    const title = detail.basis?.title ?? `상품 ${itemNo}`;

    const inserted = await insertShortlist(itemNo, title, orderQty);
    if (!inserted) {
      return NextResponse.json(
        { error: '이미 쇼트리스트에 있는 상품입니다.', item: await getShortlistItem(itemNo) },
        { status: 409 },
      );
    }

    // 삽입 직후 1회 검증한다. false가 나와도 실패가 아니라 다음 cron이 재시도하는
    // 상황일 뿐이므로 별도로 에러 처리하지 않는다.
    await verifyOne({ itemNo, title, orderQty, logisticsSize: 'xsmall' });

    return NextResponse.json({ item: await getShortlistItem(itemNo) }, { status: 201 });
  } catch (err) {
    if (err instanceof DomeTransientError) {
      return NextResponse.json(
        { error: '도매꾹 서버 응답이 일시적으로 불안정합니다. 잠시 후 다시 시도해 주세요.' },
        { status: 503 },
      );
    }
    console.error('[shortlist] 추가 실패', err);
    return NextResponse.json({ error: '추가하지 못했습니다.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  let body: { orderQty?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  if (!body.orderQty || body.orderQty < 1) {
    return NextResponse.json({ error: '사입 수량은 1 이상이어야 합니다.' }, { status: 400 });
  }

  try {
    const updated = await setOrderQtyAll(body.orderQty);
    return NextResponse.json({ updated });
  } catch (err) {
    console.error('[shortlist] 사입수량 일괄 변경 실패', err);
    return NextResponse.json({ error: '변경하지 못했습니다.' }, { status: 500 });
  }
}
