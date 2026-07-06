import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProductRow from '@/components/orders/cost-table/ProductRow';

vi.mock('@/components/orders/ChannelCell', () => ({
  default: ({ onEditChannel }: any) => (
    <button onClick={() => onEditChannel(document.body)}>채널셀스텁</button>
  ),
}));

const product = {
  id: 'p1', product_name: '무선이어폰', seller_product_id: 100,
  total_sales_amount: 2290000, sale_quantity: 136, sale_count: 40,
  total_realized_profit: 380000, margin_rate: 0.166, ad_roas: 420, breakeven_roas: 300,
  winner_status: 'winner', hidden: false, entry_count: 1, channels: [],
} as any;

function renderRow(props = {}) {
  const defaults = {
    product, isChild: false, expanded: false, colCount: 7,
    onToggleDetail: vi.fn(), onOpenDrawer: vi.fn(), onSaveAdSpend: vi.fn(),
    onHide: vi.fn(), onDelete: vi.fn(), onEditChannel: vi.fn(), onProductUpdate: vi.fn(),
    isEditablePeriod: false, channelFilter: 'all' as const, rgInventory: new Map(),
  };
  return render(<table><tbody><ProductRow {...defaults} {...props} /></tbody></table>);
}

describe('ProductRow', () => {
  it('KPI 열(매출/수량/실현손익/마진율/ROAS)과 위너 배지를 렌더한다', () => {
    renderRow();
    expect(screen.getByText('무선이어폰')).toBeInTheDocument();
    expect(screen.getByText(/136/)).toBeInTheDocument();
    expect(screen.getByText(/380,000/)).toBeInTheDocument();
    expect(screen.getByText(/16\.6%/)).toBeInTheDocument();
    expect(screen.getByText(/420%/)).toBeInTheDocument();
    expect(screen.getByText('위너')).toBeInTheDocument();
  });

  it('chevron 클릭 시 onToggleDetail(product.id)를 호출한다', () => {
    const onToggle = vi.fn();
    renderRow({ onToggleDetail: onToggle });
    fireEvent.click(screen.getByLabelText('상세 펼치기'));
    expect(onToggle).toHaveBeenCalledWith('p1');
  });

  it('채널 셀 클릭은 상세 토글을 유발하지 않는다(전파 차단)', () => {
    const onToggle = vi.fn();
    renderRow({ onToggleDetail: onToggle });
    fireEvent.click(screen.getByText('채널셀스텁'));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('⋯ 메뉴에서 삭제를 호출한다', () => {
    const onDelete = vi.fn();
    renderRow({ onDelete });
    fireEvent.click(screen.getByLabelText('행 메뉴'));
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(onDelete).toHaveBeenCalledWith(product);
  });

  it('fifo_error면 재고초과 배지와 실현손익 "확인 필요"를 렌더한다', () => {
    renderRow({ product: { ...product, fifo_error: true } });
    expect(screen.getByText(/재고초과/)).toBeInTheDocument();
    expect(screen.getByText('확인 필요')).toBeInTheDocument();
  });

  it('fifo_error가 아니면 재고초과 배지가 없다', () => {
    renderRow({ product: { ...product, fifo_error: false } });
    expect(screen.queryByText(/재고초과/)).not.toBeInTheDocument();
  });
});
