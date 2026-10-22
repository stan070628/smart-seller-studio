import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { toStructuredOutputSchema } from '@/lib/ai/structured-schema';

describe('toStructuredOutputSchema', () => {
  it('zod 정수 제약(minimum/maximum)을 걷어낸다 — API가 400을 낸다', () => {
    const schema = toStructuredOutputSchema(z.object({ n: z.number().int() }));
    expect(JSON.stringify(schema)).not.toMatch(/minimum|maximum/);
  });

  it('구조는 유지한다', () => {
    const schema = toStructuredOutputSchema(z.object({ n: z.number().int(), s: z.string().nullable() })) as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties)).toEqual(['n', 's']);
  });
});
