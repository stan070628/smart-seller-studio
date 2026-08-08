import { describe, it, expect } from 'vitest';
import { RECEIPT_SCHEMA, RECEIPT_PROMPT, receiptJsonSchema } from '@/lib/receipt/extract';
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

describe('receiptJsonSchema — API가 실제로 받는 것', () => {
  function collectKeys(node: unknown, acc = new Set<string>()): Set<string> {
    if (Array.isArray(node)) { node.forEach((n) => collectKeys(n, acc)); return acc; }
    if (node === null || typeof node !== 'object') return acc;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      acc.add(k);
      collectKeys(v, acc);
    }
    return acc;
  }

  it('수치 제약 키워드를 포함하지 않는다 — structured outputs가 거부한다', () => {
    const keys = collectKeys(receiptJsonSchema());
    for (const banned of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf']) {
      expect(keys.has(banned)).toBe(false);
    }
  });

  it('구조는 보존한다 — 필드가 사라지지 않았다', () => {
    const schema = receiptJsonSchema() as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toContain('lines');
    expect(Object.keys(schema.properties)).toContain('receipt_total');
    expect(Object.keys(schema.properties)).toContain('total_item_count');
  });

  it('integer 타입 자체는 남는다', () => {
    expect(JSON.stringify(receiptJsonSchema())).toContain('"integer"');
  });
});
