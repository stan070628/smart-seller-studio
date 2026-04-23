import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ai/gemini', () => ({
  getGeminiGenAI: vi.fn().mockReturnValue({
    models: {
      generateContent: vi.fn(),
    },
  }),
}));

import { discoverTrendSeeds, parseSeedResponse } from '@/lib/sourcing/trend-discovery';
import { getGeminiGenAI } from '@/lib/ai/gemini';

describe('parseSeedResponse', () => {
  it('유효한 JSON에서 씨드 배열을 파싱한다', () => {
    const raw = '{"seeds":[{"keyword":"캠핑의자","source":"youtube","reason":"트렌드"}]}';
    const result = parseSeedResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].keyword).toBe('캠핑의자');
    expect(result[0].source).toBe('youtube');
  });

  it('마크다운 코드블록을 제거하고 파싱한다', () => {
    const raw = '```json\n{"seeds":[{"keyword":"에어프라이어","source":"instagram","reason":"인기"}]}\n```';
    const result = parseSeedResponse(raw);
    expect(result).toHaveLength(1);
  });

  it('잘못된 JSON이면 빈 배열 반환', () => {
    expect(parseSeedResponse('not json')).toEqual([]);
  });

  it('seeds 필드 없으면 빈 배열 반환', () => {
    expect(parseSeedResponse('{"keywords":[]}')).toEqual([]);
  });
});

describe('discoverTrendSeeds', () => {
  beforeEach(() => vi.clearAllMocks());

  it('Gemini 응답에서 씨드를 파싱해 반환한다', async () => {
    const mockAI = getGeminiGenAI();
    (mockAI.models.generateContent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      text: '{"seeds":[{"keyword":"텀블러","source":"threads","reason":"환경"}]}',
    });

    const result = await discoverTrendSeeds();
    expect(result).toHaveLength(1);
    expect(result[0].keyword).toBe('텀블러');
  });

  it('Gemini 오류 시 빈 배열 반환', async () => {
    const mockAI = getGeminiGenAI();
    (mockAI.models.generateContent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('API error'));

    const result = await discoverTrendSeeds();
    expect(result).toEqual([]);
  });
});
