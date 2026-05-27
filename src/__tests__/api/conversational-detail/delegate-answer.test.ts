/**
 * /api/ai/detail-page-delegate-answer
 *
 * Zod 스키마 + 순수 헬퍼 함수 단위 테스트.
 */

import { describe, it, expect } from 'vitest';
import {
  RequestSchema,
  buildUserPrompt,
  extractValue,
} from '@/app/api/ai/detail-page-delegate-answer/utils';

describe('detail-page-delegate-answer RequestSchema', () => {
  const validBody = {
    productName: '프리미엄 텀블러',
    category: 'living' as const,
    questionId: 'tone',
    questionText: '톤·분위기는 어떻게 가져갈까요?',
    previousAnswers: [{ questionId: 'target', resolvedValue: '30대 워킹맘' }],
  };

  it('유효한 입력은 통과한다', () => {
    const result = RequestSchema.safeParse(validBody);
    expect(result.success).toBe(true);
  });

  it('previousAnswers 없이도 통과한다 (default [])', () => {
    const { previousAnswers: _drop, ...rest } = validBody;
    const result = RequestSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.previousAnswers).toEqual([]);
    }
  });

  it('정의되지 않은 questionId는 거부', () => {
    const result = RequestSchema.safeParse({ ...validBody, questionId: 'not_a_real_question' });
    expect(result.success).toBe(false);
  });

  it('previousAnswers는 최대 20개', () => {
    const result = RequestSchema.safeParse({
      ...validBody,
      previousAnswers: Array(21).fill({ questionId: 'target', resolvedValue: 'x' }),
    });
    expect(result.success).toBe(false);
  });

  it('카테고리는 enum만 허용', () => {
    const result = RequestSchema.safeParse({ ...validBody, category: 'unknown' });
    expect(result.success).toBe(false);
  });
});

describe('buildUserPrompt', () => {
  it('상품명·카테고리·질문 ID·질문 텍스트가 모두 포함된다', () => {
    const prompt = buildUserPrompt('프리미엄 텀블러', 'living', 'tone', '톤은?', []);
    expect(prompt).toContain('프리미엄 텀블러');
    expect(prompt).toContain('living');
    expect(prompt).toContain('tone');
    expect(prompt).toContain('톤은?');
  });

  it('previousAnswers가 있으면 [앞선 답변] 블록 추가', () => {
    const prompt = buildUserPrompt('상품', 'basic', 'tone', '톤?', [
      { questionId: 'target', resolvedValue: '30대 워킹맘' },
      { questionId: 'usp', resolvedValue: '편안한 핏' },
    ]);
    expect(prompt).toContain('[앞선 답변]');
    expect(prompt).toContain('30대 워킹맘');
    expect(prompt).toContain('편안한 핏');
  });

  it('previousAnswers가 비어있으면 [앞선 답변] 블록이 없다', () => {
    const prompt = buildUserPrompt('상품', 'basic', 'tone', '톤?', []);
    expect(prompt).not.toContain('[앞선 답변]');
  });

  it('공백만 있는 resolvedValue는 [앞선 답변]에서 제외', () => {
    const prompt = buildUserPrompt('상품', 'basic', 'tone', '톤?', [
      { questionId: 'target', resolvedValue: '   ' },
      { questionId: 'usp', resolvedValue: '실제 답변' },
    ]);
    expect(prompt).toContain('실제 답변');
    expect(prompt).not.toMatch(/- target:\s/);
  });
});

describe('extractValue', () => {
  it('정상 JSON에서 value 문자열을 추출', () => {
    expect(extractValue('{"value":"감성적인 톤"}')).toBe('감성적인 톤');
  });

  it('코드블록·설명에 둘러싸인 JSON도 처리', () => {
    expect(extractValue('답: ```json\n{"value":"전문적"}\n```')).toBe('전문적');
  });

  it('value 앞뒤 공백은 trim 된다', () => {
    expect(extractValue('{"value":"  답변  "}')).toBe('답변');
  });

  it('value가 빈 문자열이면 throw', () => {
    expect(() => extractValue('{"value":""}')).toThrow(/value/);
  });

  it('value가 공백뿐이면 throw', () => {
    expect(() => extractValue('{"value":"   "}')).toThrow(/value/);
  });

  it('value 필드가 없으면 throw', () => {
    expect(() => extractValue('{"foo":"bar"}')).toThrow(/value/);
  });

  it('value가 문자열이 아니면 throw', () => {
    expect(() => extractValue('{"value":123}')).toThrow(/value/);
  });

  it('JSON 형태 자체가 없으면 throw', () => {
    expect(() => extractValue('그냥 텍스트')).toThrow(/JSON/);
  });

  it('200자 초과 시 잘린다', () => {
    const long = 'a'.repeat(300);
    const result = extractValue(`{"value":"${long}"}`);
    expect(result.length).toBe(200);
  });
});
