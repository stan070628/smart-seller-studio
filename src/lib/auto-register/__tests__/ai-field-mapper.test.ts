/**
 * ai-field-mapper.test.ts
 * mapProductToCoupangFields — AI 응답 파싱·displayCategoryCode 보정·오류 처리 검증
 *
 * 실제 구현이 @/lib/ai/claude-cli의 callClaude를 사용하므로 해당 모듈을 mock한다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 의존성 mock ────────────────────────────────────────────────────────────
// 실제 구현(ai-field-mapper.ts)은 @/lib/ai/claude-cli의 callClaude를 사용
vi.mock('@/lib/ai/claude-cli', () => ({
  callClaude: vi.fn(),
}));

import { callClaude } from '@/lib/ai/claude-cli';
import type { NormalizedProduct, MappedCoupangFields } from '../types';

const mockCallClaude = callClaude as ReturnType<typeof vi.fn>;

const { mapProductToCoupangFields } = await import('../ai-field-mapper');

// ── 픽스처 ────────────────────────────────────────────────────────────────

const sampleProduct: NormalizedProduct = {
  source: 'domeggook',
  itemId: '123456',
  title: '테스트 상품 명칭',
  price: 15000,
  imageUrls: ['https://example.com/img.jpg'],
  description: '상품 설명 텍스트',
  brand: '테스트브랜드',
  categoryHint: '생활용품',
};

const wellFormedFields: MappedCoupangFields = {
  sellerProductName: { value: '테스트 상품 명칭 - 도매꾹', confidence: 0.9 },
  displayCategoryCode: { value: 56137, confidence: 0.75 },
  brand: { value: '테스트브랜드', confidence: 0.95 },
  salePrice: { value: 20000, confidence: 0.9 },
  originalPrice: { value: 25000, confidence: 0.8 },
  stockQuantity: { value: 100, confidence: 1.0 },
  deliveryChargeType: { value: 'FREE', confidence: 0.85 },
  deliveryCharge: { value: 0, confidence: 1.0 },
  searchTags: { value: ['테스트', '생활용품'], confidence: 0.8 },
};

// ── 테스트 ────────────────────────────────────────────────────────────────

describe('mapProductToCoupangFields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 정상 JSON 파싱 ────────────────────────────────────────────────────────

  it('올바른 JSON 응답을 파싱해서 MappedCoupangFields를 반환한다', async () => {
    mockCallClaude.mockResolvedValue(JSON.stringify(wellFormedFields));

    const result = await mapProductToCoupangFields(sampleProduct);

    expect(result.sellerProductName.value).toBe('테스트 상품 명칭 - 도매꾹');
    expect(result.salePrice.value).toBe(20000);
    expect(result.searchTags.value).toEqual(['테스트', '생활용품']);
  });

  // ── 마크다운 코드 블록 제거 ───────────────────────────────────────────────

  it('마크다운 코드 블록(```json ... ```)으로 감싼 응답을 파싱한다', async () => {
    const markdown = '```json\n' + JSON.stringify(wellFormedFields) + '\n```';
    mockCallClaude.mockResolvedValue(markdown);

    const result = await mapProductToCoupangFields(sampleProduct);

    expect(result.sellerProductName.value).toBe('테스트 상품 명칭 - 도매꾹');
  });

  it('백틱 없는 마크다운(``` ... ```)으로 감싼 응답을 파싱한다', async () => {
    const markdown = '```\n' + JSON.stringify(wellFormedFields) + '\n```';
    mockCallClaude.mockResolvedValue(markdown);

    const result = await mapProductToCoupangFields(sampleProduct);

    expect(result.brand.value).toBe('테스트브랜드');
  });

  // ── displayCategoryCode 보정 ──────────────────────────────────────────────

  it('displayCategoryCode.value가 0이면 confidence를 0으로 보정한다', async () => {
    const fieldsWithZeroCategory: MappedCoupangFields = {
      ...wellFormedFields,
      displayCategoryCode: { value: 0, confidence: 0.6 },
    };
    mockCallClaude.mockResolvedValue(JSON.stringify(fieldsWithZeroCategory));

    const result = await mapProductToCoupangFields(sampleProduct);

    expect(result.displayCategoryCode.value).toBe(0);
    expect(result.displayCategoryCode.confidence).toBe(0);
  });

  it('displayCategoryCode.value가 0이 아니면 confidence를 그대로 유지한다', async () => {
    mockCallClaude.mockResolvedValue(JSON.stringify(wellFormedFields));

    const result = await mapProductToCoupangFields(sampleProduct);

    expect(result.displayCategoryCode.value).toBe(56137);
    expect(result.displayCategoryCode.confidence).toBe(0.75);
  });

  // ── 오류 처리 ─────────────────────────────────────────────────────────────

  it('AI 응답이 유효하지 않은 JSON이면 에러를 throw한다', async () => {
    mockCallClaude.mockResolvedValue('이것은 JSON이 아닙니다');

    await expect(mapProductToCoupangFields(sampleProduct)).rejects.toThrow();
  });

  it('callClaude 자체가 실패하면 에러를 throw한다', async () => {
    mockCallClaude.mockRejectedValue(new Error('API rate limit exceeded'));

    await expect(mapProductToCoupangFields(sampleProduct)).rejects.toThrow('API rate limit exceeded');
  });
});
