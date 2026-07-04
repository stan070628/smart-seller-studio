import { describe, it, expect } from 'vitest';
import { DraftUpsertSchema } from '@/app/api/detail-page/draft/route';

describe('DraftUpsertSchema', () => {
  it('id 없이(신규) sections/theme만으로 통과한다', () => {
    expect(DraftUpsertSchema.safeParse({ productName: '방석', sections: [], theme: {} }).success).toBe(true);
  });
  it('id가 있으면 uuid여야 한다', () => {
    expect(DraftUpsertSchema.safeParse({ id: 'not-a-uuid', sections: [], theme: {} }).success).toBe(false);
  });
  it('sections가 배열이 아니면 거부한다', () => {
    expect(DraftUpsertSchema.safeParse({ sections: 'x', theme: {} }).success).toBe(false);
  });
});
