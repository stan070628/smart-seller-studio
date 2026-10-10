// src/lib/erp/sku/sync-product.ts
// 원가관리 상품 추가 → 그 쿠팡 상품의 SKU·리스팅·연결을 만든다(설계 docs/superpowers/specs/2026-10-10-erp-sku-auto-add-design.md).
// 키·옵션·배수·원가 연결은 전체 적재와 같은 buildDraft가 정한다. 그 상품 행만 upsert하고 보관·비활성화·연결 삭제는 하지 않는다.
// 이미 리스팅·SKU가 있는 상품은 건드리지 않는다 — 보정(sku-overrides.json)이 걸린 기존 상품은 전체 적재가 맡는다.
// 이 파일은 next/server를 끌어오지 않는다(스크립트가 import한다). 앱 연결부는 sync-app.ts.
import type { Db } from '@/lib/erp/ledger/store';
import { maskPII } from '@/lib/jobs/mask';
import { buildDraft, type DraftIssue, type DraftLink, type DraftListing, type DraftSku } from './draft';
import { toCoupangProduct, vidsOf, type CoupangProductInput } from './coupang-input';
import { readDraftDbInput } from './db-input';
import { insertLinks, lockSkuMaster, upsertListings, upsertSkus, validateDraft } from './upsert';

type Q = Pick<Db, 'query'>;

export type SkuSyncStatus = 'created' | 'exists' | 'failed' | 'skipped' | 'deferred';
/** 원가관리 응답의 skuSync. skipped = 상품번호 없음(가상 ID) · deferred = 한 요청의 상한(개수·시간)을 넘어 뒤로 미룸(실패 아님) */
export interface SkuSync {
  status: SkuSyncStatus;
  skus: number;
  error?: string;
  /** 만들지 않은 네이버·토스 리스팅 수(이미 있거나 다른 쿠팡 상품과 묶여 있다) — 전체 적재가 맡는다. 'created'일 때만 채운다 */
  skippedListings?: number;
}
export interface SyncPlan {
  skus: DraftSku[];
  listings: DraftListing[];
  links: DraftLink[];
  skippedListings: number;
  /** 이 상품의 SKU에 걸린 점검 이슈 */
  issues: DraftIssue[];
}
export type PlanResult =
  | { status: 'planned'; skus: number; plan: SyncPlan; issues: DraftIssue[] }
  | { status: 'skipped' | 'failed'; skus: 0; error?: string };

export interface SyncDeps {
  /** 트랜잭션 밖 읽기(존재 확인 · planOnly) */
  db: Q;
  /** 한 트랜잭션. 던지면 롤백 */
  tx: <T>(fn: (c: Q) => Promise<T>) => Promise<T>;
  coupang: { getProductDetail(sellerProductId: number): Promise<unknown> };
  /** 시계(ms) — 테스트용. 기본 Date.now */
  now?: () => number;
}

/** 오류 문구 → 화면·응답용: 개인정보 마스킹 후 300자 */
export const errMsg = (e: unknown) => maskPII(e instanceof Error ? e.message : String(e)).slice(0, 300);

