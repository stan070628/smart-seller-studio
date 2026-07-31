/**
 * 1688 주문/장바구니 화면에서 드래그로 긁어 붙여넣은 텍스트를 파싱한다.
 *
 * 핵심 휴리스틱: 텍스트에서 모든 숫자를 뽑은 뒤
 *   단가(a) × 수량(b) ≈ 합계(c)
 * 관계가 성립하는 (a, b, c) 조합을 찾는다.
 * 이렇게 하면 "1~299개 : 6.93 / 300개 이상 : 6.53" 처럼 가격 구간이
 * 여러 개 섞여 있어도, 실제 주문에 적용된 단가·수량·합계만 정확히 골라낸다.
 */

export type Currency = 'rmb' | 'usd' | 'unknown';

export interface Parsed1688 {
  /** 실제 적용된 개당 단가 (통화는 currency 참조) */
  unitPrice: number | null;
  /** 주문 수량 */
  quantity: number | null;
  /** 합계 금액 */
  total: number | null;
  /** 감지된 통화. 1688 원본은 위안(rmb)이지만 대행/번역 뷰는 달러로 보이기도 함 */
  currency: Currency;
  /** 파싱에 사용된 원본 숫자들 (디버그/표시용) */
  numbers: number[];
}

/** 텍스트에서 양수 숫자를 모두 추출 (천단위 콤마 제거) */
function extractNumbers(text: string): number[] {
  const matches = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  const nums: number[] = [];
  for (const m of matches) {
    const n = Number(m.replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) nums.push(n);
  }
  return nums;
}

function detectCurrency(text: string): Currency {
  if (/(달러|USD|\$|dollar)/i.test(text)) return 'usd';
  if (/(위안|元|¥|人民币|RMB|CNY)/i.test(text)) return 'rmb';
  return 'unknown';
}

const isInteger = (n: number) => Number.isInteger(n);
const hasDecimal = (n: number) => !Number.isInteger(n);

interface Triple {
  unitPrice: number;
  quantity: number;
  total: number;
}

/**
 * 단가 × 수량 ≈ 합계 조합 탐색.
 *
 * 서로 다른 위치의 세 숫자로 만든 모든 후보를 모은 뒤 다음 순서로 정렬해 최적을 고른다:
 *   1) 단가에 소수점이 있으면 우선 (실제 1688 단가는 6.93 처럼 소수점을 가짐)
 *   2) 합계에 소수점이 있으면 우선
 *   3) 합계가 큰 조합 우선 (구간가·소계보다 실제 라인 합계를 선호)
 *   4) 단가 ≥ 수량 인 조합 우선 (전부 정수라 방향이 모호할 때의 tie-break)
 *
 * 허용오차는 매우 좁게 잡아, "1~299 / 300" 같은 가격 구간 표기가 우연히
 * 곱셈 관계처럼 보이는 가짜 매칭을 배제한다.
 */
function findPriceQtyTotal(numbers: number[]): Triple | null {
  const candidates: Triple[] = [];

  for (let i = 0; i < numbers.length; i++) {
    const price = numbers[i];
    for (let j = 0; j < numbers.length; j++) {
      if (j === i) continue;
      const qty = numbers[j];
      // 수량은 1 이상의 정수
      if (!isInteger(qty) || qty < 1) continue;
      const prod = price * qty;
      for (let k = 0; k < numbers.length; k++) {
        if (k === i || k === j) continue;
        const total = numbers[k];
        const tol = Math.max(0.05, prod * 0.001);
        if (Math.abs(prod - total) <= tol) {
          candidates.push({ unitPrice: price, quantity: qty, total });
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const ad = hasDecimal(a.unitPrice) ? 1 : 0;
    const bd = hasDecimal(b.unitPrice) ? 1 : 0;
    if (ad !== bd) return bd - ad;
    const at = hasDecimal(a.total) ? 1 : 0;
    const bt = hasDecimal(b.total) ? 1 : 0;
    if (at !== bt) return bt - at;
    if (a.total !== b.total) return b.total - a.total;
    const ao = a.unitPrice >= a.quantity ? 1 : 0;
    const bo = b.unitPrice >= b.quantity ? 1 : 0;
    return bo - ao;
  });

  return candidates[0];
}

export function parse1688Paste(text: string): Parsed1688 {
  const numbers = extractNumbers(text);
  const currency = detectCurrency(text);

  const match = findPriceQtyTotal(numbers);
  if (match) {
    return {
      unitPrice: match.unitPrice,
      quantity: match.quantity,
      total: match.total,
      currency,
      numbers,
    };
  }

  // 폴백: 소수점이 있는 가장 작은 숫자를 단가로 추정 (수량/합계는 미상)
  const decimals = numbers.filter((n) => !isInteger(n)).sort((a, b) => a - b);
  return {
    unitPrice: decimals.length > 0 ? decimals[0] : null,
    quantity: null,
    total: null,
    currency,
    numbers,
  };
}
