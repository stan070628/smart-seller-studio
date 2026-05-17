/**
 * /api/ai/edit-image-text
 *
 * Zod 스키마 단위 테스트 (이 레포의 라우트 테스트 패턴).
 */

import { describe, it, expect } from 'vitest';
import { RequestSchema } from '@/app/api/ai/edit-image-text/route';

describe('edit-image-text RequestSchema', () => {
  const validBody = {
    imageUrl: 'https://example.com/image.jpg',
    instruction: '표의 가격 셀을 29,900원으로 바꿔주세요',
    productName: '프리미엄 텀블러',
  };

  it('유효한 입력 통과', () => {
    expect(RequestSchema.safeParse(validBody).success).toBe(true);
  });

  it('productName 없이도 통과', () => {
    const { productName: _drop, ...rest } = validBody;
    expect(RequestSchema.safeParse(rest).success).toBe(true);
  });

  it('imageUrl이 빈 문자열이면 거부', () => {
    expect(RequestSchema.safeParse({ ...validBody, imageUrl: '' }).success).toBe(false);
  });

  it('instruction이 빈 문자열이면 거부', () => {
    expect(RequestSchema.safeParse({ ...validBody, instruction: '' }).success).toBe(false);
  });

  it('instruction이 500자 초과면 거부', () => {
    const long = 'a'.repeat(501);
    expect(RequestSchema.safeParse({ ...validBody, instruction: long }).success).toBe(false);
  });

  it('instruction이 500자 정확히면 통과', () => {
    const exact = 'a'.repeat(500);
    expect(RequestSchema.safeParse({ ...validBody, instruction: exact }).success).toBe(true);
  });

  it('productName이 200자 초과면 거부', () => {
    const long = 'a'.repeat(201);
    expect(RequestSchema.safeParse({ ...validBody, productName: long }).success).toBe(false);
  });
});
