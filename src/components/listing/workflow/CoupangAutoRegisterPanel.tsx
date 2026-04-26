'use client';

// ─── buildDraftData: 로컬 state → /api/listing/coupang/drafts 페이로드 변환 ───

export interface DraftFormState {
  name: string;
  categoryCode: string;
  brand: string;
  manufacturer: string;
  salePrice: number;
  originalPrice: number;
  stock: number;
  thumbnail: string;
  detailHtml: string;
  deliveryChargeType: 'FREE' | 'NOT_FREE';
  deliveryCharge: number;
  outboundCode: string;
  returnCode: string;
  notices: { categoryName: string; detailName: string; content: string }[];
  tags: string[];
  detailImages: string[];
}

export interface DraftData {
  name: string;
  categoryCode: string;
  brand: string;
  manufacturer: string;
  salePrice: number;
  originalPrice: number;
  stock: number;
  thumbnail: string;
  detailHtml: string;
  deliveryChargeType: 'FREE' | 'NOT_FREE';
  deliveryCharge: number;
  outboundCode: string;
  returnCode: string;
  notices: { categoryName: string; detailName: string; content: string }[];
  tags: string[];
  detailImages: string[];
}

export function buildDraftData(s: DraftFormState): DraftData {
  // thumbnail 폴백: thumbnail 없으면 detailImages[0] 사용
  const thumbnail = s.thumbnail || s.detailImages[0] || '';

  // originalPrice 보정: salePrice 이하면 salePrice × 1.25 올림
  const safeOriginal =
    s.originalPrice > s.salePrice
      ? s.originalPrice
      : Math.ceil((s.salePrice * 1.25) / 1000) * 1000;

  return {
    name: s.name,
    categoryCode: s.categoryCode,
    brand: s.brand,
    manufacturer: s.manufacturer,
    salePrice: s.salePrice,
    originalPrice: safeOriginal,
    stock: s.stock,
    thumbnail,
    detailHtml: s.detailHtml,
    deliveryChargeType: s.deliveryChargeType,
    deliveryCharge: s.deliveryCharge,
    outboundCode: s.outboundCode,
    returnCode: s.returnCode,
    notices: s.notices,
    tags: s.tags,
    detailImages: s.detailImages,
  };
}
