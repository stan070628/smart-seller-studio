/**
 * option-parser.ts
 * 도매꾹 selectOpt JSON → NormalizedOption 변환
 *
 * selectOpt 구조 (도매꾹 API v4.5):
 *   type: "combination"
 *   set[]: [{ name: "색상", opts: ["블랙","화이트"], domPrice: ["0","1500"] }]
 *   data:  { "00": { name, domPrice, qty, hid, hash, ... }, "00_01": ... }
 *
 * data 키 패턴:
 *   1축: "00", "01", "02"
 *   2축: "00_00", "00_01", "01_00"
 *   3축: "00_00_00" (이론상)
 */

import type {
  DgSelectOpt,
  DgRawOptionData,
  NormalizedOptionGroup,
  NormalizedOptionVariant,
  ProductOptions,
} from '@/types/product-option';
import {
  getCategoryFeeRate,
  VAT_RATE,
  DOMEGGOOK_TARGET_MARGIN_RATE,
} from '@/lib/sourcing/shared/channel-policy';

/**
 * 원가합계 기반 채널별 추천 판매가 계산 (100원 단위 반올림)
 *
 * 공식: (원가합계 + 목표이익) / (1 - 채널수수료 - VAT)
 *   - 원가합계 = 도매가 + 옵션추가금액 + 배송비
 *   - 목표이익 = 원가합계 × 목표마진율
 *   - VAT = 10/110 ≈ 9.09%
 */
function calcOptionRecommendedPrice(
  costTotal: number,
  categoryName: string | null,
  channel: 'naver' | 'coupang',
): number {
  const feeRate = getCategoryFeeRate(categoryName, channel);
  const targetProfit = costTotal * DOMEGGOOK_TARGET_MARGIN_RATE;
  const divisor = 1 - feeRate - VAT_RATE;
  if (divisor <= 0) return Math.round(costTotal * 2);
  return Math.round((costTotal + targetProfit) / divisor / 100) * 100;
}

/** 파서 옵션: 배송비·카테고리 정보를 외부에서 주입 */
export interface ParseOptionsContext {
  /** 도매꾹 배송비 (원). 0이면 무료배송 */
  deliveryFee?: number;
  /** 카테고리명 (채널별 수수료율 결정용) */
  categoryName?: string | null;
}

/**
 * 도매꾹 selectOpt JSON 문자열을 정규화된 ProductOptions로 변환.
 *
 * @param selectOptStr - getItemView 응답의 selectOpt 필드 (JSON string)
 * @param baseDomePrice - 기본 도매가 (원)
 * @param ctx - 배송비·카테고리 컨텍스트 (없으면 기본값 사용)
 * @returns ProductOptions (옵션 없으면 hasOptions=false, groups/variants 빈 배열)
 */
export function parseDomeggookOptions(
  selectOptStr: string | undefined | null,
  baseDomePrice: number,
  ctx?: ParseOptionsContext,
): ProductOptions {
  const deliveryFee = ctx?.deliveryFee ?? 0;
  const categoryName = ctx?.categoryName ?? null;
  const empty: ProductOptions = { hasOptions: false, groups: [], variants: [] };

  if (!selectOptStr || selectOptStr.trim() === '') {
    return empty;
  }

  let raw: DgSelectOpt;
  try {
    raw = JSON.parse(selectOptStr);
  } catch (e) {
    console.warn('[option-parser] selectOpt JSON 파싱 실패:', e);
    return empty;
  }

  // set 배열 없으면 옵션 없는 상품
  if (!raw.set || !Array.isArray(raw.set) || raw.set.length === 0) {
    return empty;
  }

  // data 객체 없으면 옵션 조합 불가
  if (!raw.data || typeof raw.data !== 'object') {
    console.warn('[option-parser] selectOpt에 data 필드 없음');
    return empty;
  }

  // ── 1. 옵션 그룹 추출 ──────────────────────────────────────
  const groups: NormalizedOptionGroup[] = raw.set.map((s, i) => ({
    order: i,
    groupName: s.name || `옵션${i + 1}`,
    values: Array.isArray(s.opts) ? s.opts : [],
  }));

  // ── 2. 옵션 조합 (variants) 추출 ───────────────────────────
  const variants: NormalizedOptionVariant[] = [];
  const dataEntries = Object.entries(raw.data);

  for (const [key, item] of dataEntries) {
    if (!item || typeof item !== 'object') continue;

    const d = item as DgRawOptionData;

    // 키에서 옵션 인덱스 추출: "00_01" → [0, 1]
    const indices = key.split('_').map((k) => parseInt(k, 10));

    // 옵션 값 조합 결정
    const optionValues = indices.map((idx, groupIdx) => {
      const group = groups[groupIdx];
      if (!group) return d.name || '';
      return group.values[idx] || d.name || '';
    });

    // 추가금액 + 배송비 포함 원가합계
    const addPrice = parseInt(d.domPrice, 10) || 0;
    const costPrice = baseDomePrice + addPrice;
    const costTotal = costPrice + deliveryFee;

    // 재고/상태
    const stock = parseInt(d.qty, 10) || 0;
    const soldOut = d.hid === '2';
    const hidden = d.hid === '1';

    variants.push({
      variantId: `v_${key}`,
      optionValues,
      sourceHash: d.hash || null,
      costPrice: costTotal,
      salePrices: {
        coupang: calcOptionRecommendedPrice(costTotal, categoryName, 'coupang'),
        naver: calcOptionRecommendedPrice(costTotal, categoryName, 'naver'),
      },
      stock,
      soldOut,
      hidden,
      enabled: !soldOut && !hidden && stock > 0,
    });
  }

  // 정렬: 키 순서대로 (00_00, 00_01, 01_00, ...)
  variants.sort((a, b) => a.variantId.localeCompare(b.variantId));

  return {
    hasOptions: variants.length > 0,
    groups,
    variants,
  };
}
