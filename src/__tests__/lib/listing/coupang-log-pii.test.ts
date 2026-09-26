import { describe, it, expect } from 'vitest';
import { coupangErrorSummary } from '@/lib/listing/coupang-client';

describe('coupangErrorSummary — 로그에 남는 것은 오류 설명뿐', () => {
  it('JSON 오류는 code·message만', () => {
    expect(coupangErrorSummary(JSON.stringify({ code: 'ERROR', message: '권한 없음', data: { orderer: { name: '홍길동' } } })))
      .toBe('code=ERROR message=권한 없음');
  });
  it('JSON이 아니면 앞 120자', () => {
    expect(coupangErrorSummary('x'.repeat(300))).toHaveLength(120);
  });
});
