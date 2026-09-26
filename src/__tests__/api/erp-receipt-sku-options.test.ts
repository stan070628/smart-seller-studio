import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetCurrentUser, mockGetPool } = vi.hoisted(() => ({ mockGetCurrentUser: vi.fn(), mockGetPool: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mockGetCurrentUser }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: mockGetPool }));

const line = (o: Record<string, unknown>) => ({
  line_no: 1, item_code: '111', product_cost_id: 'pc-1', decision: 'ingest', entry_type: 'normal', quantity: '2',
  items_per_box: null, subdivision_unit: null, is_discount: false, cost_entry_id: null, ...o,
});
const ctx = { params: Promise.resolve({ id: 'd-1' }) };
const req = () => new NextRequest('http://localhost/api/erp/receipts/d-1/sku-options');

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUser.mockResolvedValue({ userId: 'u-1', email: 't@example.com' });
  mockGetPool.mockReturnValue({
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM receipt_drafts')) return { rows: [{ id: 'd-1' }] };
      if (sql.includes('FROM receipt_draft_lines')) {
        return { rows: [
          line({}),
          line({ line_no: 2, is_discount: true }),
          line({ line_no: 3, item_code: '333', product_cost_id: 'pc-3', entry_type: 'subdivision', quantity: '1', items_per_box: 12, subdivision_unit: 6 }),
          line({ line_no: 4, cost_entry_id: 'ce-1' }),
        ] };
      }
      if (sql.startsWith('select p.supplier_code')) return { rows: [{ supplier_code: '111', id: '11', key: 'k11', name: 'A', option_label: '블랙' }] };
      if (sql.startsWith('select s.id, s.key')) {
        return { rows: [
          { id: '31', key: 'k31', name: 'C', option_label: 'S', legacy: ['pc-3'] },
          { id: '32', key: 'k32', name: 'C', option_label: 'L', legacy: ['pc-3'] },
        ] };
      }
      throw new Error(`예상 못 한 SQL: ${sql.slice(0, 50)}`);
    }),
  });
});

describe('GET /api/erp/receipts/[id]/sku-options', () => {
  it('로그인하지 않으면 401', async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const { GET } = await import('@/app/api/erp/receipts/[id]/sku-options/route');
    expect((await GET(req(), ctx)).status).toBe(401);
  });

  it('확정 대기 입고 줄만, 후보와 예상 수량을 준다', async () => {
    const { GET } = await import('@/app/api/erp/receipts/[id]/sku-options/route');
    const json = await (await GET(req(), ctx)).json();
    expect(Object.keys(json.data)).toEqual(['1', '3']);
    expect(json.data['1']).toEqual({ source: 'learned', candidates: [{ skuId: 11, key: 'k11', name: 'A', option: '블랙' }], expectedQty: { qty: 2, approx: false } });
    expect(json.data['3'].source).toBe('product');
    expect(json.data['3'].candidates).toHaveLength(2);
    expect(json.data['3'].expectedQty).toEqual({ qty: 2, approx: true });
  });
});
