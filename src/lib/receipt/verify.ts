import type { ExtractedReceipt } from '@/lib/receipt/types';

/**
 * 검산 4종.
 *
 * 코스트코 영수증은 자체 검산 장치를 넷 들고 있다. 전부 쓴다 —
 * Vision 단독 추출의 유일한 약점이 숫자 오독이고, 이것이 방어선이다.
 */

export type CheckStatus = 'pass' | 'fail' | 'skipped';

export interface CheckResult {
  status: CheckStatus;
  /** 영수증이 스스로 주장하는 기준값 */
  expected: number | null;
  /** 품목에서 계산한 값 */
  actual: number | null;
  /** actual - expected */
  diff: number | null;
  /** 줄 단위 검사에서 어긋난 줄 번호 */
  badLineNos?: number[];
}

function skipped(): CheckResult {
  return { status: 'skipped', expected: null, actual: null, diff: null };
}

/**
 * 검산 1 — 품목 금액의 합이 결제 총액과 같은가.
 * 할인 줄은 음수이므로 단순 합으로 성립한다.
 */
export function checkTotalSum(receipt: ExtractedReceipt): CheckResult {
  if (receipt.receipt_total == null) return skipped();

  const actual = receipt.lines.reduce((sum, l) => sum + l.amount, 0);
  const expected = receipt.receipt_total;
  const diff = actual - expected;

  return { status: diff === 0 ? 'pass' : 'fail', expected, actual, diff };
}

/**
 * 검산 2 — 줄마다 수량 × 단가가 금액과 같은가.
 *
 * 나머지 검산과 질적으로 다르다. 1·3·4는 "어딘가 틀렸다"까지만 알려주지만
 * 이 검사는 틀린 줄을 특정해준다. 단가를 못 읽은 줄은 검사 대상에서 뺀다.
 */
export function checkLineArithmetic(receipt: ExtractedReceipt): CheckResult {
  const checkable = receipt.lines.filter((l) => l.unit_price != null);
  if (checkable.length === 0) return skipped();

  const badLineNos = checkable
    .filter((l) => Math.round(l.quantity * (l.unit_price as number)) !== Math.abs(l.amount))
    .map((l) => l.line_no);

  return {
    status: badLineNos.length === 0 ? 'pass' : 'fail',
    expected: null,
    actual: null,
    diff: null,
    badLineNos,
  };
}

/**
 * 검산 3 — 품목 수량의 합이 "총 판매 상품수"와 같은가.
 *
 * 총 판매 상품수는 줄 수가 아니라 수량 합계이며, 할인 줄은 여기서 빠진다.
 * 영수증 B에서 실증됐다 — 전체 수량 합은 39이지만 총 판매 상품수는 29다.
 */
export function checkItemCount(receipt: ExtractedReceipt): CheckResult {
  if (receipt.total_item_count == null) return skipped();

  const actual = receipt.lines
    .filter((l) => !l.is_discount)
    .reduce((sum, l) => sum + l.quantity, 0);
  const expected = receipt.total_item_count;
  const diff = actual - expected;

  return { status: diff === 0 ? 'pass' : 'fail', expected, actual, diff };
}

/**
 * 검산 4 — 세금 3종의 합이 결제 총액과 같고, 면세 상품 금액 합이 면세액과 같은가.
 *
 * 두 조건을 함께 본다. 앞은 세 값을 제대로 읽었는지를, 뒤는 줄별 과세 구분이
 * 맞는지를 검사한다. 영수증 B의 면세 26,280원이 우유 7,590 + 계란 18,690으로
 * 정확히 떨어지는 것이 확인됐다.
 */
export function checkTaxBreakdown(receipt: ExtractedReceipt): CheckResult {
  const { tax_exempt_total, taxable_total, vat, receipt_total } = receipt;
  if (tax_exempt_total == null || taxable_total == null || vat == null || receipt_total == null) {
    return skipped();
  }

  const actual = tax_exempt_total + taxable_total + vat;
  const diff = actual - receipt_total;

  const exemptFromLines = receipt.lines
    .filter((l) => l.tax_type === 'exempt')
    .reduce((sum, l) => sum + l.amount, 0);
  const exemptMatches = exemptFromLines === tax_exempt_total;

  return {
    status: diff === 0 && exemptMatches ? 'pass' : 'fail',
    expected: receipt_total,
    actual,
    diff,
    badLineNos: [],
  };
}

export type VerifyStatus = 'matched' | 'mismatch' | 'unreadable';

export interface VerifyResult {
  status: VerifyStatus;
  totalSum: CheckResult;
  lineArithmetic: CheckResult;
  itemCount: CheckResult;
  taxBreakdown: CheckResult;
}

/**
 * 검산 4종을 모두 돌려 종합 판정을 낸다.
 *
 * 판정 규칙:
 *   하나라도 fail  → mismatch
 *   전부 skipped   → unreadable (읽은 게 없어 검증 자체가 불가능)
 *   그 외          → matched
 *
 * mismatch라고 확정을 막지는 않는다. 봉투값 하나 때문에 기능 전체가 잠기면
 * 아무도 쓰지 않는다. 막는 것이 아니라 보이게 하는 것이 목적이다.
 */
export function verifyReceipt(receipt: ExtractedReceipt): VerifyResult {
  const totalSum = checkTotalSum(receipt);
  const lineArithmetic = checkLineArithmetic(receipt);
  const itemCount = checkItemCount(receipt);
  const taxBreakdown = checkTaxBreakdown(receipt);

  const all = [totalSum, lineArithmetic, itemCount, taxBreakdown];

  let status: VerifyStatus;
  if (all.some((c) => c.status === 'fail')) {
    status = 'mismatch';
  } else if (all.every((c) => c.status === 'skipped')) {
    status = 'unreadable';
  } else {
    status = 'matched';
  }

  return { status, totalSum, lineArithmetic, itemCount, taxBreakdown };
}
