// 옛 판매 불러오기 4개는 410 — 새 주문 수집(sale_records까지 기록)과 이중 기록되지 않게(ERP 1-C2a)
import { describe, it, expect } from 'vitest';

describe('옛 판매 불러오기 라우트', () => {
  it.each([
    ['rg-bulk-import', () => import('@/app/api/cost-management/rg-bulk-import/route')],
    ['wing-bulk-import', () => import('@/app/api/cost-management/wing-bulk-import/route')],
    ['naver-bulk-import', () => import('@/app/api/cost-management/naver-bulk-import/route')],
    ['coupang-import', () => import('@/app/api/cost-management/products/[id]/coupang-import/route')],
  ])('%s — 410 gone', async (_name, load) => {
    const { POST } = await load();
    const res = await POST();
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ success: false, code: 'gone' });
  });
});
