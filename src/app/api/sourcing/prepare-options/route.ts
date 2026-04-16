/**
 * POST /api/sourcing/prepare-options
 * 도매꾹 상품의 옵션을 파싱하여 정규화된 형태로 반환 + DB 캐싱
 *
 * 요청: { itemNo: number }
 * 응답: ProductOptions (hasOptions, groups[], variants[])
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { parseDomeggookOptions } from '@/lib/sourcing/option-parser';
import { getSourcingPool } from '@/lib/sourcing/db';
import { parseEffectiveDeliFee } from '@/lib/sourcing/deli-parser';

const requestSchema = z.object({
  itemNo: z.number().int().positive(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { success: false, error: '유효한 itemNo를 입력해주세요.' },
        { status: 400 },
      );
    }

    const { itemNo } = parsed.data;

    // 도매꾹 API 호출
    const client = getDomeggookClient();
    const detail = await client.getItemView(itemNo);

    const baseDomePrice = parseInt(String(detail.price?.dome ?? '0'), 10);
    const deliveryFee = parseEffectiveDeliFee(detail.deli);
    const categoryName = detail.category?.current?.name ?? null;

    const options = parseDomeggookOptions(detail.selectOpt, baseDomePrice, {
      deliveryFee,
      categoryName,
    });

    if (!options.hasOptions) {
      return Response.json({
        success: true,
        data: options,
      });
    }

    // DB 캐싱 — sourcing_items에서 id 조회
    const pool = getSourcingPool();
    const itemResult = await pool.query<{ id: string }>(
      `SELECT id FROM sourcing_items WHERE item_no = $1 LIMIT 1`,
      [itemNo],
    );

    if (itemResult.rows[0]) {
      const sourcingItemId = itemResult.rows[0].id;

      // 기존 옵션 삭제 후 새로 삽입 (upsert 대신 replace — 옵션 구조 변경 대응)
      await pool.query(
        `DELETE FROM product_option_groups WHERE sourcing_item_id = $1`,
        [sourcingItemId],
      );
      await pool.query(
        `DELETE FROM product_option_variants WHERE sourcing_item_id = $1`,
        [sourcingItemId],
      );

      // 옵션 그룹 저장
      for (const group of options.groups) {
        await pool.query(
          `INSERT INTO product_option_groups
             (sourcing_item_id, group_order, group_name, group_values)
           VALUES ($1, $2, $3, $4)`,
          [sourcingItemId, group.order, group.groupName, group.values],
        );
      }

      // 옵션 조합 저장
      for (const v of options.variants) {
        await pool.query(
          `INSERT INTO product_option_variants
             (sourcing_item_id, variant_key, option_values, source_hash,
              cost_price, sale_price_coupang, sale_price_naver,
              stock, is_sold_out, is_hidden, is_enabled)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            sourcingItemId,
            v.variantId.replace('v_', ''),
            v.optionValues,
            v.sourceHash,
            v.costPrice,
            v.salePrices.coupang,
            v.salePrices.naver,
            v.stock,
            v.soldOut,
            v.hidden,
            v.enabled,
          ],
        );
      }

      console.info(
        `[prepare-options] itemNo=${itemNo}: ${options.groups.length}그룹, ${options.variants.length}조합 저장`,
      );
    }

    return Response.json({
      success: true,
      data: {
        ...options,
        basePrice: {
          dome: baseDomePrice,
          supply: parseInt(String(detail.price?.supply ?? '0'), 10),
          resaleRecommend: detail.price?.resale?.Recommand ?? null,
        },
      },
    });
  } catch (err) {
    console.error('[POST /api/sourcing/prepare-options]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
