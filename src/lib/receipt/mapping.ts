import type { AttributedLine } from '@/lib/receipt/discount';
import { extractPackSize } from '@/lib/receipt/pack-size';

/**
 * 매핑 자동채움.
 *
 * `costco_item_map`이 기억한 결정을 각 줄에 미리 입힌다. 재구매가 반복되는
 * 코스트코 특성상 서너 번 장을 보고 나면 대부분의 품목이 자동으로 채워진다.
 *
 * DB 접근은 호출자가 한다. 이 함수는 데이터만 받아 순수하게 계산한다.
 */

/** `costco_item_map`에서 읽어온 행 중 이 함수가 쓰는 필드만 */
export interface ItemMapRow {
  item_code: string;
  product_cost_id: string | null;
  default_decision: 'ingest' | 'skip' | 'ask';
  default_entry_type: 'normal' | 'subdivision' | null;
  items_per_box: number | null;
  subdivision_unit: number | null;
}

/** `receipt_draft_lines`에 넣을 값 */
export interface DraftLineRow {
  line_no: number;
  item_code: string | null;
  item_label: string;
  quantity: number;
  unit_price: number | null;
  amount: number;
  is_discount: boolean;
  applies_to_line_no: number | null;
  tax_type: 'taxable' | 'exempt' | 'unknown';
  decision: 'pending' | 'ingest' | 'skip';
  product_cost_id: string | null;
  entry_type: 'normal' | 'subdivision' | null;
  items_per_box: number | null;
  subdivision_unit: number | null;
}

export function applyMappings(
  lines: AttributedLine[],
  maps: ItemMapRow[],
): DraftLineRow[] {
  const byCode = new Map(maps.map((m) => [m.item_code, m]));

  return lines.map((line) => {
    const base = {
      line_no: line.line_no,
      item_code: line.item_code,
      item_label: line.item_label,
      quantity: line.quantity,
      unit_price: line.unit_price,
      amount: line.amount,
      is_discount: line.is_discount,
      applies_to_line_no: line.applies_to_line_no,
      tax_type: line.tax_type,
    };

    // 할인 줄은 입고를 만들지 않는다. 값은 귀속된 품목의 단가에만 반영된다
    if (line.is_discount) {
      return {
        ...base,
        decision: 'skip' as const,
        product_cost_id: null,
        entry_type: null,
        items_per_box: null,
        subdivision_unit: null,
      };
    }

    const map = line.item_code ? byCode.get(line.item_code) : undefined;

    // 'ask'는 "매번 물어봐"라는 뜻이므로 pending으로 둔다.
    // 같은 품번을 어떤 날은 팔고 어떤 날은 집에서 쓰는 경우를 위한 3상태다.
    const decision =
      map?.default_decision === 'ingest' ? ('ingest' as const)
      : map?.default_decision === 'skip' ? ('skip' as const)
      : ('pending' as const);

    // 포장 수량은 매핑이 우선, 없으면 상품명에서 제안한다
    const itemsPerBox = map?.items_per_box ?? extractPackSize(line.item_label);

    return {
      ...base,
      decision,
      product_cost_id: map?.product_cost_id ?? null,
      entry_type: map?.default_entry_type ?? null,
      items_per_box: itemsPerBox,
      subdivision_unit: map?.subdivision_unit ?? null,
    };
  });
}
