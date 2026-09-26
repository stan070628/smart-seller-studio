import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import CsvImportDialog from '@/components/erp/stock/CsvImportDialog';
import { server } from '../mocks/server';

const summary = {
  committed: 0, cutoverAt: null, totals: { entries: 1, self: 3, rgInbound: 0, rg: 0, value: 3000 },
  errors: [], warnings: [], costs: [],
  excluded: [
    { skuKey: 'k7', kind: 'stocked', reason: '원장에 이미 전표가 있다 — 재고현황에서 조정으로 고친다' },
    { skuKey: 'k8', kind: 'stocked', reason: '원장에 이미 전표가 있다 — 재고현황에서 조정으로 고친다' },
    { skuKey: 'k9', kind: 'blank', reason: 'self_count 빈칸 — 불러오지 않는다' },
  ],
};

describe('CsvImportDialog', () => {
  it('🔴 원장에 이미 전표가 있는 SKU 수를 접힌 목록 밖에 보인다', async () => {
    server.use(http.post('/api/erp/stock/import', () => HttpResponse.json({ success: true, data: summary })));
    render(<CsvImportDialog onClose={vi.fn()} onCommitted={vi.fn()} />);
    const file = new File(['sku_key,self_count\nk7,3\n'], 'count.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('실사표 CSV'), { target: { files: [file] } });
    await screen.findByText('count.csv');
    fireEvent.click(screen.getByText('미리보기'));
    const note = await screen.findByText(/원장에 이미 전표가 있는 SKU 2개 — 불러오지 않음\(집·입고중·RG 모두; 화면·RG 대조로 입력\)/);
    expect(note.closest('details')).toBeNull();
    const details = screen.getByText('불러오지 않는 행 3건').closest('details')!;
    expect(within(details).getByText(/k9/)).toBeInTheDocument();
  });
});
