// src/__tests__/lib/jobs/mask.test.ts
import { describe, it, expect } from 'vitest';
import { maskPII } from '@/lib/jobs/mask';

describe('maskPII', () => {
  it('휴대전화 번호 가운데를 가린다', () => {
    expect(maskPII('수취인 010-1234-5678 연락')).toBe('수취인 010-****-5678 연락');
    expect(maskPII('01012345678')).toBe('010****5678');
  });
  it('이메일 로컬파트를 가린다', () => {
    expect(maskPII('buyer.kim@example.com 오류')).toBe('b***@example.com 오류');
  });
  it('Bearer 토큰과 쿼리 비밀값을 가린다', () => {
    expect(maskPII('Authorization: Bearer abc.def-123')).toBe('Authorization: Bearer ***');
    expect(maskPII('https://x.io/a?secret=zz9&b=1')).toBe('https://x.io/a?secret=***&b=1');
  });
  it('500자로 자른다', () => {
    expect(maskPII('a'.repeat(600))).toHaveLength(500);
  });
  it('가릴 것이 없으면 그대로 둔다', () => {
    expect(maskPII('쿠팡 429 Too Many Requests')).toBe('쿠팡 429 Too Many Requests');
  });
});
