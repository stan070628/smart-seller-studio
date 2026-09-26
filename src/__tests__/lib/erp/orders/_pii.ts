// 어댑터 테스트 공용: 표준 라인에 구매자 정보가 없고, 정해진 칸 말고는 아무것도 없는지(칸이 늘면 개인정보가 새어 들어올 수 있다)
import { expect } from 'vitest';

// 우편번호 '00000'은 넣지 않는다 — 주문번호(예: 2026092700000001)에 같은 숫자열이 있어 오탐한다
export const FAKE_PII = ['테스트구매자', '테스트수령인', '010-0000-0000', '가상시 가상구', 'fake@example.com', '문 앞에 두세요', '101호'];

export const LINE_KEYS = [
  'altProductId', 'amount', 'channel', 'externalLineId', 'externalOrderId', 'optionKey', 'orderedAt', 'paidAt',
  'productId', 'productLabel', 'qty', 'rawStatus', 'status', 'unitPrice',
].sort();

export function expectNoPII(lines: object[]): void {
  const s = JSON.stringify(lines);
  for (const p of FAKE_PII) expect(s).not.toContain(p);
  for (const l of lines) expect(Object.keys(l).sort()).toEqual(LINE_KEYS);
}
