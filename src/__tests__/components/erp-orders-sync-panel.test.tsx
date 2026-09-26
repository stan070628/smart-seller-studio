import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import OrdersSyncPanel from '@/components/erp/stock/OrdersSyncPanel';
import { server } from '../mocks/server';

const ch = (channel: string, label: string, o: Record<string, unknown> = {}) => ({
  channel, label, today: { orders: 0, lines: 0 }, yesterday: { orders: 0, lines: 0 }, last3: { orders: 0, lines: 0 },
  unattributed: 0, short: 0, pending: 0, unknownStatus: 0, cursorAt: '2026-09-27T02:45:00.000Z',
  lastError: 0, lastBusy: 0, lastAbsenceRefused: 0, lastRejected: 0, ...o,
});
const STATUS = {
  today: '2026-09-27', cutover: '2026-09-26T11:07:04.989Z', deduct: { enabled: false, enabledAt: null, by: null },
  channels: [
    ch('coupang_wing', '쿠팡 판매자배송', { today: { orders: 3, lines: 4 } }),
    ch('coupang_rg', '쿠팡 RG', { lastError: null, lastBusy: null, lastAbsenceRefused: null, lastRejected: null, cursorAt: null }),
    ch('naver', '네이버', { unattributed: 2, pending: 5, unknownStatus: 1 }),
    ch('toss', '토스', { lastError: 1, lastBusy: 1, lastAbsenceRefused: 1, lastRejected: 3 }),
  ],
  lastRun: { startedAt: '2026-09-27T02:45:00.000Z', finishedAt: '2026-09-27T02:45:40.000Z', status: 'ok', error: null },
};
const PREVIEW = {
  cutover: '2026-09-26T11:07:04.989Z', lines: 7, skus: 4, self: 6, rg: 3, firstPaidAt: '2026-09-26T12:00:00.000Z', lastPaidAt: '2026-09-27T02:00:00.000Z',
  byChannel: { coupang_wing: 3, coupang_rg: 2, naver: 2, toss: 0 },
  shortages: [{ skuId: 9, name: '퓨어틴 커피', option: '', location: 'rg', need: 3, have: 1 }],
};

describe('OrdersSyncPanel', () => {
  it('채널별 건수·미귀속·실패를 보이고, 날짜 칸을 누르면 그날 라인을 연다', async () => {
    const seen: string[] = [];
    server.use(
      http.get('/api/erp/orders/status', () => HttpResponse.json({ success: true, data: STATUS })),
      http.get('/api/erp/orders/lines', ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json({ success: true, data: [{
          id: 1, externalOrderId: '31000000001', externalLineId: '6200000001:70000000001', orderedAt: '2026-09-27T01:15:00.000Z', paidAt: '2026-09-27T01:15:30.000Z',
          status: 'paid', rawStatus: 'ACCEPT', productLabel: '접이식 왜건 · 블랙', orderQty: 2, skuQty: 2, amount: 31800, attribution: 'mapped',
          unattributedReason: null, deductionState: 'pending', deductionNote: null, skuLabels: '왜건 · 블랙 ×2',
        }] });
      }),
    );
    render(<OrdersSyncPanel onChanged={vi.fn()} />);
    expect(await screen.findByText('쿠팡 판매자배송')).toBeInTheDocument();
    expect(screen.getByText(/기록만/)).toBeInTheDocument();
    expect(screen.getByText('실패')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '쿠팡 판매자배송 2026-09-27 3건 4줄' }));
    expect(await screen.findByText('접이식 왜건 · 블랙')).toBeInTheDocument();
    expect(seen).toEqual(['?channel=coupang_wing&date=2026-09-27']);
    expect(screen.getByText('왜건 · 블랙 ×2')).toBeInTheDocument();
  });

  it('마지막 실행의 임대 못 잡음·사라짐 거절·버린 라인·모르는 상태를 채널별로 태그로 보인다', async () => {
    server.use(http.get('/api/erp/orders/status', () => HttpResponse.json({ success: true, data: STATUS })));
    render(<OrdersSyncPanel onChanged={vi.fn()} />);
    expect(await screen.findByText('쿠팡 판매자배송')).toBeInTheDocument();
    // 네이버: unattributed 2 · unknownStatus 1
    expect(screen.getByText('모르는 상태 1')).toBeInTheDocument();
    // 토스: lastError 1 · lastBusy 1 · lastAbsenceRefused 1 · lastRejected 3
    expect(screen.getByText('임대 못 잡음')).toBeInTheDocument();
    expect(screen.getByText('사라짐 거절')).toBeInTheDocument();
    expect(screen.getByText('버림 3')).toBeInTheDocument();
    // RG: 기록 없음(전부 null)
    expect(screen.getByText('기록 없음')).toBeInTheDocument();
  });

  it('「차감 켜기…」 — 미리보기를 보이고, 대조 확인을 체크해야 켜며, 본 라인 수를 보낸다', async () => {
    let body: unknown = null;
    server.use(
      http.get('/api/erp/orders/status', () => HttpResponse.json({ success: true, data: STATUS })),
      http.get('/api/erp/orders/deduct-preview', () => HttpResponse.json({ success: true, data: PREVIEW })),
      http.post('/api/erp/orders/deduct-enable', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { preview: PREVIEW, summary: { posted: 6, reversed: 0, short: 1, pending: 0, unchanged: 0 } } });
      }),
    );
    const onChanged = vi.fn();
    render(<OrdersSyncPanel onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole('button', { name: '차감 켜기…' }));
    expect(await screen.findByText(/소급 7줄/)).toBeInTheDocument();
    expect(screen.getByText(/집 −6개/)).toBeInTheDocument();
    expect(screen.getByText(/RG −3개/)).toBeInTheDocument();
    expect(screen.getByText(/퓨어틴 커피/)).toBeInTheDocument();
    const go = screen.getByRole('button', { name: '차감 켜기' });
    expect(go).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /3일 건수를 대조했습니다/ }));
    fireEvent.click(go);
    await waitFor(() => expect(body).toEqual({ confirm: true, expectedLines: 7 }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('「지금 수집」은 수집 API를 부르고 현황을 다시 읽는다', async () => {
    let statusCalls = 0;
    let synced = false;
    server.use(
      http.get('/api/erp/orders/status', () => { statusCalls++; return HttpResponse.json({ success: true, data: STATUS }); }),
      http.post('/api/erp/orders/sync', () => {
        synced = true;
        return HttpResponse.json({ success: true, data: [{ channel: 'naver', ok: true, inserted: 2, error: null }] });
      }),
    );
    render(<OrdersSyncPanel onChanged={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /지금 수집/ }));
    await waitFor(() => expect(synced).toBe(true));
    await waitFor(() => expect(statusCalls).toBe(2));
  });
});
