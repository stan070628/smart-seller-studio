import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({ fetchKarrot: vi.fn(), postKarrot: vi.fn(), postKarrotCancel: vi.fn() }));
vi.mock('@/components/erp/stock/api', () => ({ fetchKarrot: m.fetchKarrot, postKarrot: m.postKarrot, postKarrotCancel: m.postKarrotCancel }));
// SKU 검색 대신 누르면 바로 고르는 버튼
vi.mock('@/components/erp/stock/SkuPicker', () => ({
  default: ({ onChange }: { onChange: (r: unknown) => void }) => (
    <button type="button" onClick={() => onChange({ skuId: 72, name: '극세사 타월', option: '블루', self: 5 })}>SKU 고르기</button>
  ),
}));

import KarrotSaleForm from '@/components/erp/stock/KarrotSaleForm';

const fill = (amount = '20000') => {
  fireEvent.click(screen.getByText('SKU 고르기'));
  fireEvent.change(screen.getByLabelText('받은 돈'), { target: { value: amount } });
};
const save = () => fireEvent.click(screen.getByRole('button', { name: '당근 판매 저장' }));
const idOf = (i: number) => (m.postKarrot.mock.calls[i][0] as { requestId: string }).requestId;

beforeEach(() => {
  vi.clearAllMocks();
  m.fetchKarrot.mockResolvedValue({ ok: true, data: [] });
});

describe('KarrotSaleForm — (1-C2b ③ 리뷰) 재시도 멱등', () => {
  it('저장이 실패한 뒤 다시 누르면 같은 요청 id를 보낸다 — 서버가 duplicate로 답한다', async () => {
    m.postKarrot
      .mockResolvedValueOnce({ ok: false, status: 500, error: '응답을 받지 못했다' })
      .mockResolvedValueOnce({ ok: true, data: { lineId: 901, outcome: 'duplicate', legacyWarnings: [] } });
    render(<KarrotSaleForm variant="pc" />);
    fill();
    save();
    expect(await screen.findByText('응답을 받지 못했다')).toBeInTheDocument();
    save();
    expect(await screen.findByText('이미 기록된 판매입니다')).toBeInTheDocument();
    expect(m.postKarrot).toHaveBeenCalledTimes(2);
    expect(idOf(1)).toBe(idOf(0));
  });

  it('실패 뒤 입력을 바꾸면 새 요청 id · 성공 뒤 다음 판매도 새 요청 id', async () => {
    m.postKarrot
      .mockResolvedValueOnce({ ok: false, status: 409, code: 'stock', error: '집 재고 1개(원장 1 − 차감 대기 0)보다 많다 — 먼저 재고를 고친다' })
      .mockResolvedValue({ ok: true, data: { lineId: 901, outcome: 'recorded', legacyWarnings: [] } });
    render(<KarrotSaleForm variant="pc" />);
    fill();
    save();
    expect(await screen.findByText(/집 재고 1개/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('받은 돈'), { target: { value: '15000' } });
    save();
    await screen.findByText(/기록했습니다/);
    expect(idOf(1)).not.toBe(idOf(0));
    fill('10000');
    save();
    await waitFor(() => expect(m.postKarrot).toHaveBeenCalledTimes(3));
    expect(idOf(2)).not.toBe(idOf(1));
  });

  it('옛 장부 경고가 있으면 노란 안내를 보인다', async () => {
    m.postKarrot.mockResolvedValue({
      ok: true, data: { lineId: 901, outcome: 'recorded', legacyWarnings: [{ key: 'karrot-x', reason: 'sold_without_product_cost' }] },
    });
    render(<KarrotSaleForm variant="mobile" />);
    fill();
    save();
    expect(await screen.findByText('수익 화면에는 잡히지 않는다 — 이 SKU에 옛 원가 상품 연결이 없다')).toBeInTheDocument();
  });
});
