import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ai/gemini', () => ({
  getGeminiGenAI: vi.fn().mockReturnValue({
    models: {
      generateContent: vi.fn(),
    },
  }),
}));

import { discoverTrendSeeds, parseSeedResponse, buildDiscoverPrompt } from '@/lib/sourcing/trend-discovery';
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

describe('buildDiscoverPrompt', () => {
  const p = buildDiscoverPrompt(new Date('2026-07-31T00:00:00+09:00'));

  it('규제 차단 카테고리를 금지어로 명시한다', () => {
    for (const kw of ['전기', '충전', '아동', '장난감', '식품', '건강기능식품', '화장품', '세제']) {
      expect(p).toContain(kw);
    }
  });

  it('실제 차단 실적이 있는 예시를 금지 예시로 든다', () => {
    for (const kw of ['선풍기', '랜턴', '장난감']) {
      expect(p).toContain(kw);
    }
  });

  it('단가 하한과 우대 구간을 명시한다', () => {
    expect(p).toContain('10,000원');
    expect(p).toContain('20,000원');
  });

  it('SKU 분기 상한을 명시한다', () => {
    expect(p).toMatch(/색상.*사이즈.*3개/);
  });

  it('오늘 기준 2~4개월 뒤 시즌을 지목한다', () => {
    // 2026-07-31 → 2026-09 ~ 2026-11
    expect(p).toContain('2026년 9월');
    expect(p).toContain('2026년 11월');
  });

  it('추천 카테고리에서 주방·건강식품·뷰티를 뺀다', () => {
    expect(p).not.toContain('주방');
    expect(p).not.toContain('뷰티');
    expect(p).toContain('골프');
    expect(p).toContain('낚시');
  });

  it('JSON 응답 형식을 유지한다', () => {
    expect(p).toContain('"seeds"');
    expect(p).toContain('keyword');
  });
});
