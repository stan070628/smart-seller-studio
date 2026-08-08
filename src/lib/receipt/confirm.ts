/**
 * 확정 대상 선별.
 *
 * 어떤 줄을 입고로 만들 수 있는지 판단하고, 못 만드는 줄은 사유를 함께 낸다.
 * 화면이 "왜 이 줄은 안 들어갔지"에 답할 수 있어야 하기 때문이다.
 */

export type SkipReason =
  | 'already_confirmed'
  | 'not_ingest'
  | 'discount_line'
  | 'no_product'
  | 'no_entry_type'
  | 'missing_subdivision_params';

/** `receipt_draft_lines`에서 읽어온 행 중 이 함수가 쓰는 필드만 */
export interface ConfirmCandidate {
  line_no: number;
  is_discount: boolean;
  decision: 'pending' | 'ingest' | 'skip';
  product_cost_id: string | null;
  entry_type: 'normal' | 'subdivision' | null;
  items_per_box: number | null;
  subdivision_unit: number | null;
  cost_entry_id: string | null;
}

export interface SelectResult {
  confirmable: ConfirmCandidate[];
  skipped: { line_no: number; reason: SkipReason }[];
}

/**
 * @param lines 초안의 모든 줄
 * @param onlyLineNos 지정하면 그 줄만 대상으로 한다. 생략하면 전부
 */
export function selectConfirmable(
  lines: ConfirmCandidate[],
  onlyLineNos?: number[],
): SelectResult {
  const target = onlyLineNos
    ? lines.filter((l) => onlyLineNos.includes(l.line_no))
    : lines;

  // line_no 오름차순. 소분 이월이 순서에 의존하므로 정렬을 여기서 보장한다
  const sorted = [...target].sort((a, b) => a.line_no - b.line_no);

  const confirmable: ConfirmCandidate[] = [];
  const skipped: { line_no: number; reason: SkipReason }[] = [];

  for (const l of sorted) {
    // 이미 확정된 줄은 다시 만들지 않는다. 멱등성의 근거다
    if (l.cost_entry_id != null) {
      skipped.push({ line_no: l.line_no, reason: 'already_confirmed' });
      continue;
    }
    if (l.is_discount) {
      skipped.push({ line_no: l.line_no, reason: 'discount_line' });
      continue;
    }
    if (l.decision !== 'ingest') {
      skipped.push({ line_no: l.line_no, reason: 'not_ingest' });
      continue;
    }
    if (!l.product_cost_id) {
      skipped.push({ line_no: l.line_no, reason: 'no_product' });
      continue;
    }
    if (!l.entry_type) {
      skipped.push({ line_no: l.line_no, reason: 'no_entry_type' });
      continue;
    }
    if (l.entry_type === 'subdivision' && (!l.items_per_box || !l.subdivision_unit)) {
      skipped.push({ line_no: l.line_no, reason: 'missing_subdivision_params' });
      continue;
    }
    confirmable.push(l);
  }

  return { confirmable, skipped };
}

/** `costco_item_map`에 upsert할 값 */
export interface MappingUpsert {
  item_code: string;
  item_label: string;
  product_cost_id: string;
  default_decision: 'ingest';
  default_entry_type: 'normal' | 'subdivision';
  items_per_box: number | null;
  subdivision_unit: number | null;
}

/**
 * 확정한 줄에서 기억시킬 값을 뽑는다.
 *
 * 확정했다는 것은 사람이 "이 품번은 이 상품으로 입고한다"를 승인했다는 뜻이므로
 * `default_decision`은 언제나 `ingest`다. 개인용(`skip`)이나 매번 묻기(`ask`)는
 * 확정 경로가 아니라 줄 수정 경로에서 기억시킨다.
 *
 * 품번이 없는 줄(봉투값 등)은 기억할 키가 없으므로 null을 낸다.
 */
export function mappingUpsertFrom(
  line: ConfirmCandidate & { item_code: string | null; item_label: string },
): MappingUpsert | null {
  if (!line.item_code || !line.product_cost_id || !line.entry_type) return null;

  return {
    item_code: line.item_code,
    item_label: line.item_label,
    product_cost_id: line.product_cost_id,
    default_decision: 'ingest',
    default_entry_type: line.entry_type,
    items_per_box: line.items_per_box,
    subdivision_unit: line.subdivision_unit,
  };
}
