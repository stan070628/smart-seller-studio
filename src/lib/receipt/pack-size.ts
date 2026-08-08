/**
 * 상품명에서 포장당 개수를 뽑는다.
 *
 * 어디까지나 제안이다. `36CT`가 판매 소분 단위와 같지는 않으므로
 * 입력란의 초깃값으로만 쓰고 자동 확정하지 않는다.
 */

// 단위를 이 다섯으로 한정한다. 단독 "P"는 넣지 않는다 —
// 상품명에 흔한 알파벳이라 "A2P" 같은 표기를 포장 수량으로 오인한다
const PACK_PATTERN = /(\d+)\s*(CT|PK|개|매|입)/gi;

export function extractPackSize(label: string): number | null {
  const matches = [...label.matchAll(PACK_PATTERN)];
  if (matches.length === 0) return null;

  // 여러 개 나오면 마지막 것이 포장 단위일 가능성이 높다 ("2단 선반 6개")
  const last = matches[matches.length - 1];
  const value = Number.parseInt(last[1], 10);

  return Number.isFinite(value) && value > 0 ? value : null;
}
