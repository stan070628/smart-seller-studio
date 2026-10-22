import { z } from 'zod';

/**
 * zod 스키마 → Anthropic structured outputs용 JSON Schema.
 *
 * `z.number().int()`는 안전 정수 범위를 minimum/maximum으로 내보내는데,
 * structured outputs는 그 키워드를 지원하지 않아 400이 난다.
 * zod 스키마 자체는 로컬 검증에 그대로 쓰고 API로 나가는 쪽만 손질한다.
 * (영수증 판독 extract.ts에 있던 것을 소싱 후보 판독과 함께 쓰려고 옮겼다)
 */
const UNSUPPORTED_KEYWORDS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'] as const;

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if ((UNSUPPORTED_KEYWORDS as readonly string[]).includes(key)) continue;
    out[key] = strip(value);
  }
  return out;
}

export function toStructuredOutputSchema(schema: z.ZodType): Record<string, unknown> {
  return strip(z.toJSONSchema(schema)) as Record<string, unknown>;
}
