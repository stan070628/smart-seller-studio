import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import CountQueuePanel from '@/components/erp/stock/CountQueuePanel';
import type { StockRow } from '@/components/erp/stock/stock-view';
import { server } from '../mocks/server';

const row = (o: Partial<StockRow>): StockRow => ({
  skuId: 1, key: 'k1', name: '왜건', option: '블랙', legacyProductCostIds: [], self: 5, rgInbound: 0, rg: 0, value: 3500,
  hasLedger: true, hasSelfLedger: true, lotCost: 700, legacyCost: null, costNeedsInput: false, selfValue: 3500, lastCountedAt: null, ...o,
});
const A = row({});
const B = row({ skuId: 2, key: 'k2', name: '매트', option: '', self: 2, selfValue: 1400, lastCountedAt: '2026-09-20T01:00:00Z' });
const serveQueue = () =>
  server.use(http.get('/api/erp/stock/count-queue', () => HttpResponse.json({ success: true, data: { today: '2026-09-27', n: 8, items: [A, B] } })));

describe('CountQueuePanel', () => {
  it('오늘 셀 목록을 보이고, 센 개수를 저장하면(차이가 없어도) 그 줄이 빠진다', async () => {
    serveQueue();
    const onSave = vi.fn(async () => true);
    render(<CountQueuePanel rowById={new Map([[1, A], [2, B]])} busy={false} onSave={onSave} />);
    expect(await screen.findByText('왜건')).toBeInTheDocument();
    expect(screen.getByText(/남은 2 \/ 2개/)).toBeInTheDocument();
    expect(screen.getByText('안 셈')).toBeInTheDocument();
    expect(screen.getByText('2026-09-20')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '세기' })[0]);
    expect(screen.queryByText('±수량')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('저장'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ skuId: 1, location: 'self', mode: 'count', value: 5, expected: 5, reason: 'count_diff' })));
    await waitFor(() => expect(screen.queryByText('왜건')).not.toBeInTheDocument());
    expect(screen.getByText(/남은 1 \/ 2개/)).toBeInTheDocument();
  });

  it('저장이 실패하면 줄을 남긴다', async () => {
    serveQueue();
    const onSave = vi.fn(async () => false);
    render(<CountQueuePanel rowById={new Map([[1, A], [2, B]])} busy={false} onSave={onSave} />);
    fireEvent.click((await screen.findAllByRole('button', { name: '세기' }))[0]);
    fireEvent.click(screen.getByText('저장'));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(screen.getByText('왜건')).toBeInTheDocument();
  });
});
