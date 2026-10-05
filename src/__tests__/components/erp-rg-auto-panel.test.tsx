import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import RgAutoPanel from '@/components/erp/stock/RgAutoPanel';
import { server } from '../mocks/server';

describe('RgAutoPanel', () => {
  it('불러오기가 실패하면 한 줄 오류(role=alert)', async () => {
    server.use(http.get('/api/erp/stock/rg-auto', () => HttpResponse.json({ success: false, error: '연결 실패' }, { status: 500 })));
    render(<RgAutoPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('연결 실패');
  });

  it('마지막 실행 줄을 보인다', async () => {
    server.use(http.get('/api/erp/stock/rg-auto', () => HttpResponse.json({ success: true, data: {
      runAt: '2026-10-05T00:37:00Z',
      rows: [{ skuId: 72, vid: null, label: '극세사 타월 · 블루', ledger: 100, actual: 108, inbound: 5, planned: 5, moved: 0, plannedReturn: 0, returned: 0, alert: null }],
    } })));
    render(<RgAutoPanel />);
    expect(await screen.findByText(/극세사 타월 · 블루/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('기록의 「키|」 앞머리는 떼고 보인다', async () => {
    server.use(http.get('/api/erp/stock/rg-auto', () => HttpResponse.json({ success: true, data: {
      runAt: '2026-10-05T00:37:00Z',
      rows: [{ skuId: 72, vid: null, label: '극세사 타월 · 블루', ledger: 100, actual: 108, inbound: 5, planned: 5, moved: 0, plannedReturn: 0, returned: 0, alert: 'unsent_increase:72|3개 많다' }],
    } })));
    render(<RgAutoPanel />);
    expect(await screen.findByText(/· 3개 많다/)).toBeInTheDocument();
    expect(screen.queryByText(/unsent_increase/)).not.toBeInTheDocument();
  });

  it('복귀는 실제 기록이면 「취소·반품 복귀」, 예정뿐이면 「복귀 예정」', async () => {
    server.use(http.get('/api/erp/stock/rg-auto', () => HttpResponse.json({ success: true, data: {
      runAt: '2026-10-05T00:37:00Z',
      rows: [
        { skuId: 72, vid: null, label: 'A', ledger: 1, actual: 1, inbound: 0, planned: 0, moved: 0, plannedReturn: 2, returned: 2, alert: null },
        { skuId: 73, vid: null, label: 'B', ledger: 1, actual: 1, inbound: 0, planned: 0, moved: 0, plannedReturn: 1, returned: 0, alert: null },
      ],
    } })));
    render(<RgAutoPanel />);
    expect(await screen.findByText(/취소·반품 복귀 2/)).toBeInTheDocument();
    expect(screen.getByText(/복귀 예정 1/)).toBeInTheDocument();
  });
});
