import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getCurrentUser } from '@/lib/auth';
import { syncForApp } from '@/lib/erp/sku/sync-app';
import { SYNC_MISSING_CAP, errMsg, type SkuSync } from '@/lib/erp/sku/sync-product';

// 저장 뒤 상품마다 쿠팡 상품 상세를 읽는다(SKU 자동 추가, 최대 SYNC_MISSING_CAP개)
export const maxDuration = 300;

const OVER_CAP = `한 번에 ${SYNC_MISSING_CAP}개까지 자동 추가 — 재고현황의 「SKU 다시 맞추기」로 채운다`;

type BulkSkuSync = SkuSync & { seller_product_id: number | null; product_name: string };

/**
 * POST /api/cost-management/products/bulk
 * 쿠팡 등록상품 여러 건을 원가관리 상품으로 한 번에 등록한다.
 *
 * 단건 POST(../route.ts)와 검증 규칙은 같되, 세 가지가 다르다.
 *  1) 건별로 독립 처리한다 — 한 건이 막혀도 나머지는 들어간다. 6건 중 1건 때문에
 *     전부 되돌리면 사용자는 무엇이 문제인지 모른 채 처음부터 다시 골라야 한다.
 *  2) 이미 원가관리에 있는 seller_product_id는 건너뛴다. product_costs의 UNIQUE는
 *     (user_id, vendor_item_id)뿐이라(067) seller_product_id는 DB가 중복을 막지 않는다.
 *  3) 같은 요청 안의 중복도 걸러낸다 — 목록 갱신 지연으로 같은 상품이 두 번 실릴 수 있다.
 *  4) 저장이 끝난 뒤 쿠팡 상품번호가 있는 상품을 SKU로 만든다(data.skuSync, 상품별 · 최대 20개).
 */

const MAX_ITEMS = 200;

interface BulkItem {
  product_name?: unknown;
  seller_product_id?: unknown;
  platform_fee_rate?: unknown;
  subdivision_unit?: unknown;
}

interface Skipped {
  seller_product_id: number | null;
  product_name: string;
  reason: string;
}

/** 한 건을 검증한다. 통과하면 null, 아니면 사유 문자열을 돌려준다. */
function validate(item: BulkItem): string | null {
  const { product_name, seller_product_id, platform_fee_rate, subdivision_unit } = item;

  if (!product_name || typeof product_name !== 'string' || product_name.trim() === '') {
    return '상품명이 비어 있습니다';
  }
  if (platform_fee_rate !== undefined && platform_fee_rate !== null) {
    if (typeof platform_fee_rate !== 'number' || platform_fee_rate <= 0 || platform_fee_rate >= 1) {
      return '수수료율은 0%보다 크고 100%보다 작아야 합니다';
    }
  }
  if (seller_product_id !== undefined && seller_product_id !== null) {
    if (!Number.isInteger(seller_product_id) || (seller_product_id as number) <= 0) {
      return '쿠팡 상품ID가 올바르지 않습니다';
    }
  }
  if (subdivision_unit !== undefined && subdivision_unit !== null) {
    if (!Number.isInteger(subdivision_unit) || (subdivision_unit as number) < 1) {
      return '소분 갯수는 1 이상의 정수여야 합니다';
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const items = body?.items;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ success: false, error: '등록할 상품이 없습니다.' }, { status: 400 });
    }
    if (items.length > MAX_ITEMS) {
      return NextResponse.json(
        { success: false, error: `한 번에 ${MAX_ITEMS}건까지 등록할 수 있습니다.` },
        { status: 400 },
      );
    }

    const pool = getSourcingPool();

    // 이미 등록된 seller_product_id — 여기서 걸러야 목록 갱신이 늦은 경우에도 중복이 안 생긴다.
    const { rows: existingRows } = await pool.query(
      `SELECT seller_product_id FROM product_costs
       WHERE user_id = $1 AND seller_product_id IS NOT NULL`,
      [user.userId],
    );
    const existing = new Set<number>(existingRows.map((r) => Number(r.seller_product_id)));

    const created: ({ seller_product_id: number | string | null; product_name: string } & Record<string, unknown>)[] = [];
    const skipped: Skipped[] = [];
    const seenInRequest = new Set<number>();

    for (const raw of items as BulkItem[]) {
      const name = typeof raw.product_name === 'string' ? raw.product_name.trim() : '';
      const sellerProductId =
        raw.seller_product_id === undefined || raw.seller_product_id === null
          ? null
          : Number(raw.seller_product_id);

      const invalid = validate(raw);
      if (invalid) {
        skipped.push({ seller_product_id: sellerProductId, product_name: name, reason: invalid });
        continue;
      }
      if (sellerProductId !== null && existing.has(sellerProductId)) {
        skipped.push({ seller_product_id: sellerProductId, product_name: name, reason: '이미 원가관리에 있습니다' });
        continue;
      }
      if (sellerProductId !== null && seenInRequest.has(sellerProductId)) {
        skipped.push({ seller_product_id: sellerProductId, product_name: name, reason: '요청에 중복으로 들어 있습니다' });
        continue;
      }

      try {
        const { rows } = await pool.query(
          `INSERT INTO product_costs (user_id, product_name, seller_product_id, platform_fee_rate, subdivision_unit)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, product_name, seller_product_id, platform, platform_fee_rate,
                     subdivision_unit, current_stock, created_at`,
          [
            user.userId,
            name,
            sellerProductId,
            // 미전달 시 쿠팡 로켓그로스 기본 수수료율 10.8%
            (raw.platform_fee_rate as number | undefined) ?? 0.108,
            (raw.subdivision_unit as number | undefined) ?? null,
          ],
        );
        created.push(rows[0]);
        if (sellerProductId !== null) seenInRequest.add(sellerProductId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '등록 실패';
        skipped.push({ seller_product_id: sellerProductId, product_name: name, reason: msg });
      }
    }

    // 저장(건별 INSERT 자동 커밋)이 끝난 뒤 상품마다 SKU를 만든다 — 실패해도 등록은 그대로다(설계 §1)
    const skuSync: BulkSkuSync[] = [];
    let budget = SYNC_MISSING_CAP;
    for (const row of created) {
      const id = row.seller_product_id === null ? null : Number(row.seller_product_id);
      const base = { seller_product_id: id, product_name: String(row.product_name) };
      if (id === null || !(id > 0)) {
        skuSync.push({ ...base, status: 'skipped', skus: 0 });
        continue;
      }
      if (budget <= 0) {
        skuSync.push({ ...base, status: 'failed', skus: 0, error: OVER_CAP });
        continue;
      }
      budget--;
      try {
        skuSync.push({ ...base, ...(await syncForApp(id)) });
      } catch (e) {
        skuSync.push({ ...base, status: 'failed', skus: 0, error: errMsg(e) });
      }
    }

    return NextResponse.json(
      {
        success: true,
        data: { created, skipped, created_count: created.length, skipped_count: skipped.length, skuSync },
      },
      { status: created.length > 0 ? 201 : 200 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
