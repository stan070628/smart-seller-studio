import { z } from 'zod';
import { ALL_QUESTION_IDS } from '@/lib/conversational-detail/questions';

export const RequestSchema = z.object({
  productName: z.string().min(1).max(200),
  category: z.enum(['basic', 'fashion', 'living', 'food'] as const),
  questionId: z.string().refine((id) => ALL_QUESTION_IDS.includes(id), {
    message: '정의되지 않은 questionId입니다.',
  }),
  questionText: z.string().min(1).max(200),
  previousAnswers: z
    .array(
      z.object({
        questionId: z.string().min(1).max(80),
        resolvedValue: z.string().max(500),
      }),
    )
    .max(20)
    .default([]),
});

export function buildUserPrompt(
  productName: string,
  category: string,
  questionId: string,
  questionText: string,
  previousAnswers: Array<{ questionId: string; resolvedValue: string }>,
): string {
  const prevLines = previousAnswers
    .filter((a) => a.resolvedValue.trim().length > 0)
    .map((a) => `- ${a.questionId}: ${a.resolvedValue}`)
    .join('\n');

  return [
    `상품명: ${productName}`,
    `카테고리: ${category}`,
    prevLines ? `\n[앞선 답변]\n${prevLines}` : '',
    `\n[결정할 질문]`,
    `ID: ${questionId}`,
    `질문: ${questionText}`,
    `\n위 정보를 종합해 이 질문에 대한 가장 적합한 답변을 JSON으로 결정하세요.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function extractValue(rawText: string): string {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude 응답에서 JSON을 찾을 수 없습니다.');
  const parsed = JSON.parse(match[0]) as { value?: unknown };
  if (typeof parsed.value !== 'string' || parsed.value.trim().length === 0) {
    throw new Error('value 필드가 비어있거나 형식이 잘못되었습니다.');
  }
  return parsed.value.trim().slice(0, 200);
}
