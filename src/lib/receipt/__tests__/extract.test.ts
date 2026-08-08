import { describe, it, expect } from 'vitest';
import { RECEIPT_SCHEMA, RECEIPT_PROMPT } from '@/lib/receipt/extract';
import { RECEIPT_B } from '@/lib/receipt/__tests__/fixtures';

describe('RECEIPT_SCHEMA', () => {
  it('실제 추출 결과를 통과시킨다', () => {
    const parsed = RECEIPT_SCHEMA.safeParse(RECEIPT_B);
    expect(parsed.success).toBe(true);
  });

  it('nullable 필드에 null을 허용한다', () => {
    const blank = {
      ...RECEIPT_B,
      store_name: null, purchased_at: null, purchased_time: null,
      register_no: null, receipt_total: null, total_item_count: null,
      tax_exempt_total: null, taxable_total: null, vat: null,
    };
    expect(RECEIPT_SCHEMA.safeParse(blank).success).toBe(true);
  });

  it('line의 unit_price에 null을 허용한다 — 못 읽은 줄', () => {
    const partial = {
      ...RECEIPT_B,
      lines: RECEIPT_B.lines.map((l) => ({ ...l, unit_price: null })),
    };
    expect(RECEIPT_SCHEMA.safeParse(partial).success).toBe(true);
  });

  it('amount가 없으면 거부한다 — 검산의 근거라 필수다', () => {
    const broken = {
      ...RECEIPT_B,
      lines: [{ ...RECEIPT_B.lines[0], amount: undefined }],
    };
    expect(RECEIPT_SCHEMA.safeParse(broken).success).toBe(false);
  });

  it('tax_type에 정의되지 않은 값을 거부한다', () => {
    const broken = {
      ...RECEIPT_B,
      lines: [{ ...RECEIPT_B.lines[0], tax_type: 'zero_rated' }],
    };
    expect(RECEIPT_SCHEMA.safeParse(broken).success).toBe(false);
  });
});

describe('RECEIPT_PROMPT', () => {
  it('추측 금지 원칙을 담고 있다', () => {
    expect(RECEIPT_PROMPT).toContain('추측');
    expect(RECEIPT_PROMPT).toContain('null');
  });

  it('회원번호·카드번호 추출 금지를 담고 있다', () => {
    expect(RECEIPT_PROMPT).toContain('회원번호');
    expect(RECEIPT_PROMPT).toContain('카드번호');
  });

  it('두 줄 구조와 CPN 규칙을 담고 있다', () => {
    expect(RECEIPT_PROMPT).toContain('CPN');
    expect(RECEIPT_PROMPT).toContain('상품수 소계');
  });
});