/** 이 이슈가 나오면 자동 추가하지 않고 전체 적재(사람 검토)로 넘긴다 */
const BLOCKING_ISSUES = new Set(['suspect_merge', 'quantity_invalid']);

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
  let skippedListings = 0;
  if (shared.length > 0) {
    const { rows } = await db.query(
      `select channel || '|' || external_product_id || '|' || external_option_key as k from erp.channel_listings
        where channel || '|' || external_product_id || '|' || external_option_key = any($1::text[])`,
      [shared],
    );
    const existing = new Set(rows.map((r) => String(r.k)));
    skippedListings += listings.filter((l) => existing.has(l.key)).length;
    listings = listings.filter((l) => !existing.has(l.key));
    // 새로 만들 네이버·토스 리스팅이라도 같은 옵션에 이 상품 밖 쿠팡 vid가 묶여 있으면 이 상품만 본 초안이 묶음을 모른다 — 만들지 않는다
    const fresh = listings.filter((l) => shared.includes(l.key)).map((l) => l.key);
    if (fresh.length > 0) {
      const vids = new Set(vidsOf(product));
      const { rows: lk } = await db.query(
        `select channel || '|' || product_id || '|' || coalesce(option_key, '') as lk, coupang_vendor_item_id from stock_sync_links
          where channel || '|' || product_id || '|' || coalesce(option_key, '') = any($1::text[])`,
        [fresh],
      );
      const bundled = new Set(lk.filter((r) => !vids.has(Number(r.coupang_vendor_item_id))).map((r) => String(r.lk)));
      skippedListings += listings.filter((l) => bundled.has(l.key)).length;
      listings = listings.filter((l) => !bundled.has(l.key));
    }
  }
  const keep = new Set(listings.map((l) => l.key));
  const links = d.links.filter((l) => keep.has(l.listingKey) && skuKeys.has(l.skuKey));
  const issues = d.issues.filter((i) => i.ref.startsWith(prefix));
  return { skus, listings, links, skippedListings, issues };
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
      return { status: 'planned', skus: plan.skus.length, plan, issues: plan.issues };
    }
    if (await hasSkuRows(deps.db, sellerProductId)) return { status: 'exists', skus: 0 };
    const product = await fetchProduct(deps.coupang, sellerProductId);
    return await deps.tx(async (c): Promise<SkuSync> => {
      await lockSkuMaster(c);
      // 쿠팡을 기다리는 사이 다른 요청(bulk · SKU 다시 맞추기 · 전체 적재)이 먼저 만들었을 수 있다
      if (await hasSkuRows(c, sellerProductId)) return { status: 'exists', skus: 0 };
      const plan = await planFor(c, product);
      const blocking = [...new Set(plan.issues.filter((i) => BLOCKING_ISSUES.has(i.kind)).map((i) => i.kind))];
      if (blocking.length > 0) return { status: 'failed', skus: 0, error: `검토 필요(${blocking.join(', ')}) — 전체 적재로 처리한다` };
      validateDraft(plan);
      const skuId = await upsertSkus(c, plan.skus);
      const listingId = await upsertListings(c, plan.listings);
      await insertLinks(c, plan.links, skuId, listingId);
      return { status: 'created', skus: plan.skus.length, skippedListings: plan.skippedListings };
    });
  } catch (e) {
    return { status: 'failed', skus: 0, error: errMsg(e) };
  }
}

/** 「SKU 다시 맞추기」 한 번에 도는 상품 수 — 쿠팡 상세 조회를 순서대로 부르므로 함수 시간(300초) 안에 든다 */
export const SYNC_MISSING_CAP = 20;
/** 이 시간이 지나면 새 상품을 시작하지 않는다 */
export const SYNC_MISSING_DEADLINE_MS = 240_000;

export interface SyncMissingRow extends SkuSync {
  sellerProductId: number;
  productName: string;
}
export interface SyncMissingResult {
  results: SyncMissingRow[];
  /** status 'created'인 상품 수 */
  created: number;
  exists: number;
  failed: number;
  /** 새로 만든 SKU 수 */
  skus: number;
  /** 상한을 넘어 남은 상품이 있다 */
  more: boolean;
}

/** 원가관리에 쿠팡 상품번호가 있는데 리스팅·SKU가 없는 상품(최근 추가 순)을 상한까지 syncSellerProduct */
export async function syncMissing(deps: SyncDeps, cap = SYNC_MISSING_CAP): Promise<SyncMissingResult> {
  const { rows } = await deps.db.query(
    `select pc.seller_product_id as id, max(pc.product_name) as name, max(pc.created_at) as at
       from product_costs pc
      where pc.seller_product_id > 0
        and not exists (select 1 from erp.channel_listings l where l.alt_product_id = pc.seller_product_id::text)
        and not exists (select 1 from erp.skus s where s.key like 'cp:' || pc.seller_product_id || ':%')
      group by pc.seller_product_id
      order by at desc, id desc
      limit $1`,
    [cap + 1],
  );
  const results: SyncMissingRow[] = [];
  const now = deps.now ?? Date.now;
  const started = now();
  let timedOut = false;
  for (const row of rows.slice(0, cap)) {
    // 함수 시간(300초)을 넘기지 않게 — 240초가 지나면 새 상품을 시작하지 않고 more로 남긴다
    if (now() - started > SYNC_MISSING_DEADLINE_MS) { timedOut = true; break; }
    const sellerProductId = Number(row.id);
    const r = await syncSellerProduct(deps, sellerProductId);
    results.push({ sellerProductId, productName: String(row.name ?? ''), ...r });
  }
  const count = (s: SkuSyncStatus) => results.filter((x) => x.status === s).length;
  return {
    results,
    created: count('created'),
    exists: count('exists'),
    failed: count('failed'),
    skus: results.filter((x) => x.status === 'created').reduce((s, x) => s + x.skus, 0),
    more: rows.length > cap || timedOut,
  };
}
