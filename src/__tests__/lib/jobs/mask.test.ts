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
  it('긴 입력도 빠르게 처리한다', () => {
    const t = Date.now();
    expect(maskPII('a'.repeat(1_000_000))).toHaveLength(500);
    expect(Date.now() - t).toBeLessThan(500);
  });
  it('긴 숫자 ID 안의 010은 건드리지 않는다', () => {
    expect(maskPII('shipmentBoxId=1010123456789')).toBe('shipmentBoxId=1010123456789');
    expect(maskPII('productOrderId 1234010123456789')).toBe('productOrderId 1234010123456789');
  });
  it('+82 형식과 공백 구분자도 가린다', () => {
    expect(maskPII('+82-10-1234-5678')).toBe('+82-10-****-5678');
    expect(maskPII('010 1234 5678')).toBe('010 **** 5678');
  });
  it('접두사가 붙은 비밀 파라미터도 가린다', () => {
    expect(maskPII('https://a.io/x?access_token=abc&api_key=zz')).toBe('https://a.io/x?access_token=***&api_key=***');
  });
  it('SCAN_LEN 경계에 걸린 번호 조각을 남기지 않는다', () => {
    expect(maskPII('Bearer ' + 'x'.repeat(1985) + ' 010-1234-5678')).not.toMatch(/010-\d/);
    expect(maskPII('?token=' + 't'.repeat(1985) + ' 010-1234-5678')).not.toMatch(/010-\d/);
  });
});
