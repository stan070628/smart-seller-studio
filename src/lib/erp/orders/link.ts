// src/lib/erp/orders/link.ts
// (1-C2b ①) 대기열에서 사람이 연결한다. 호출자가 트랜잭션을 연다. 주문 줄을 쓰기 전에 그 채널의 수집 잠금(7102)을 잡는다 —
// 15분 수집이 같은 줄을 동시에 upsert하지 않게. 연결 뒤 relinkLines가 재판정 → 옛 장부 → 차감(스위치를 따른다).
// 해제는 이 화면에서 만든 것(origin 'manual' 리스팅 · manual_sku_id)만. 이미 뺀 재고는 해제만으로 되돌리지 않는다 —
// 올바른 SKU로 다시 연결하면 차감 판정표가 역전표 + 새 차감으로 옮긴다(설계서 ①).
import { NextResponse } from 'next/server';
import type { Db } from '@/lib/erp/ledger/store';
import { CHANNEL_LOCK, LOCK_NS } from './collect';
import { relinkLines, type RelinkResult } from './relink';
import { isOrderChannel, type OrderChannel } from './types';

export class LinkError extends Error {
  constructor(readonly code: 'invalid' | 'sku' | 'exists' | 'not_found', message: string) {
    super(message);
    this.name = 'LinkError';
  }
}

const lockChannel = (db: Db, ch: OrderChannel) => db.query('select pg_advisory_xact_lock($1::int, $2::int)', [LOCK_NS, CHANNEL_LOCK[ch]]);

async function assertActiveSku(db: Db, skuId: number): Promise<void> {
  if (!Number.isInteger(skuId) || skuId <= 0) throw new LinkError('invalid', `skuId가 잘못됐다: ${skuId}`);
  const { rows } = await db.query('select id, status from erp.skus where id = $1', [skuId]);
  if (rows.length === 0 || rows[0].status !== 'active') throw new LinkError('sku', `활성 SKU가 아니다: ${skuId}`);
}

export async function linkListing(
  db: Db,
  p: { channel: OrderChannel; productId: string; optionKey: string; skuId: number; multiplier: number; label: string },
  at: string,
): Promise<{ listingId: number; relinked: RelinkResult }> {
  if (!isOrderChannel(p.channel)) throw new LinkError('invalid', `채널이 잘못됐다: ${String(p.channel)}`);
  if (typeof p.productId !== 'string' || p.productId.trim() === '' || p.productId.length > 120) throw new LinkError('invalid', '상품번호가 비었다');
  if (typeof p.optionKey !== 'string' || p.optionKey.length > 300) throw new LinkError('invalid', '옵션 키가 잘못됐다');
  if (!Number.isInteger(p.multiplier) || p.multiplier < 1 || p.multiplier > 100) throw new LinkError('invalid', `배수는 1~100 정수다: ${p.multiplier}`);
  await assertActiveSku(db, p.skuId);
  await lockChannel(db, p.channel);
  const { rows: ex } = await db.query(
    'select id from erp.channel_listings where channel = $1 and external_product_id = $2 and external_option_key = $3',
    [p.channel, p.productId, p.optionKey],
  );
  if (ex.length > 0) throw new LinkError('exists', `이미 리스팅이 있다(id ${ex[0].id}) — 재고현황·상품 연결에서 고친다`);
  const { rows: ins } = await db.query(
    `insert into erp.channel_listings (channel, external_product_id, external_option_key, label, active, link_mode, origin)
     values ($1, $2, $3, $4, true, 'single', 'manual') returning id`,
    [p.channel, p.productId, p.optionKey, p.label.slice(0, 300)],
  );
  const listingId = Number(ins[0].id);
  await db.query(`insert into erp.listing_skus (listing_id, sku_id, multiplier, origin) values ($1, $2, $3, 'manual')`, [listingId, p.skuId, p.multiplier]);
  const { rows: lines } = await db.query(
    `select id from erp.order_lines where channel = $1 and product_id = $2 and attribution = 'unattributed' order by id`,
    [p.channel, p.productId],
  );
  return { listingId, relinked: await relinkLines(db, p.channel, lines.map((r) => Number(r.id)), at) };
}

export async function linkLines(db: Db, p: { lineIds: number[]; skuId: number }, at: string): Promise<RelinkResult> {
  if (!Array.isArray(p.lineIds) || p.lineIds.length === 0 || p.lineIds.length > 200 || !p.lineIds.every((x) => Number.isInteger(x) && x > 0)) {
    throw new LinkError('invalid', 'lineIds는 1~200건 양의 정수 배열이다');
  }
  await assertActiveSku(db, p.skuId);
  const { rows: chs } = await db.query(`select distinct channel from erp.order_lines where id = any($1::bigint[])`, [p.lineIds]);
  if (chs.length !== 1 || !isOrderChannel(chs[0].channel)) throw new LinkError('invalid', '한 채널의 줄만 한 번에 연결한다');
  const ch = chs[0].channel as OrderChannel;
  await lockChannel(db, ch);
  // (리뷰 A2~A4 #2) 묶음 줄을 SKU 하나로 덮으면 나머지 구성품이 다시는 빠지지 않는다 — 리스팅(link_mode)을 고치게 한다
  const { rows: bundles } = await db.query(
    `select count(*)::int as n from erp.order_lines where id = any($1::bigint[]) and jsonb_array_length(alloc) > 1`, [p.lineIds],
  );
  if (Number(bundles[0].n) > 0) throw new LinkError('invalid', '묶음 상품 줄은 「이 주문만 연결」로 바꾸지 않는다 — 리스팅 연결을 고친다');
  await db.query(`update erp.order_lines set manual_sku_id = $2, updated_at = now() where id = any($1::bigint[])`, [p.lineIds, p.skuId]);
  return relinkLines(db, ch, p.lineIds, at);
}

export async function unlinkLine(db: Db, lineId: number, at: string): Promise<RelinkResult> {
  const { rows } = await db.query('select channel from erp.order_lines where id = $1 and manual_sku_id is not null', [lineId]);
  if (rows.length === 0 || !isOrderChannel(rows[0].channel)) throw new LinkError('not_found', `사람이 연결한 줄이 아니다: ${lineId}`);
  await lockChannel(db, rows[0].channel);
  await db.query('update erp.order_lines set manual_sku_id = null, updated_at = now() where id = $1', [lineId]);
  return relinkLines(db, rows[0].channel, [lineId], at);
}

export async function unlinkListing(db: Db, listingId: number, at: string): Promise<RelinkResult> {
  const { rows } = await db.query('select id, channel, origin from erp.channel_listings where id = $1', [listingId]);
  if (rows.length === 0) throw new LinkError('not_found', `리스팅이 없다: ${listingId}`);
  if (rows[0].origin !== 'manual') throw new LinkError('invalid', '적재(draft) 리스팅은 이 화면에서 해제하지 않는다');
  const ch = rows[0].channel as OrderChannel;
  await lockChannel(db, ch);
  await db.query('update erp.channel_listings set active = false where id = $1', [listingId]);
  const { rows: lines } = await db.query('select id from erp.order_lines where listing_id = $1 order by id', [listingId]);
  return relinkLines(db, ch, lines.map((r) => Number(r.id)), at);
}

/** LinkError → HTTP. 그 밖은 null(호출자가 erpError로) */
export function linkErrorResponse(e: unknown): NextResponse | null {
  if (!(e instanceof LinkError)) return null;
  const status = e.code === 'exists' ? 409 : e.code === 'not_found' ? 404 : 400;
  return NextResponse.json({ success: false, code: e.code, error: e.message }, { status });
}
