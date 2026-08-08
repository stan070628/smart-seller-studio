import type { ExtractedLine } from '@/lib/receipt/types';

/**
 * 할인 귀속.
 *
 * 추출 단계에서는 할인을 독립 줄로 둔다 — 할인 줄이 원 품목과 다른 품번·상품명을
 * 갖기 때문에, 모델에게 합치게 하면 틀린 귀속이 조용히 섞인다. 대신 여기서
 * 위치 기반으로 귀속을 제안하고, 사람이 검토 화면에서 확인한다.
 */

export interface AttributedLine extends ExtractedLine {
  /** 이 할인 줄이 귀속되는 품목 줄의 line_no. 품목 줄이면 null */
  applies_to_line_no: number | null;
}

/**
 * 할인 줄을 직전 비할인 줄에 연결한다.
 * 앞에 품목 줄이 없으면 null로 둔다 — 귀속할 곳이 없다는 사실 자체를 남긴다.
 */
export function attributeDiscounts(lines: ExtractedLine[]): AttributedLine[] {
  let lastItemLineNo: number | null = null;

  return lines.map((line) => {
    if (!line.is_discount) {
      lastItemLineNo = line.line_no;
      return { ...line, applies_to_line_no: null };
    }
    return { ...line, applies_to_line_no: lastItemLineNo };
  });
}

/**
 * 품목 줄의 할인 반영 금액.
 *
 * 단가 차감이 아니라 금액 합산으로 계산한다. 확인된 쿠폰은 원 품목과 수량이
 * 같았지만(5x ↔ 5x), 수량이 다르거나 정액인 할인 형태를 아직 못 봤다.
 * 금액 합산이면 어떤 형태가 와도 성립한다.
 */
export function netAmountOf(lines: AttributedLine[], lineNo: number): number {
  const target = lines.find((l) => l.line_no === lineNo && !l.is_discount);
  if (!target) return 0;

  const discounts = lines
    .filter((l) => l.is_discount && l.applies_to_line_no === lineNo)
    .reduce((sum, l) => sum + l.amount, 0);

  return target.amount + discounts;
}
