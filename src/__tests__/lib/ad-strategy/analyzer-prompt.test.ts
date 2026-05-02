import { parseAdStrategyResponse } from '@/lib/ad-strategy/analyzer-prompt';

const VALID_JSON = JSON.stringify({
  collectedAt: '2026-05-02T00:00:00.000Z',
  urgentActions: [],
  productAdRanking: [],
  sourcingAlerts: [],
  campaignSummary: { totalBudget: 0, totalRoas: 0, activeCampaigns: 0, blockedProducts: 0 },
  summary: '테스트',
});

describe('parseAdStrategyResponse', () => {
  it('순수 JSON을 파싱한다', () => {
    const result = parseAdStrategyResponse(VALID_JSON);
    expect(result.summary).toBe('테스트');
  });

  it('앞뒤에 텍스트가 있어도 JSON을 추출한다', () => {
    const result = parseAdStrategyResponse('Here is the result: ' + VALID_JSON + ' done.');
    expect(result.summary).toBe('테스트');
  });

  it('urgentActions 배열을 올바르게 파싱한다', () => {
    const withActions = JSON.stringify({
      collectedAt: '2026-05-02T00:00:00.000Z',
      urgentActions: [
        { type: 'IMAGE_FIX', product: '파우치', reason: '이미지 없음', action: '업로드' },
      ],
      productAdRanking: [],
      sourcingAlerts: [],
      campaignSummary: { totalBudget: 0, totalRoas: 0, activeCampaigns: 0, blockedProducts: 1 },
      summary: '이미지 수정 필요',
    });
    const result = parseAdStrategyResponse(withActions);
    expect(result.urgentActions).toHaveLength(1);
    expect(result.urgentActions[0].type).toBe('IMAGE_FIX');
  });

  it('JSON이 없으면 에러를 던진다', () => {
    expect(() => parseAdStrategyResponse('no json here')).toThrow(
      'AI 응답에서 JSON을 파싱할 수 없습니다.',
    );
  });
});
