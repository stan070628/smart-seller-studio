import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: vi.fn() }));

import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';

const mockGetCurrentUser = getCurrentUser as ReturnType<typeof vi.fn>;
const mockGetPool = getSourcingPool as ReturnType<typeof vi.fn>;

// GET /api/cost-management/products 는 여러 쿼리를 순차 실행하므로
// SQL 문자열 내용으로 분기해 각 쿼리에 맞는 rows 를 돌려주는 라우터형 mock.
function routeQuery(sql: string) {
  if (/FROM product_costs\s+WHERE user_id/i.test(sql) && /ORDER BY created_at DESC/i.test(sql)) {
    return {
      rows: [{
        id: 'prod-rg', product_name: '[6개입] 랩노쉬 프로틴 초코',
        seller_product_id: 16269612792, vendor_item_id: null, naver_channel_product_no: null,
        variants: null, naver_variants: null, naver_origin_product_no: null,
        platform: 'coupang', platform_fee_rate: 0.108,
        subdivision_unit: null, subdivision_carryover: 0, subdivision_carryover_unit_cost: 0,
        created_at: new Date('2026-06-26'), hidden: false, download_coupon_policy: null,
      }],
    };
  }
  if (/hidden_count/i.test(sql)) return { rows: [{ hidden_count: 0 }] };
  // product_cost_channels: coupang_rg 매핑 존재
  if (/FROM product_cost_channels/i.test(sql)) {
    return { rows: [{ product_cost_id: 'prod-rg', id: 'ch-1', channel_type: 'coupang_rg', external_id: 95645986107, unit_multiplier: 1 }] };
  }
  // 입고: wing 채널로 16개 (2건)
  if (/FROM cost_entries WHERE user_id/i.test(sql)) {
    return {
      rows: [
        { id: 'e1', product_cost_id: 'prod-rg', received_at: new Date('2026-06-26'), quantity: 8, unit_cost: 1000, unit_shipping_fee: 100, unit_rg_shipping_fee: 0, shipping_group_id: null, channel: 'wing' },
        { id: 'e2', product_cost_id: 'prod-rg', received_at: new Date('2026-06-27'), quantity: 8, unit_cost: 1000, unit_shipping_fee: 100, unit_rg_shipping_fee: 0, shipping_group_id: null, channel: 'wing' },
      ],
    };
  }
  // 판매: rocket_growth 17개
  if (/FROM sale_records WHERE user_id/i.test(sql)) {
    return {
      rows: [
        { id: 's1', product_cost_id: 'prod-rg', sold_at: new Date('2026-07-01'), quantity: 17, selling_price: 3000, sale_amount: 51000, coupon_discount: 0, channel: 'rocket_growth', shipping_fee: 0 },
      ],
    };
  }
  // 광고비
  if (/product_ad_spend_daily/i.test(sql)) return { rows: [] };
  return { rows: [] };
}

describe('GET /api/cost-management/products — total_entry_stock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ userId: 'user-uuid', email: 'test@example.com' });
    mockGetPool.mockReturnValue({ query: vi.fn((sql: string) => Promise.resolve(routeQuery(sql))) });
  });

  it('순재고가 0이어도 원입고 수량(채널무관 SUM) 을 total_entry_stock 으로 노출한다', async () => {
    // 회귀: 입고 16(wing) - 판매 17(rg) → current_stock 0 이지만
    // RG 입고 등록 모달이 걸러내면 안 됨. 서버 검증 기준 SUM(quantity)=16 과 일치해야 한다.
    const { GET } = await import('@/app/api/cost-management/products/route');
    const res = await GET(new NextRequest('http://localhost/api/cost-management/products'));
    const json = await res.json();
    expect(json.success).toBe(true);
    const p = json.data.find((x: { id: string }) => x.id === 'prod-rg');
    expect(p).toBeTruthy();
    expect(p.current_stock).toBe(0);        // 채널별 FIFO 순재고는 0
    expect(p.total_entry_stock).toBe(16);   // 원입고 합계는 16 → 모달에 노출되어야 함
  });
});
