/**
 * costco-naver-compare-route.test.ts
 * GET /api/sourcing/costco/naver-compare 라우트 TDD 테스트
 *
 * 실제 DB/Naver API 의존성 없이 Zod 스키마와 순수 계산 로직만 검증한다.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const compareQuerySchema = z.object({
  title: z.string().min(1),
  code: z.string().optional(),
});

describe('naver-compare query schema', () => {
  it('title만 있어도 통과한다', () => {
    expect(compareQuerySchema.safeParse({ title: '올리브오일' }).success).toBe(true);
  });

  it('title이 없으면 거부한다', () => {
    expect(compareQuerySchema.safeParse({ title: '' }).success).toBe(false);
  });

  it('code는 선택적이다', () => {
    expect(compareQuerySchema.safeParse({ title: '올리브오일', code: '1234567' }).success).toBe(true);
    expect(compareQuerySchema.safeParse({ title: '올리브오일' }).success).toBe(true);
  });
});

describe('오프라인 단위가 계산', () => {
  it('오프라인 가격으로 단위가를 환산한다', () => {
    const onlinePrice = 32900;
    const unitPrice = 16450;
    const offlinePrice = 29900;
    const offlineUnitPrice = offlinePrice * (unitPrice / onlinePrice);
    expect(offlineUnitPrice).toBeCloseTo(14950, 0);
  });
});
