/**
 * 영수증 추출 결과 타입.
 * spec §5-4의 Vision 추출 계약과 1:1 대응한다.
 */

/** 과세 구분. 코스트코 영수증은 과세 상품 금액 뒤에 T를 붙인다 */
export type TaxType = 'taxable' | 'exempt' | 'unknown';

/**
 * 추출된 품목 1줄. 품목과 할인이 같은 타입을 쓴다.
 *
 *   품목 줄 — is_discount=false, amount > 0
 *   할인 줄 — is_discount=true,  amount < 0
 *
 * 할인 줄은 원 품목과 품번도 상품명도 다르다. 잇는 단서는 위치(직전 품목 줄)뿐이며,
 * 귀속은 이 타입이 아니라 discount 모듈이 다룬다.
 *
 * 두 역할 모두 `quantity × unit_price === |amount|`를 만족한다.
 */
export interface ExtractedLine {
  /** 영수증 상의 순서. 확정 순서를 결정하므로 1부터 연속이어야 한다 */
  line_no: number;
  /** 코스트코 품번. 5~7자리 가변. 봉투값 등 품번 없는 줄은 null */
  item_code: string | null;
  /** 영수증 표기 상품명. 할인 줄에서는 쿠폰 이름이라 원 품목명과 다르다 */
  item_label: string;
  quantity: number;
  /**
   * 단가. 줄 검산의 근거.
   *
   * 할인 줄에도 값이 있다 — 영수증이 쿠폰을 `5x 7,000`처럼 수량·단가로 인쇄하기 때문이다.
   * 우리가 역산한 값이 아니라 영수증에 찍힌 값 그대로다.
   */
  unit_price: number | null;
  /** 금액. 할인 줄은 음수 */
  amount: number;
  /** CPN 할인 줄 여부 */
  is_discount: boolean;
  tax_type: TaxType;
}

/** 영수증 1장의 추출 결과 */
export interface ExtractedReceipt {
  store_name: string | null;
  /** YYYY-MM-DD. 영수증에는 MM/DD/YYYY로 찍힌다 */
  purchased_at: string | null;
  /** HH:MM */
  purchased_time: string | null;
  /** "REG:8"의 8 */
  register_no: string | null;
  /** 합계 (VAT 포함) */
  receipt_total: number | null;
  /** 총 판매 상품수. 줄 수가 아니라 수량 합계다 */
  total_item_count: number | null;
  tax_exempt_total: number | null;
  taxable_total: number | null;
  vat: number | null;
  lines: ExtractedLine[];
}
