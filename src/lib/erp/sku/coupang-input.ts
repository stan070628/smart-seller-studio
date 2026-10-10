// src/lib/erp/sku/coupang-input.ts
// 쿠팡 상품 상세(getProductDetail 응답) → SKU 초안 입력 한 줄.
// 전체 적재(scripts/erp/sku-collect.ts)와 상품 하나 추가(sync-product.ts)가 같은 변환을 쓴다.
import type { DraftInput } from './draft';

export type CoupangProductInput = DraftInput['coupangProducts'][number];

export function toCoupangProduct(detail: unknown): CoupangProductInput {
  const d = detail as { sellerProductId: number; sellerProductName: string; items?: Record<string, unknown>[] };
  return {
    sellerProductId: Number(d.sellerProductId),
    productName: d.sellerProductName,
    items: (d.items ?? []).map((it) => {
      // 로켓그로스 동시 운영 상품은 Wing vid가 최상위가 아니라 marketplaceItemData.vendorItemId에 있다(2026-09-26 실측).
      const rg = it.rocketGrowthItemData as { vendorItemId?: number } | undefined;
      const mp = it.marketplaceItemData as { vendorItemId?: number } | undefined;
      const wing = it.vendorItemId ?? mp?.vendorItemId;
      return {
        itemName: String(it.itemName ?? ''),
        // 옵션 키가 쓰는 세 필드(이름·값·exposed)만 남기고, 값이 빈 속성은 버린다(초안 JSON 크기 절감).
        // 빈 속성은 옵션 조합에서도 어차피 걸러지지만, 값이 빈 `수량` 속성까지 버리므로 그런 item은
        // 수량을 itemName에서 읽는다(빈 값을 수량 1로 읽는 것보다 정확하다). exposed는 구매옵션(EXPOSED)과
        // 검색옵션(NONE)을 가르는 데 필요하므로 유지한다.
        attributes: Array.isArray(it.attributes)
          ? (it.attributes as { attributeTypeName: string; attributeValueName: string; exposed?: string }[])
              .filter((a) => String(a.attributeValueName ?? '').trim() !== '')
              .map((a) => ({ attributeTypeName: a.attributeTypeName, attributeValueName: a.attributeValueName, ...(a.exposed ? { exposed: a.exposed } : {}) }))
          : [],
        wingVid: wing ? Number(wing) : null,
        rgVid: rg?.vendorItemId ? Number(rg.vendorItemId) : null,
      };
    }),
  };
}

/** 상품의 모든 Wing·RG vid(item 순서, Wing 먼저) */
export const vidsOf = (p: CoupangProductInput): number[] =>
  p.items.flatMap((it) => [it.wingVid, it.rgVid]).filter((v): v is number => typeof v === 'number' && v > 0);
