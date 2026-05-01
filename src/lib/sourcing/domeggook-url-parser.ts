import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import type { ProductInfo } from '@/types/sourcing';

const DOMEGGOOK_ITEM_REGEX = /^https?:\/\/(?:www\.)?domeggook\.com\/main\/item\.php\?(?:[^&#]*&)*id=(\d+)/i;

/**
 * 도매꾹 상품 페이지 URL에서 상품번호(itemNo)를 추출.
 * 도매꾹 URL이 아니거나 id 파라미터가 없으면 null.
 */
export function extractItemNoFromUrl(url: string): number | null {
  const m = url.match(DOMEGGOOK_ITEM_REGEX);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const toNum = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseInt(v.replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

/**
 * 도매꾹 URL → 상품 정보 추출.
 * 지원 안 되는 URL이거나 API 실패 시 null.
 */
export async function parseDomeggookUrl(url: string): Promise<ProductInfo | null> {
  const itemNo = extractItemNoFromUrl(url);
  if (itemNo === null) return null;

  try {
    const client = getDomeggookClient();
    const detail = await client.getItemView(itemNo);
    return {
      source: 'domeggook',
      title: detail.basis?.title ?? `상품 #${itemNo}`,
      image: detail.thumb?.original ?? detail.image?.url ?? null,
      price: toNum(detail.price?.dome),
      supplyPrice: toNum(detail.price?.supply),
      marketPrice: null,
      itemNo,
      url,
    };
  } catch {
    return null;
  }
}
