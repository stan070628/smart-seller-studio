import { describe, it, expect } from 'vitest';
import { shouldWarnReorder } from '../inbound-return-warning';

describe('shouldWarnReorder', () => {
  it('같은 셀러 회송 2건 이상 → warn', () => {
    expect(shouldWarnReorder({
      sellerName: 'X',
      pastReturns: [
        { sellerName: 'X', reason: 'packaging', occurredAt: new Date('2026-04-01') },
        { sellerName: 'X', reason: 'size', occurredAt: new Date('2026-04-15') },
      ],
    })).toMatchObject({ warn: true, count: 2 });
  });

  it('같은 셀러 1건 → no warn', () => {
    expect(shouldWarnReorder({
      sellerName: 'X',
      pastReturns: [{ sellerName: 'X', reason: 'packaging', occurredAt: new Date() }],
    }).warn).toBe(false);
  });

  it('다른 셀러는 무관', () => {
    expect(shouldWarnReorder({
      sellerName: 'X',
      pastReturns: [
        { sellerName: 'Y', reason: 'packaging', occurredAt: new Date() },
        { sellerName: 'Z', reason: 'size', occurredAt: new Date() },
      ],
    }).warn).toBe(false);
  });
});
