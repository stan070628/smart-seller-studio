import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class {
      messages = {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                suggestedTitle: '스테인리스 텀블러 500ml 보온 보냉',
                reasoning: '메인 키워드 "텀블러"를 앞 6자에 배치, 보냉/보온 부가 키워드 추가',
              }),
            },
          ],
        }),
      };
    },
  };
});

import { suggestKeywordOptimization } from '../keyword-suggester';

describe('suggestKeywordOptimization', () => {
  it('현재 상품명 + 검색 키워드 → 재구성 제안', async () => {
    const result = await suggestKeywordOptimization({
      currentTitle: '500ml 텀블러 스테인리스 좋음',
      mainKeywords: ['텀블러', '보온병'],
      categoryName: '주방용품',
    });
    expect(result.suggestedTitle).toContain('텀블러');
    expect(result.reasoning).toBeTruthy();
  });

  it('빈 currentTitle → 에러', async () => {
    await expect(
      suggestKeywordOptimization({ currentTitle: '', mainKeywords: [], categoryName: null }),
    ).rejects.toThrow();
  });
});
