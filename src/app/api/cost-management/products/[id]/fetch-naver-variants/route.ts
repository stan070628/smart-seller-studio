import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { getNaverCommerceClient } from '@/lib/listing/naver-commerce-client';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pool = getSourcingPool();

  const { rows } = await pool.query(
    `SELECT id, naver_channel_product_no, naver_origin_product_no FROM product_costs WHERE id = $1 AND user_id = $2`,
    [id, user.userId],
  );
  if (rows.length === 0) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const { naver_channel_product_no, naver_origin_product_no } = rows[0] as {
    naver_channel_product_no: number | null;
    naver_origin_product_no: number | null;
  };

  if (!naver_channel_product_no) {
    return NextResponse.json({ success: false, error: '네이버 채널상품번호가 없습니다.' }, { status: 400 });
  }

  try {
    const client = getNaverCommerceClient();

    // originProductNo 확보: 캐시 우선, 없으면 채널상품 역조회
    let originProductNo = naver_origin_product_no;
    if (!originProductNo) {
      const channelDetail = await client.getChannelProductDetail(Number(naver_channel_product_no)) as Record<string, unknown>;
      const parsed = Number(channelDetail.originProductNo ?? 0);
      if (!parsed) {
        return NextResponse.json({ success: false, error: '네이버 채널상품 조회 실패: originProductNo 없음' }, { status: 422 });
      }
      originProductNo = parsed;
    }

    // 원상품 상세 → 옵션 조합 추출
    const detail = await client.getProductDetail(originProductNo) as Record<string, unknown>;
    const originProduct = detail.originProduct as Record<string, unknown> | undefined;
    const optionInfo = (originProduct?.detailAttribute as Record<string, unknown> | undefined)?.optionInfo as Record<string, unknown> | undefined;
    const combinations = Array.isArray(optionInfo?.optionCombinations)
      ? optionInfo!.optionCombinations as Record<string, unknown>[]
      : [];

    if (combinations.length === 0) {
      // 단일상품 (옵션 없음) — 빈 객체 저장
      await pool.query(
        `UPDATE product_costs SET naver_origin_product_no = $1, naver_variants = $2 WHERE id = $3 AND user_id = $4`,
        [originProductNo, JSON.stringify({}), id, user.userId],
      );
      return NextResponse.json({ success: true, data: { naver_variants: {}, naver_origin_product_no: originProductNo } });
    }

    // { optionId: 옵션명 } 매핑 구성
    const naver_variants: Record<string, string> = {};
    for (const combo of combinations) {
      const optionId = String(combo.id ?? '');
      if (!optionId) continue;
      const nameParts = [combo.optionName1, combo.optionName2, combo.optionName3, combo.optionName4]
        .filter((v) => v && String(v).trim())
        .map((v) => String(v));
      const label = nameParts.join('/') || optionId;
      naver_variants[optionId] = label;
    }

    await pool.query(
      `UPDATE product_costs SET naver_origin_product_no = $1, naver_variants = $2 WHERE id = $3 AND user_id = $4`,
      [originProductNo, JSON.stringify(naver_variants), id, user.userId],
    );

    return NextResponse.json({ success: true, data: { naver_variants, naver_origin_product_no: originProductNo } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
