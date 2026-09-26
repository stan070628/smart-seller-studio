import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import MobileStock from '@/components/erp/stock/MobileStock';
import { server } from '../mocks/server';

const ROW = {
  skuId: 1, key: 'cp:1:블랙', name: '왜건', option: '블랙', legacyProductCostIds: [], self: 5, rgInbound: 1, rg: 2, value: 5600,
  hasLedger: true, lotCost: 700, legacyCost: null, costNeedsInput: false, selfValue: 3500, lastCountedAt: null,
};
const OTHER = { ...ROW, skuId: 2, key: 'cp:2:레드', name: '매트', option: '레드', self: 3, rgInbound: 0, rg: 0, value: 2100, selfValue: 2100 };

// 콜백 안에서만 채워진다 — 선언 타입을 넓혀 둬야 TS가 null로 좁히지 않는다
type Body = { items: Record<string, unknown>[] };
function serve(onAdjust?: (b: Body) => void) {
  server.use(
    http.get('/api/erp/stock', () => HttpResponse.json({ success: true, data: [ROW, OTHER] })),
    http.get('/api/erp/stock/recent', () => HttpResponse.json({ success: true, data: [] })),
    http.get('/api/erp/stock/count-queue', () => HttpResponse.json({ success: true, data: { today: '2026-09-27', n: 8, items: [ROW] } })),
    http.post('/api/erp/stock/adjust', async ({ request }) => {
      const b = (await request.json()) as Body;
      onAdjust?.(b);
      const item = b.items[0];
      const same = item.value === item.expected;
      return HttpResponse.json({ success: true, data: [{ outcome: same ? 'noop' : 'posted', kind: same ? null : 'adjust', qty: Number(item.value) - Number(item.expected) }] });
    }),
  );
}

describe('MobileStock', () => {
  it('오늘 셀 목록 카드로 시작한다 — 검색 전에는 목록 밖 SKU를 보이지 않는다', async () => {
    serve();
    render(<MobileStock />);
    expect(await screen.findByText('왜건')).toBeInTheDocument();
    expect(screen.getByText(/남은 1 \/ 1개/)).toBeInTheDocument();
    expect(screen.getByText(/안 셈/)).toBeInTheDocument();
    expect(screen.queryByText('매트')).not.toBeInTheDocument();
  });

  it('카드를 골라 지금 개수를 줄여 저장하면 count 조정을 보내고, 그 카드가 목록에서 빠진다', async () => {
    let body = null as Body | null;
    serve((b) => { body = b; });
    render(<MobileStock />);
    fireEvent.click(await screen.findByText('왜건'));
    fireEvent.click(screen.getByLabelText('하나 빼기'));
    fireEvent.click(screen.getByLabelText('하나 빼기'));
    expect(screen.getByText('5 → 3 (-2)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.items[0]).toMatchObject({ skuId: 1, location: 'self', mode: 'count', value: 3, expected: 5, reason: 'count_diff' });
    expect(String(body!.items[0].requestId)).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText(/저장했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/오늘 1개를 다 셌습니다/)).toBeInTheDocument();
    expect(screen.queryByText('왜건')).not.toBeInTheDocument();
  });

  it('개수가 같아도 저장된다 — 센 기록만 남는다', async () => {
    let body = null as Body | null;
    serve((b) => { body = b; });
    render(<MobileStock />);
    fireEvent.click(await screen.findByText('왜건'));
    expect(screen.getByText('차이 없음 — 센 기록만 남깁니다')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '맞습니다 — 센 기록 저장' }));
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.items[0]).toMatchObject({ skuId: 1, location: 'self', mode: 'count', value: 5, expected: 5 });
    expect(await screen.findByText(/센 기록을 저장했습니다/)).toBeInTheDocument();
  });

  it('목록에 없는 SKU는 검색으로 찾는다', async () => {
    serve();
    render(<MobileStock />);
    await screen.findByText('왜건');
    fireEvent.change(screen.getByLabelText('상품 검색'), { target: { value: '매트' } });
    fireEvent.click(await screen.findByText('매트'));
    expect(screen.getByLabelText('지금 개수')).toHaveValue(3);
  });

  it('RG입고중 탭은 그 위치 재고에서 시작하고, 거기서 센 것은 오늘 셀 목록(집)에서 빼지 않는다', async () => {
    serve();
    render(<MobileStock />);
    fireEvent.click(await screen.findByText('왜건'));
    fireEvent.click(screen.getByRole('button', { name: 'RG입고중' }));
    expect(screen.getByLabelText('지금 개수')).toHaveValue(1);
    fireEvent.click(screen.getByRole('button', { name: '맞습니다 — 센 기록 저장' }));
    expect(await screen.findByText(/센 기록을 저장했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/남은 1 \/ 1개/)).toBeInTheDocument();
  });
});
