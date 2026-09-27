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

/**
 * (리뷰 A5~A7 #3) 라우트 입력 검사. 정수 또는 정수 문자열 양수만 통과시키고 그 밖은 NaN이다 —
 * Number(v)는 Number(true)===1·Number('')===0처럼 불린·빈 문자열을 조용히 숫자로 바꿔 잘못된 입력을 통과시킨다.
 */
export const toPosInt = (v: unknown): number => {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return NaN;
};

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
  // (리뷰 A5~A7 #2) resolve.ts 대체 규칙 ①: 옵션 없는('') 리스팅은 그 상품에서 못 찾은 옵션까지 전부 삼킨다.
  // 옵션이 여럿인 상품(다른 옵션 리스팅이 있거나 옵션 있는 미귀속 줄이 있다)에 옵션 없는 리스팅을 만들면
  // 앞으로 들어올 다른 옵션 주문까지 이 SKU로 잘못 잡힌다 — 옵션별로 연결하거나 「이 주문만 연결」로 보낸다.
  if (p.optionKey === '') {
    const { rows: otherOpt } = await db.query(
      `select 1 from erp.channel_listings where channel = $1 and external_product_id = $2 and external_option_key <> '' limit 1`,
      [p.channel, p.productId],
    );
    const { rows: otherLine } = await db.query(
      `select 1 from erp.order_lines where channel = $1 and product_id = $2 and attribution = 'unattributed' and option_key <> '' limit 1`,
      [p.channel, p.productId],
    );
    if (otherOpt.length > 0 || otherLine.length > 0) {
      throw new LinkError('invalid', '옵션이 여럿인 상품은 옵션 없는 리스팅으로 연결하지 않는다 — 옵션별로 연결하거나 「이 주문만 연결」');
    }
  }
  const { rows: ex } = await db.query(
    'select id, active, origin from erp.channel_listings where channel = $1 and external_product_id = $2 and external_option_key = $3',
    [p.channel, p.productId, p.optionKey],
  );
  // (리뷰 A5~A7 #5) label 없으면 "[object Object]" 대신 그 상품 미귀속 줄의 상품명, 그것도 없으면 상품번호를 쓴다
  let label = p.label.trim();
  if (label === '') {
    const { rows: lbl } = await db.query(
      `select max(product_label) as label from erp.order_lines where channel = $1 and product_id = $2 and attribution = 'unattributed'`,
      [p.channel, p.productId],
    );
    label = String(lbl[0]?.label ?? '').trim() || p.productId;
  }
  label = label.slice(0, 300);
  let listingId: number;
  if (ex.length > 0) {
    const row = ex[0];
    // (리뷰 A5~A7 #1) 활성 리스팅은 무엇이든 exists — draft는 비활성이어도 이 화면에서 되살리지 않는다(적재는 수집이 관리한다)
    if (row.active || row.origin !== 'manual') {
      throw new LinkError('exists', `이미 리스팅이 있다(id ${row.id}) — 재고현황·상품 연결에서 고친다`);
    }
    // 해제(비활성)된 manual 리스팅을 되살린다 — 새 행을 또 만들면 unique(channel, product, option)에 걸려 다시는 연결할 수 없다
    listingId = Number(row.id);
    await db.query(`update erp.channel_listings set active = true, link_mode = 'single', label = $2 where id = $1`, [listingId, label]);
    await db.query(`delete from erp.listing_skus where listing_id = $1`, [listingId]);
    await db.query(`insert into erp.listing_skus (listing_id, sku_id, multiplier, origin) values ($1, $2, $3, 'manual')`, [listingId, p.skuId, p.multiplier]);
  } else {
    let ins: { id: unknown }[];
    try {
      ({ rows: ins } = await db.query(
        `insert into erp.channel_listings (channel, external_product_id, external_option_key, label, active, link_mode, origin)
         values ($1, $2, $3, $4, true, 'single', 'manual') returning id`,
        [p.channel, p.productId, p.optionKey, label],
      ));
    } catch (e) {
      // (리뷰 A5~A7 #4) 위 exists 검사와 이 insert 사이에 다른 요청이 끼어들면(unique 위반) 조용히 exists로 바꾼다
      const pg = e as { code?: unknown } | null;
      if (pg && pg.code === '23505') throw new LinkError('exists', '경합 — 방금 다른 요청이 같은 리스팅을 만들었다. 다시 시도한다');
      throw e;
    }
    listingId = Number(ins[0].id);
    await db.query(`insert into erp.listing_skus (listing_id, sku_id, multiplier, origin) values ($1, $2, $3, 'manual')`, [listingId, p.skuId, p.multiplier]);
  }
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
  // (리뷰 A5~A7 #6) 이미 리스팅으로 잘 매핑됐고 사람이 정하지 않은 줄까지 덮으면, 나중에 그 리스팅을 고쳐도
  // manual_sku_id가 우선하는 한(resolve.ts applyManualSku) 다시는 리스팅을 따라가지 않는다 — 조용히 묻힌다
  const { rows: linked } = await db.query(
    `select count(*)::int as n from erp.order_lines where id = any($1::bigint[]) and not (attribution = 'unattributed' or manual_sku_id is not null)`,
    [p.lineIds],
  );
  if (Number(linked[0].n) > 0) throw new LinkError('invalid', '이미 연결된 줄은 바꾸지 않는다');
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
