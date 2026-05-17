/**
 * /api/ai/detail-page-suggest-answers
 *
 * Zod 스키마 + 순수 헬퍼 함수 단위 테스트.
 * (라우트 핸들러 전체 mock은 비용이 커서 이 레포 패턴에 따라 헬퍼만 직접 검증)
 */

import { describe, it, expect } from 'vitest';
import {
  RequestSchema,
  buildUserPrompt,
  extractJson,
  parseSuggestions,
} from '@/app/api/ai/detail-page-suggest-answers/route';
import { ALL_QUESTION_IDS } from '@/lib/conversational-detail/questions';

describe('detail-page-suggest-answers RequestSchema', () => {
  const validBody = {
    productName: '프리미엄 텀블러',
    category: 'living' as const,
    imageUrls: ['https://example.com/img.jpg'],
    questionIds: ['target', 'tone'],
  };

  it('유효한 입력은 통과한다', () => {
    const result = RequestSchema.safeParse(validBody);
    expect(result.success).toBe(true);
  });

  it('productName이 빈 문자열이면 거부', () => {
    const result = RequestSchema.safeParse({ ...validBody, productName: '' });
    expect(result.success).toBe(false);
  });

  it('카테고리는 enum 안의 값만 허용', () => {
    const result = RequestSchema.safeParse({ ...validBody, category: 'beauty' });
    expect(result.success).toBe(false);
  });

  it('imageUrls는 1~5개', () => {
    const tooMany = RequestSchema.safeParse({
      ...validBody,
      imageUrls: Array(6).fill('https://example.com/img.jpg'),
    });
    expect(tooMany.success).toBe(false);
    const empty = RequestSchema.safeParse({ ...validBody, imageUrls: [] });
    expect(empty.success).toBe(false);
  });

  it('imageUrls 항목은 유효한 URL이어야 한다', () => {
    const result = RequestSchema.safeParse({ ...validBody, imageUrls: ['not-a-url'] });
    expect(result.success).toBe(false);
  });

  it('questionIds는 ALL_QUESTION_IDS 화이트리스트만 허용', () => {
    const result = RequestSchema.safeParse({ ...validBody, questionIds: ['unknown_question_id'] });
    expect(result.success).toBe(false);
  });

  it('정의된 모든 ID는 통과한다', () => {
    const result = RequestSchema.safeParse({
      ...validBody,
      questionIds: [...ALL_QUESTION_IDS].slice(0, 10),
    });
    expect(result.success).toBe(true);
  });
});

describe('buildUserPrompt', () => {
  it('상품명·카테고리·질문 ID가 모두 포함된다', () => {
    const prompt = buildUserPrompt('프리미엄 텀블러', 'living', ['target', 'tone', 'usp']);
    expect(prompt).toContain('프리미엄 텀블러');
    expect(prompt).toContain('living');
    expect(prompt).toContain('target');
    expect(prompt).toContain('tone');
    expect(prompt).toContain('usp');
  });

  it('JSON 반환 지시문이 포함된다', () => {
    const prompt = buildUserPrompt('상품', 'basic', ['target']);
    expect(prompt).toContain('JSON');
  });
});

describe('extractJson', () => {
  it('순수 JSON 문자열에서 객체를 추출한다', () => {
    const raw = '{"suggestions":[{"questionId":"target","chips":["A","B"],"recommendedIndex":0}]}';
    const result = extractJson(raw);
    expect(result).toEqual({
      suggestions: [{ questionId: 'target', chips: ['A', 'B'], recommendedIndex: 0 }],
    });
  });

  it('코드블록·설명 텍스트에 둘러싸인 JSON도 추출한다', () => {
    const raw = '여기 답변입니다:\n```json\n{"suggestions":[]}\n```\n끝.';
    const result = extractJson(raw);
    expect(result).toEqual({ suggestions: [] });
  });

  it('JSON 형태가 없으면 에러를 던진다', () => {
    expect(() => extractJson('답변을 모르겠습니다')).toThrow(/JSON/);
  });
});

describe('parseSuggestions', () => {
  const requestedIds = ['target', 'tone'];

  it('정상 응답을 ChipSuggestion[]로 파싱한다', () => {
    const parsed = {
      suggestions: [
        { questionId: 'target', chips: ['30대', '20대', '시니어'], recommendedIndex: 0 },
        { questionId: 'tone', chips: ['감성적', '전문적'], recommendedIndex: 1 },
      ],
    };
    const result = parseSuggestions(parsed, requestedIds);
    expect(result).toHaveLength(2);
    expect(result[0].questionId).toBe('target');
    expect(result[0].chips).toHaveLength(3);
  });

  it('요청하지 않은 questionId는 걸러낸다', () => {
    const parsed = {
      suggestions: [
        { questionId: 'target', chips: ['A', 'B'], recommendedIndex: 0 },
        { questionId: 'unknown', chips: ['X', 'Y'], recommendedIndex: 0 },
      ],
    };
    const result = parseSuggestions(parsed, requestedIds);
    expect(result).toHaveLength(1);
    expect(result[0].questionId).toBe('target');
  });

  it('chips는 최대 4개로 잘린다', () => {
    const parsed = {
      suggestions: [
        {
          questionId: 'target',
          chips: ['A', 'B', 'C', 'D', 'E', 'F'],
          recommendedIndex: 0,
        },
      ],
    };
    const result = parseSuggestions(parsed, requestedIds);
    expect(result[0].chips).toHaveLength(4);
  });

  it('recommendedIndex가 칩 범위를 벗어나면 범위 안으로 보정한다', () => {
    const parsed = {
      suggestions: [
        { questionId: 'target', chips: ['A', 'B'], recommendedIndex: 99 },
      ],
    };
    const result = parseSuggestions(parsed, requestedIds);
    expect(result[0].recommendedIndex).toBe(1); // 2개 칩이므로 마지막 인덱스 1로 보정
  });

  it('chips가 1개면 거부한다 (min 2)', () => {
    const parsed = {
      suggestions: [
        { questionId: 'target', chips: ['only one'], recommendedIndex: 0 },
      ],
    };
    expect(() => parseSuggestions(parsed, requestedIds)).toThrow();
  });

  it('잘못된 구조는 throw', () => {
    expect(() => parseSuggestions({ wrong: 'structure' }, requestedIds)).toThrow();
  });
});
