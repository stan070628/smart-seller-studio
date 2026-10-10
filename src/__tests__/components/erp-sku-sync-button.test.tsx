// src/__tests__/components/erp-sku-sync-button.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import SkuSyncButton from '@/components/erp/stock/SkuSyncButton';
import { server } from '../mocks/server';

const data = (o: Record<string, unknown>) => ({ results: [], created: 0, exists: 0, failed: 0, skus: 0, more: false, ...o });

describe('SkuSyncButton', () => {
  it('누르면 빠진 상품을 맞추고 결과를 한 줄로 보인다 · 추가가 있으면 onDone', async () => {
    let calls = 0;
    server.use(http.post('/api/erp/skus/sync-missing', () => {
      calls++;
      return HttpResponse.json({ success: true, data: data({
        results: [
          { sellerProductId: 300, productName: 'C', status: 'created', skus: 2 },
          { sellerProductId: 200, productName: 'B', status: 'failed', skus: 0, error: '없음' },
        ],
        created: 1, failed: 1, skus: 2,
      }) });
    }));
    const onDone = vi.fn();
    render(<SkuSyncButton onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: /SKU 다시 맞추기/ }));
    expect(await screen.findByText('SKU 2개 추가 · 이미 있음 0 · 실패 1(200)')).toBeInTheDocument();
    expect(calls).toBe(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('빠진 상품이 없으면 그렇게 말하고 onDone을 부르지 않는다', async () => {
    server.use(http.post('/api/erp/skus/sync-missing', () => HttpResponse.json({ success: true, data: data({}) })));
    const onDone = vi.fn();
    render(<SkuSyncButton onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: /SKU 다시 맞추기/ }));
    expect(await screen.findByText(/빠진 상품 없음/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('서버 오류 — 결과 줄 없이 버튼을 다시 누를 수 있다', async () => {
    server.use(http.post('/api/erp/skus/sync-missing', () => HttpResponse.json({ success: false, code: 'server', error: '서버 오류' }, { status: 500 })));
    render(<SkuSyncButton onDone={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /SKU 다시 맞추기/ });
    fireEvent.click(btn);
    await waitFor(() => expect(btn).not.toBeDisabled());
    expect(screen.getByRole('button', { name: /SKU 다시 맞추기/ })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('다시 누르면 이전 결과 줄을 지운다(오류여도 낡은 결과가 남지 않는다)', async () => {
    server.use(http.post('/api/erp/skus/sync-missing', () => HttpResponse.json({ success: true, data: data({}) }), { once: true }));
    render(<SkuSyncButton onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /SKU 다시 맞추기/ }));
    expect(await screen.findByText(/빠진 상품 없음/)).toBeInTheDocument();
    server.use(http.post('/api/erp/skus/sync-missing', () => HttpResponse.json({ success: false, code: 'server', error: '서버 오류' }, { status: 500 })));
    fireEvent.click(screen.getByRole('button', { name: /SKU 다시 맞추기/ }));
    await waitFor(() => expect(screen.queryByText(/빠진 상품 없음/)).toBeNull());
  });
});
