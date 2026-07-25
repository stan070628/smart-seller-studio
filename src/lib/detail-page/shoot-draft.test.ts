import { describe, it, expect } from 'vitest';
import { deriveShootDraftSummary } from './shoot-draft';

describe('deriveShootDraftSummary', () => {
  it('행에서 리스트용 요약(step·shotCount)을 파생한다', () => {
    const row = {
      id: 'abc', product_name: '보넬라 차렵이불', updated_at: '2026-07-24T00:00:00Z',
      shoot_session: { step: 'guide', shotGuide: [{ subject: 'a' }, { subject: 'b' }] },
    };
    expect(deriveShootDraftSummary(row)).toEqual({
      id: 'abc', productName: '보넬라 차렵이불', updatedAt: '2026-07-24T00:00:00Z',
      step: 'guide', shotCount: 2,
    });
  });
  it('shoot_session이 비었거나 shotGuide가 없어도 안전하다', () => {
    const row = { id: 'x', product_name: null, updated_at: 't', shoot_session: {} };
    expect(deriveShootDraftSummary(row)).toEqual({ id: 'x', productName: null, updatedAt: 't', step: null, shotCount: 0 });
  });
});
