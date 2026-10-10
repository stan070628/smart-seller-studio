// src/lib/erp/sku/sync-product.ts
// 원가관리 상품 추가 → 그 쿠팡 상품의 SKU·리스팅·연결을 만든다(설계 docs/superpowers/specs/2026-10-10-erp-sku-auto-add-design.md).
// 키·옵션·배수·원가 연결은 전체 적재와 같은 buildDraft가 정한다. 그 상품 행만 upsert하고 보관·비활성화·연결 삭제는 하지 않는다.
// 이미 리스팅·SKU가 있는 상품은 건드리지 않는다 — 보정(sku-overrides.json)이 걸린 기존 상품은 전체 적재가 맡는다.
// 이 파일은 next/server를 끌어오지 않는다(스크립트가 import한다). 앱 연결부는 sync-app.ts.
import type { Db } from '@/lib/erp/ledger/store';
import { buildDraft, type DraftLink, type DraftListing, type DraftSku } from './draft';
import { toCoupangProduct, vidsOf, type CoupangProductInput } from './coupang-input';
import { readDraftDbInput } from './db-input';
import { insertLinks, lockSkuMaster, upsertListings, upsertSkus, validateDraft } from './upsert';

type Q = Pick<Db, 'query'>;

export type SkuSyncStatus = 'created' | 'exists' | 'failed' | 'skipped';
/** 원가관리 응답의 skuSync. skipped = 상품번호 없음(가상 ID) */
export interface SkuSync {
  status: SkuSyncStatus;
  skus: number;
  error?: string;
}
export interface SyncPlan {
  skus: DraftSku[];
  listings: DraftListing[];
  links: DraftLink[];
}
export type PlanResult =
  | { status: 'planned'; skus: number; plan: SyncPlan }
  | { status: 'skipped' | 'failed'; skus: 0; error?: string };

export interface SyncDeps {
  /** 트랜잭션 밖 읽기(존재 확인 · planOnly) */
  db: Q;
  /** 한 트랜잭션. 던지면 롤백 */
  tx: <T>(fn: (c: Q) => Promise<T>) => Promise<T>;
  coupang: { getProductDetail(sellerProductId: number): Promise<unknown> };
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 그 상품번호의 리스팅(alt_product_id) 또는 SKU 키(cp:<id>:…)가 하나라도 있으면 true */
async function hasSkuRows(db: Q, sellerProductId: number): Promise<boolean> {
  const { rows } = await db.query(
    `select exists (select 1 from erp.channel_listings where alt_product_id = $1)
         or exists (select 1 from erp.skus where key like $2) as hit`,
    [String(sellerProductId), `cp:${sellerProductId}:%`],
  );
  return rows[0]?.hit === true;
}

async function fetchProduct(coupang: SyncDeps['coupang'], sellerProductId: number): Promise<CoupangProductInput> {
  const p = toCoupangProduct(await coupang.getProductDetail(sellerProductId));
  if (p.sellerProductId !== sellerProductId) throw new Error(`쿠팡 응답의 상품번호가 다르다: ${p.sellerProductId}`);
  if (vidsOf(p).length === 0) throw new Error('쿠팡 옵션에 vid가 없다(승인 전 상품일 수 있다)');
  return p;
}

/** DB 입력을 그 상품으로 좁혀 buildDraft → 그 상품의 SKU와 그 SKU에 닿는 리스팅·연결만 */
async function planFor(db: Q, product: CoupangProductInput): Promise<SyncPlan> {
  const id = product.sellerProductId;
  const rest = await readDraftDbInput(db, { sellerProductId: id, vids: vidsOf(product) });
  const d = buildDraft({ ...rest, coupangProducts: [product] });
  const prefix = `cp:${id}:`;
  const skus = d.skus.filter((s) => s.key.startsWith(prefix));
  const skuKeys = new Set(skus.map((s) => s.key));
  const touched = new Set(d.links.filter((l) => skuKeys.has(l.skuKey)).map((l) => l.listingKey));
  let listings = d.listings.filter((l) => touched.has(l.key));
  // 네이버·토스 리스팅이 이미 있으면(다른 상품과 any_of로 묶인 것 등) 건드리지 않는다 — 이 상품만 본 초안은
  // 묶음의 다른 상품을 몰라 link_mode를 잘못 덮는다. 그 경우는 전체 적재가 맡는다.
  const shared = listings.filter((l) => l.channel === 'naver' || l.channel === 'toss').map((l) => l.key);
  if (shared.length > 0) {
    const { rows } = await db.query(
      `select channel || '|' || external_product_id || '|' || external_option_key as k from erp.channel_listings
        where channel || '|' || external_product_id || '|' || external_option_key = any($1::text[])`,
      [shared],
    );
    const existing = new Set(rows.map((r) => String(r.k)));
    listings = listings.filter((l) => !existing.has(l.key));
  }
  const keep = new Set(listings.map((l) => l.key));
  const links = d.links.filter((l) => keep.has(l.listingKey) && skuKeys.has(l.skuKey));
  return { skus, listings, links };
}

/**
 * 쿠팡 상품 하나 → SKU·리스팅·연결. 던지지 않는다(실패는 status 'failed').
 * planOnly: 존재 확인·잠금·쓰기 없이 만들 행만 돌려준다(운영 대조용 — scripts/erp/sku-sync-compare.ts).
 */
export async function syncSellerProduct(deps: SyncDeps, sellerProductId: number, opts: { planOnly: true }): Promise<PlanResult>;
export async function syncSellerProduct(deps: SyncDeps, sellerProductId: number, opts?: { planOnly?: false }): Promise<SkuSync>;
export async function syncSellerProduct(
  deps: SyncDeps,
  sellerProductId: number,
  opts: { planOnly?: boolean } = {},
): Promise<SkuSync | PlanResult> {
  if (!Number.isInteger(sellerProductId) || sellerProductId <= 0) return { status: 'skipped', skus: 0 };
  try {
    if (opts.planOnly) {
      const product = await fetchProduct(deps.coupang, sellerProductId);
      const plan = await planFor(deps.db, product);
      return { status: 'planned', skus: plan.skus.length, plan };
    }
    if (await hasSkuRows(deps.db, sellerProductId)) return { status: 'exists', skus: 0 };
    const product = await fetchProduct(deps.coupang, sellerProductId);
    return await deps.tx(async (c): Promise<SkuSync> => {
      await lockSkuMaster(c);
      // 쿠팡을 기다리는 사이 다른 요청(bulk · SKU 다시 맞추기 · 전체 적재)이 먼저 만들었을 수 있다
      if (await hasSkuRows(c, sellerProductId)) return { status: 'exists', skus: 0 };
      const plan = await planFor(c, product);
      validateDraft(plan);
      const skuId = await upsertSkus(c, plan.skus);
      const listingId = await upsertListings(c, plan.listings);
      await insertLinks(c, plan.links, skuId, listingId);
      return { status: 'created', skus: plan.skus.length };
    });
  } catch (e) {
    return { status: 'failed', skus: 0, error: errMsg(e) };
  }
}
