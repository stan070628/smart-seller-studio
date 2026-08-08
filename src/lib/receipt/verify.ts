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
