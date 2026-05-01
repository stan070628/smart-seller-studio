import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ai/gemini', () => ({
  getGeminiGenAI: vi.fn(),
}));

import { extractKeywordsFromProduct } from '@/lib/sourcing/ai-keyword-extract';
import { getGeminiGenAI } from '@/lib/ai/gemini';

describe('extractKeywordsFromProduct', () => {
  beforeEach(() => vi.clearAllMocks());

  it('정상 응답 → 키워드 배열 반환', async () => {
    const mockGenerate = vi.fn().mockResolvedValue({
      text: '{"keywords":["펜트리수납함","슬라이드수납함","16cm수납함","주방펜트리","슬라이드정리함"]}',
    });
    (getGeminiGenAI as ReturnType<typeof vi.fn>).mockReturnValue({
      models: { generateContent: mockGenerate },
    });

    const result = await extractKeywordsFromProduct('16cm 펜트리수납함 슬라이드형');
    expect(result).toEqual(['펜트리수납함', '슬라이드수납함', '16cm수납함', '주방펜트리', '슬라이드정리함']);
    expect(mockGenerate).toHaveBeenCalledOnce();
  });

  it('JSON 파싱 실패 → null 반환', async () => {
    (getGeminiGenAI as ReturnType<typeof vi.fn>).mockReturnValue({
      models: { generateContent: vi.fn().mockResolvedValue({ text: '잘못된 응답' }) },
    });

    const result = await extractKeywordsFromProduct('아무 상품');
    expect(result).toBeNull();
  });

  it('API 호출 에러 → null 반환', async () => {
    (getGeminiGenAI as ReturnType<typeof vi.fn>).mockReturnValue({
      models: { generateContent: vi.fn().mockRejectedValue(new Error('rate limit')) },
    });

    const result = await extractKeywordsFromProduct('아무 상품');
    expect(result).toBeNull();
  });

  it('keywords 필드가 배열이 아니면 → null', async () => {
    (getGeminiGenAI as ReturnType<typeof vi.fn>).mockReturnValue({
      models: { generateContent: vi.fn().mockResolvedValue({ text: '{"keywords": "not-array"}' }) },
    });

    const result = await extractKeywordsFromProduct('아무 상품');
    expect(result).toBeNull();
  });

  it('빈 상품명 → null (API 호출 안 함)', async () => {
    const mockGenerate = vi.fn();
    (getGeminiGenAI as ReturnType<typeof vi.fn>).mockReturnValue({
      models: { generateContent: mockGenerate },
    });

    const result = await extractKeywordsFromProduct('   ');
    expect(result).toBeNull();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('JSON에 markdown 코드 펜스 → 제거 후 파싱', async () => {
    (getGeminiGenAI as ReturnType<typeof vi.fn>).mockReturnValue({
      models: { generateContent: vi.fn().mockResolvedValue({
        text: '```json\n{"keywords":["가","나"]}\n```',
      }) },
    });

    const result = await extractKeywordsFromProduct('아무 상품');
    expect(result).toEqual(['가', '나']);
  });
});
