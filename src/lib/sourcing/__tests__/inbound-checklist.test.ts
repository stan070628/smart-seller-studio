import { describe, it, expect } from 'vitest';
import {
  CHECKLIST_SECTIONS,
  validateSkuInput,
  type SkuInput,
} from '../inbound-checklist';

describe('CHECKLIST_SECTIONS — 회송 당합니다 3편 기준', () => {
  it('3개 섹션 (포장/사이즈/바코드) 존재', () => {
    expect(CHECKLIST_SECTIONS).toHaveLength(3);
    expect(CHECKLIST_SECTIONS.map((s) => s.id)).toEqual(['packaging', 'size', 'barcode']);
  });

  it('각 섹션은 최소 4개 항목 보유', () => {
    CHECKLIST_SECTIONS.forEach((section) => {
      expect(section.items.length).toBeGreaterThanOrEqual(4);
    });
  });

  it('항목은 raw text가 아닌 구조 (id + label + caution?)', () => {
    const first = CHECKLIST_SECTIONS[0].items[0];
    expect(typeof first.id).toBe('string');
    expect(typeof first.label).toBe('string');
  });
});

describe('validateSkuInput — 사용자 입력 검증', () => {
  function makeInput(overrides: Partial<SkuInput> = {}): SkuInput {
    return {
      title: '스테인리스 텀블러 500ml',
      url1688: 'https://detail.1688.com/offer/123.html',
      unitPriceRmb: 12.5,
      orderQty: 100,
      maxSideCm: 20,
      weightKg: 0.4,
      ...overrides,
    };
  }

  it('정상 입력 → ok', () => {
    expect(validateSkuInput(makeInput()).ok).toBe(true);
  });

  it('빈 제목 → 에러', () => {
    const r = validateSkuInput(makeInput({ title: '' }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('title');
  });

  it('1688 URL 형식 아님 → 에러', () => {
    const r = validateSkuInput(makeInput({ url1688: 'https://google.com' }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('url1688');
  });

  it('변 길이 50cm 초과 → 경고 (oversize)', () => {
    const r = validateSkuInput(makeInput({ maxSideCm: 60 }));
    expect(r.warnings).toContain('oversize');
  });

  it('단가 0 이하 → 에러', () => {
    const r = validateSkuInput(makeInput({ unitPriceRmb: 0 }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('unitPriceRmb');
  });

  it('수량 정수 아님 → 에러', () => {
    const r = validateSkuInput(makeInput({ orderQty: 50.5 }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('orderQty');
  });
});
