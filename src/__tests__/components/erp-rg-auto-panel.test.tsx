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
      rows: [{ skuId: 72, vid: null, label: '극세사 타월 · 블루', ledger: 100, actual: 108, inbound: 5, planned: 5, moved: 0, alert: null }],
    } })));
    render(<RgAutoPanel />);
    expect(await screen.findByText(/극세사 타월 · 블루/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('기록의 「키|」 앞머리는 떼고 보인다', async () => {
    server.use(http.get('/api/erp/stock/rg-auto', () => HttpResponse.json({ success: true, data: {
      runAt: '2026-10-05T00:37:00Z',
      rows: [{ skuId: 72, vid: null, label: '극세사 타월 · 블루', ledger: 100, actual: 108, inbound: 5, planned: 5, moved: 0, alert: 'unsent_increase:72|3개 많다' }],
    } })));
    render(<RgAutoPanel />);
    expect(await screen.findByText(/· 3개 많다/)).toBeInTheDocument();
    expect(screen.queryByText(/unsent_increase/)).not.toBeInTheDocument();
  });
});
