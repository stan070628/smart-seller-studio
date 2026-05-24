/**
 * costco-lookup-route.test.ts
 * GET /api/sourcing/costco/lookup 라우트 TDD 테스트
 *
 * 실제 DB/API 의존성 없이 Zod 스키마만 검증한다.
 * DB·costco-client는 실제 라우트 핸들러를 import하면 함께 로드되므로
 * 스키마 정의만 분리해 테스트한다.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// route.ts의 querySchema와 동일한 스키마 재현
const lookupQuerySchema = z.object({
  code: z.string().regex(/^\d+$/, '숫자만 허용').min(5).max(10),
});

describe('lookup query schema', () => {
  it('유효한 7자리 코드를 통과시킨다', () => {
    const result = lookupQuerySchema.safeParse({ code: '1234567' });
    expect(result.success).toBe(true);
  });

  it('문자 포함 코드를 거부한다', () => {
    const result = lookupQuerySchema.safeParse({ code: 'ABC1234' });
    expect(result.success).toBe(false);
  });

  it('4자리 이하 코드를 거부한다', () => {
    const result = lookupQuerySchema.safeParse({ code: '1234' });
    expect(result.success).toBe(false);
  });
});
