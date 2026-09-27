import type { Tier } from '@/lib/sourcing-candidates/types';

/**
 * 판독 숫자의 자기검증.
 *
 * Vision 판독의 약점은 숫자 오독이다(영수증 판독과 같다). 네이버 카드는 판매가·정가·
 * 할인율 세 숫자가 서로를 검산하므로 그것을 쓴다. 틀리면 막지 않고 표시만 한다 —
 * 표에서 사람이 고칠 수 있다.
 */
export function checkListingNumbers(l: {
  price: number;
  list_price: number | null;
  discount_pct: number | null;
}): string | null {
  if (l.list_price === null) return null;
  if (l.price > l.list_price) return '판매가가 정가보다 큼';
  if (l.discount_pct === null) return null;
  const computed = Math.round((1 - l.price / l.list_price) * 100);
  if (Math.abs(computed - l.discount_pct) > 1) {
    return `할인율 불일치 (표시 ${l.discount_pct}% · 계산 ${computed}%)`;
  }
  return null;
}

/** 1688 구간가는 수량이 늘수록 같거나 싸야 한다 */
export function checkTiers(tiers: Tier[]): string | null {
  const sorted = [...tiers].sort((a, b) => a.min_qty - b.min_qty);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].cny > sorted[i - 1].cny) return '구간가가 수량이 늘수록 오름 — 판독 확인';
  }
  return null;
}
