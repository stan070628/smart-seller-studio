import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// 테스트용 스키마 (route.ts와 동일)
const RequestSchema = z.object({
  title: z.string().min(1).max(300),
  categoryHint: z.string().max(100).optional(),
  description: z.string().max(3000).optional(),
  options: z.array(z.object({
    typeName: z.string(),
    values: z.array(z.object({ label: z.string() })),
  })).optional(),
  context: z.enum(['thumbnail', 'detail', 'detail-html']).default('thumbnail'),
});

describe('suggest-thumbnail-prompts schema', () => {
  it("context:'detail-html'를 허용한다", () => {
    const result = RequestSchema.safeParse({ title: '상품명', context: 'detail-html' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.context).toBe('detail-html');
  });

  it("알 수 없는 context는 거부한다", () => {
    const result = RequestSchema.safeParse({ title: '상품명', context: 'unknown' });
    expect(result.success).toBe(false);
  });

  it("context 미입력 시 'thumbnail'이 기본값", () => {
    const result = RequestSchema.safeParse({ title: '상품명' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.context).toBe('thumbnail');
  });
});

describe('buildDetailHtmlSystemPrompt', () => {
  it('HTML 편집 지시문 관련 키워드를 포함한다', async () => {
    const { buildDetailHtmlSystemPrompt } = await import(
      '@/app/api/ai/suggest-thumbnail-prompts/route'
    );
    const prompt = buildDetailHtmlSystemPrompt();
    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('HTML');
    expect(prompt.length).toBeGreaterThan(50);
  });
});
