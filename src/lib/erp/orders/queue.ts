// src/lib/erp/orders/queue.ts
// (1-C2b ①) 미연결 주문 대기열 조회(읽기 전용). 묶음 = (채널, 상품번호, 옵션 키). 취소·미결제 줄은 뺀다(수집 현황 「미귀속」과 같은 기준).
import type { Db } from '@/lib/erp/ledger/store';
import type { OrderChannel } from './types';

export interface UnattributedGroup {
  channel: OrderChannel;
  productId: string;
  optionKey: string;
  label: string;
  reasons: string[];
  lines: number;
  qty: number;
  firstPaidAt: string | null;
  lastPaidAt: string | null;
  lineIds: number[];
}

export interface RecentListingLink {
  listingId: number;
  channel: OrderChannel;
  productId: string;
  optionKey: string;
  label: string;
  skuId: number;
  skuLabel: string;
  multiplier: number;
  createdAt: string;
}

export interface RecentLineLink {
  lineId: number;
  channel: OrderChannel;
  externalLineId: string;
  label: string;
  skuId: number;
  skuLabel: string;
  updatedAt: string;
}

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const SKU_LABEL = `s.name || case when coalesce(s.option_label, '') <> '' then ' · ' || s.option_label else '' end`;

export async function unattributedGroups(db: Db): Promise<UnattributedGroup[]> {
  const { rows } = await db.query(
    `select channel, product_id, option_key, max(product_label) as label, array_agg(distinct unattributed_reason) as reasons,
            count(*)::int as lines, sum(order_qty) as qty, min(paid_at) as first_paid, max(paid_at) as last_paid,
            array_agg(id order by paid_at nulls last, id) as line_ids
       from erp.order_lines
      where attribution = 'unattributed' and status not in ('canceled', 'unpaid')
      group by channel, product_id, option_key
      order by max(paid_at) desc nulls last
      limit 200`,
  );
  return rows.map((r) => ({
    channel: r.channel as OrderChannel, productId: String(r.product_id), optionKey: String(r.option_key ?? ''), label: String(r.label ?? ''),
    reasons: (r.reasons ?? []).map(String), lines: Number(r.lines), qty: Number(r.qty), firstPaidAt: iso(r.first_paid), lastPaidAt: iso(r.last_paid),
    lineIds: (r.line_ids ?? []).map(Number),
  }));
}

export async function recentLinks(db: Db, limit: number): Promise<{ listings: RecentListingLink[]; lines: RecentLineLink[] }> {
  const l = await db.query(
    `select l.id, l.channel, l.external_product_id, l.external_option_key, l.label, x.sku_id, ${SKU_LABEL} as sku_label, x.multiplier, l.created_at
       from erp.channel_listings l join erp.listing_skus x on x.listing_id = l.id join erp.skus s on s.id = x.sku_id
      where l.origin = 'manual' and l.active
      order by l.created_at desc, l.id desc limit $1`,
    [limit],
  );
  const o = await db.query(
    `select l.id, l.channel, l.external_line_id, l.product_label, l.manual_sku_id, ${SKU_LABEL} as sku_label, l.updated_at
       from erp.order_lines l join erp.skus s on s.id = l.manual_sku_id
      where l.manual_sku_id is not null and l.channel <> 'karrot'
      order by l.updated_at desc, l.id desc limit $1`,
    [limit],
  );
  return {
    listings: l.rows.map((r) => ({
      listingId: Number(r.id), channel: r.channel as OrderChannel, productId: String(r.external_product_id), optionKey: String(r.external_option_key ?? ''),
      label: String(r.label ?? ''), skuId: Number(r.sku_id), skuLabel: String(r.sku_label), multiplier: Number(r.multiplier), createdAt: iso(r.created_at) as string,
    })),
    lines: o.rows.map((r) => ({
      lineId: Number(r.id), channel: r.channel as OrderChannel, externalLineId: String(r.external_line_id), label: String(r.product_label ?? ''),
      skuId: Number(r.manual_sku_id), skuLabel: String(r.sku_label), updatedAt: iso(r.updated_at) as string,
    })),
  };
}
