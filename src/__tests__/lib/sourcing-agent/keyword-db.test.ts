import { describe, it, expect, vi } from 'vitest';
import { saveKeywordResults, type KeywordResultInsert } from '@/lib/sourcing-agent/keyword-db';

const row: KeywordResultInsert = {
  rank: 1,
  naver_price: null,
  naver_url: null,
  domeggook_product_name: '캠핑 버너 받침대',
  domeggook_price: 7650,
  domeggook_url: 'http://domeggook.com/39371034',
  domeggook_image_url: null,
  domeggook_margin_rate: null,
  china_product_name: null,
  china_price_krw: null,
  china_url: null,
  china_margin_rate: null,
  unit_deli_fee: 300,
};

describe('saveKeywordResults', () => {
  it('개당 배송비를 함께 저장한다', async () => {
    // saveKeywordResults는 트랜잭션(pool.connect → client.query)을 쓰므로
    // pool.query가 아니라 connect()가 돌려주는 client를 목으로 만든다.
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const client = { query, release: vi.fn() };
    const pool = { connect: vi.fn().mockResolvedValue(client) };

    await saveKeywordResults(pool as never, 12, [row]);

    // BEGIN이 첫 호출이므로 INSERT는 두 번째 호출이다.
    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain('unit_deli_fee');
    expect(sql).toContain('keyword_sourcing_results');
    expect(params).toContain(300);
  });
});
