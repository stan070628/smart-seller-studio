// 전체 적재(sku-apply --apply)의 오래된 초안 거부.
// 초안은 수집 시점의 쿠팡·DB를 본 것이다. 그 뒤에 원가관리 상품 추가(sync-product)가 만든 SKU·리스팅은 초안에 없어서,
// 그대로 적재하면 「초안에서 빠진 draft 행」으로 보고 보관·비활성화·연결 삭제를 한다.
// 수집 뒤 생긴 draft 행이라도 초안에 있으면(= 이 초안을 적재해서 생긴 행) 문제가 아니므로 센다에서 뺀다.
import type { Db } from '@/lib/erp/ledger/store';

export interface DraftKeys {
  skuKeys: Set<string>;
  /** `channel|external_product_id|external_option_key` */
  listingKeys: Set<string>;
}

export async function findNewerThanDraft(
  db: Pick<Db, 'query'>,
  collectedAt: Date,
  draft: DraftKeys,
): Promise<{ skus: string[]; listings: string[]; count: number }> {
  const at = collectedAt.toISOString();
  const skus = (await db.query(`select key from erp.skus where origin = 'draft' and created_at > $1`, [at])).rows
    .map((r) => String(r.key))
    .filter((k) => !draft.skuKeys.has(k));
  const listings = (
    await db.query(
      `select channel || '|' || external_product_id || '|' || external_option_key as key from erp.channel_listings where origin = 'draft' and created_at > $1`,
      [at],
    )
  ).rows
    .map((r) => String(r.key))
    .filter((k) => !draft.listingKeys.has(k));
  return { skus, listings, count: skus.length + listings.length };
}

export const staleDraftMessage = (draftFile: string, collectedAt: string, count: number) =>
  `초안(${draftFile}, ${collectedAt})보다 새로 생긴 SKU/리스팅 ${count}개가 있다 — sku-collect를 먼저 다시 돌린다`;
