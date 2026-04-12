/**
 * POST /api/sourcing/fetch-items/single
 * 도매꾹 URL 또는 상품 ID로 단일 상품을 즉시 수집하여 sourcing_items에 upsert
 *
 * 요청: { url?: string; itemId?: number }
 *   - url 예시: "https://domeggook.com/60015467"
 *   - itemId 예시: 60015467
 * 응답: { success: true, data: { itemNo, title, isNew } }
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { getSourcingPool } from '@/lib/sourcing/db';

// URL에서 숫자 ID 추출 (예: "https://domeggook.com/60015467" → 60015467)
function parseItemNo(input: string): number | null {
  const trimmed = input.trim();
  // 순수 숫자
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  // URL 패턴: 마지막 경로 세그먼트가 숫자
  const match = trimmed.match(/\/(\d+)\/?$/);
  if (match) return parseInt(match[1], 10);
  return null;
}

const requestSchema = z.union([
  z.object({ url: z.string().min(1) }),
  z.object({ itemId: z.number().int().positive() }),
]);

export async function POST(request: NextRequest) {
  try {
    let body: unknown = {};
    const ct = request.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      body = await request.json();
    }

    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { success: false, error: 'url 또는 itemId를 입력해주세요.' },
        { status: 400 },
      );
    }

    // itemNo 결정
    let itemNo: number;
    if ('url' in parsed.data) {
      const no = parseItemNo(parsed.data.url);
      if (!no) {
        return Response.json(
          { success: false, error: '유효한 도매꾹 URL이나 상품 번호가 아닙니다.' },
          { status: 400 },
        );
      }
      itemNo = no;
    } else {
      itemNo = parsed.data.itemId;
    }

    // 도매꾹 getItemView (v4.5) 호출
    const client = getDomeggookClient();
    const detail = await client.getItemView(itemNo);

    const title    = detail.basis.title ?? '';
    const status   = detail.basis.status ?? null;
    const catName  = detail.category?.current?.name ?? null;
    const sellerId = detail.seller?.id ? String(detail.seller.id) : null;
    const sellerNick = detail.seller?.nick ? String(detail.seller.nick) : null;
    const imageUrl = detail.image?.url ?? null;
    const domeUrl  = `https://domeggook.com/${itemNo}`;
    const priceDome  = detail.price?.dome ?? null;
    const moq        = detail.qty?.domeMoq ?? null;
    const inventory  = detail.qty?.inventory ?? null;
    const deliWho    = detail.deli?.who ?? null;
    const deliFee    = detail.deli?.fee ?? null;

    const pool = getSourcingPool();
    const now = new Date();
    const THRESHOLD_MS = 5000;

    const result = await pool.query<{ id: string; created_at: string }>(
      `INSERT INTO sourcing_items
         (item_no, title, status, category_name, seller_id, seller_nick,
          image_url, dome_url, is_tracking, price_dome, moq, deli_who, deli_fee)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $11, $12)
       ON CONFLICT (item_no) DO UPDATE SET
         title        = EXCLUDED.title,
         status       = EXCLUDED.status,
         category_name= EXCLUDED.category_name,
         seller_id    = EXCLUDED.seller_id,
         seller_nick  = EXCLUDED.seller_nick,
         image_url    = EXCLUDED.image_url,
         dome_url     = EXCLUDED.dome_url,
         price_dome   = COALESCE(EXCLUDED.price_dome, sourcing_items.price_dome),
         moq          = COALESCE(EXCLUDED.moq, sourcing_items.moq),
         deli_who     = COALESCE(EXCLUDED.deli_who, sourcing_items.deli_who),
         deli_fee     = COALESCE(EXCLUDED.deli_fee, sourcing_items.deli_fee),
         is_tracking  = true,
         updated_at   = now()
       RETURNING id, created_at`,
      [itemNo, title, status, catName, sellerId, sellerNick, imageUrl, domeUrl, priceDome, moq, deliWho, deliFee],
    );

    const row = result.rows[0];
    const isNew = row
      ? now.getTime() - new Date(row.created_at).getTime() < THRESHOLD_MS
      : false;

    // 재고 스냅샷 저장 — inventory 없어도 0으로 저장 (sales_analysis_view INNER JOIN 통과 필수)
    if (row) {
      const snapshotDate = new Date(Date.now() + 9 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      await pool.query(
        `INSERT INTO inventory_snapshots
           (item_id, item_no, snapshot_date, inventory, price_dome, price_supply)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (item_no, snapshot_date) DO NOTHING`,
        [row.id, itemNo, snapshotDate, inventory ?? 0, priceDome, detail.price?.supply ?? null],
      );
    }

    console.info(
      `[fetch-items/single] ${isNew ? '신규' : '업데이트'}: ${itemNo} "${title}"`,
    );

    return Response.json({
      success: true,
      data: { itemNo, title, isNew },
    });
  } catch (err) {
    console.error('[POST /api/sourcing/fetch-items/single]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
