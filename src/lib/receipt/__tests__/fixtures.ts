import type { ExtractedReceipt } from '@/lib/receipt/types';

/**
 * 실제 코스트코 영수증 추출 결과 (2026-08-08 양재점).
 * 검산 4종이 전부 통과한 값이므로 회귀 기준선으로 쓴다.
 */

/** 3품목, PRESCAN 구간, 같은 품번 2줄(693817) */
export const RECEIPT_A: ExtractedReceipt = {
  store_name: '코스트코 코리아 양재점',
  purchased_at: '2026-08-08',
  purchased_time: '09:05',
  register_no: '8',
  receipt_total: 587630,
  total_item_count: 19,
  tax_exempt_total: 0,
  taxable_total: 534209,
  vat: 53421,
  lines: [
    { line_no: 1, item_code: '713160', item_label: 'KS노랑타월36CT', quantity: 17, unit_price: 23990, amount: 407830, is_discount: false, tax_type: 'taxable' },
    { line_no: 2, item_code: '693817', item_label: '콜맨웨건', quantity: 1, unit_price: 89900, amount: 89900, is_discount: false, tax_type: 'taxable' },
    { line_no: 3, item_code: '693817', item_label: '콜맨웨건', quantity: 1, unit_price: 89900, amount: 89900, is_discount: false, tax_type: 'taxable' },
  ],
};

/** 13품목, CPN 할인 2건, 면세 2건, 상품수 소계 3그룹, 같은 품번 2줄(690437) */
export const RECEIPT_B: ExtractedReceipt = {
  store_name: '코스트코 코리아 양재점',
  purchased_at: '2026-08-08',
  purchased_time: '10:16',
  register_no: '17',
  receipt_total: 724310,
  total_item_count: 29,
  tax_exempt_total: 26280,
  taxable_total: 634572,
  vat: 63458,
  lines: [
    { line_no: 1, item_code: '690437', item_label: '아이더호보백', quantity: 9, unit_price: 29990, amount: 269910, is_discount: false, tax_type: 'taxable' },
    { line_no: 2, item_code: '7771922', item_label: 'KS라운드티6매 L', quantity: 5, unit_price: 32990, amount: 164950, is_discount: false, tax_type: 'taxable' },
    { line_no: 3, item_code: '16612', item_label: 'KS 라운드티IRC', quantity: 5, unit_price: 7000, amount: -35000, is_discount: true, tax_type: 'taxable' },
    { line_no: 4, item_code: '7771923', item_label: 'KS라운드티6매XL', quantity: 5, unit_price: 32990, amount: 164950, is_discount: false, tax_type: 'taxable' },
    { line_no: 5, item_code: '16612', item_label: 'KS 라운드티IRC', quantity: 5, unit_price: 7000, amount: -35000, is_discount: true, tax_type: 'taxable' },
    { line_no: 6, item_code: '693791', item_label: '위트빅스프로틴', quantity: 1, unit_price: 14990, amount: 14990, is_discount: false, tax_type: 'taxable' },
    { line_no: 7, item_code: '674362', item_label: 'SEOUL A2+우유2.3', quantity: 1, unit_price: 7590, amount: 7590, is_discount: false, tax_type: 'exempt' },
    { line_no: 8, item_code: '660234', item_label: '소금버터빵 6CT', quantity: 1, unit_price: 11990, amount: 11990, is_discount: false, tax_type: 'taxable' },
    { line_no: 9, item_code: '301904', item_label: 'KS M.쇼비뇽블랑', quantity: 1, unit_price: 11290, amount: 11290, is_discount: false, tax_type: 'taxable' },
    { line_no: 10, item_code: '695917', item_label: '라비오라워시팩', quantity: 3, unit_price: 24990, amount: 74970, is_discount: false, tax_type: 'taxable' },
    { line_no: 11, item_code: '637146', item_label: '동물복지란60개', quantity: 1, unit_price: 18690, amount: 18690, is_discount: false, tax_type: 'exempt' },
    { line_no: 12, item_code: '690437', item_label: '아이더호보백', quantity: 1, unit_price: 29990, amount: 29990, is_discount: false, tax_type: 'taxable' },
    { line_no: 13, item_code: '692519', item_label: 'YALE남성 후디', quantity: 1, unit_price: 24990, amount: 24990, is_discount: false, tax_type: 'taxable' },
  ],
};
