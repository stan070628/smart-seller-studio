import type { AttributedLine } from '@/lib/receipt/discount';
import { netAmountOf } from '@/lib/receipt/discount';

/**
 * 영수증 줄 → 입고 API 페이로드.
 *
 * 기존 POST /api/cost-management/products/[id]/entries가 받는 형태로 맞춘다.
 * 소분 팩 수·팩당 단가·이월 계산은 그 API가 calculateSubdivision()으로 이미
 * 수행하므로 여기서 다시 만들지 않는다.
 */

interface EntryPayloadCommon {
  received_at: string;
  /** 일반 입고: 개당 단가. 소분 입고: 총 구매가 */
  unit_cost: number;
  unit_shipping_fee: number;
}

export interface NormalEntryPayload extends EntryPayloadCommon {
  quantity: number;
}

export interface SubdivisionEntryPayload extends EntryPayloadCommon {
  /** 사입 총량 = 구매 수량 × 포장당 개수 */
  purchase_quantity: number;
  subdivision_unit: number;
  unit_rg_shipping_fee: number;
}

export type EntryPayload = NormalEntryPayload | SubdivisionEntryPayload;

export interface BuildEntryPayloadInput {
  lines: AttributedLine[];
  lineNo: number;
  receivedAt: string;
  entryType: 'normal' | 'subdivision';
  /** 소분일 때 필수 */
  itemsPerBox?: number;
  /** 소분일 때 필수 */
  subdivisionUnit?: number;
}

export function buildEntryPayload(input: BuildEntryPayloadInput): EntryPayload {
  const { lines, lineNo, receivedAt, entryType, itemsPerBox, subdivisionUnit } = input;

  const line = lines.find((l) => l.line_no === lineNo);
  if (!line) throw new Error(`줄 ${lineNo}을 찾을 수 없습니다.`);
  if (line.is_discount) throw new Error(`줄 ${lineNo}은 할인 줄입니다. 입고를 만들 수 없습니다.`);

  // 할인 반영 후 실결제액. 사용자가 정한 원가 기준이다
  const netAmount = netAmountOf(lines, lineNo);

  if (entryType === 'normal') {
    return {
      received_at: receivedAt,
      quantity: line.quantity,
      unit_cost: Math.round(netAmount / line.quantity),
      unit_shipping_fee: 0,
    };
  }

  if (!itemsPerBox) throw new Error('소분 입고에는 itemsPerBox가 필요합니다.');
  if (!subdivisionUnit) throw new Error('소분 입고에는 subdivisionUnit이 필요합니다.');

  return {
    received_at: receivedAt,
    unit_cost: netAmount,
    purchase_quantity: Math.round(line.quantity * itemsPerBox),
    subdivision_unit: subdivisionUnit,
    unit_shipping_fee: 0,
    unit_rg_shipping_fee: 0,
  };
}
