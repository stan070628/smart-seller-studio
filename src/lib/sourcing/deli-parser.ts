/**
 * deli-parser.ts
 * 도매꾹 API의 deli 필드에서 유효 배송비를 추출하는 유틸
 *
 * 도매꾹 API는 버전·상품에 따라 deli 구조가 다르게 내려옵니다:
 *   - 구형: { who: "S"|"P"|"B", fee: 3000 }
 *   - 신형: { pay: "무료"|"선결제"|"착불", dome: { type: "수량별비례", tbl: "30+3000|30+3000" } }
 *
 * tbl 형식: "수량+금액|수량+금액|..."
 *   첫 번째 구간의 금액을 기본 배송비로 사용 (MOQ=1 기준)
 */

/**
 * deli.dome.tbl 문자열에서 기본 배송비 추출
 * ex) "30+3000|30+3000" → 3000
 */
function parseDeliTbl(tbl: unknown): number {
  if (typeof tbl !== 'string' || !tbl) return 0;
  const firstFee = parseInt(tbl.split('|')[0]?.split('+')[1] ?? '0', 10);
  return isNaN(firstFee) ? 0 : firstFee;
}

/**
 * 도매꾹 deli 필드에서 실효 배송비(원)를 반환합니다.
 * 무료배송이면 0, 유료배송이면 실제 배송비를 반환합니다.
 *
 * @param deli - getItemView 응답의 deli 필드 (타입 불명확하므로 unknown)
 */
export function parseEffectiveDeliFee(deli: unknown): number {
  if (!deli || typeof deli !== 'object') return 0;

  const deliRaw = deli as Record<string, unknown>;
  const deliDome = deliRaw.dome as Record<string, unknown> | undefined;

  // 무료배송 여부 판단
  // 신형: deli.pay === "무료"
  // 구형: deli.who === "S"
  const deliPay = (deliRaw.pay as string | undefined) ?? '';
  const deliWho = (deliRaw.who as string | undefined) ?? '';
  const isFreeShipping = deliPay === '무료' || deliWho === 'S';
  if (isFreeShipping) return 0;

  // 배송비 금액 추출: fee 필드 우선, 없으면 tbl 첫 구간 파싱
  const feeRaw = deliDome?.fee ?? deliRaw.fee;
  const feeFromField =
    typeof feeRaw === 'string'
      ? parseInt(feeRaw, 10) || 0
      : typeof feeRaw === 'number'
        ? feeRaw
        : 0;

  return feeFromField > 0
    ? feeFromField
    : parseDeliTbl(deliDome?.tbl ?? deliRaw.tbl);
}
