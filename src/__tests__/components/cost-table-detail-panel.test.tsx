import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProductDetailPanel from '@/components/orders/cost-table/ProductDetailPanel';

const base = {
  id: 'p1', product_name: '테스트상품', platform_fee_rate: 0.108,
  weighted_avg_cost: 3000, weighted_avg_shipping: 500, weighted_avg_rg_shipping: 0,
  current_stock: 12, stock_value: 36000, ad_spend: 0, entry_count: 1,
} as any;

function renderInTable(ui: React.ReactNode) {
  return render(<table><tbody>{ui}</tbody></table>);
}

describe('ProductDetailPanel', () => {
  it('수치 스트립에 재고·재고가치·원가·수수료율을 표시한다', () => {
    renderInTable(
      <ProductDetailPanel product={base} colSpan={7} isEditablePeriod={false}
        onOpenDrawer={vi.fn()} onSaveAdSpend={vi.fn()} channelFilter="all" rgInventory={new Map()} rgInventoryLoading={false} />,
    );
    expect(screen.getByText(/12개/)).toBeInTheDocument();
    expect(screen.getByText(/36,000/)).toBeInTheDocument();
    expect(screen.getByText(/3,000/)).toBeInTheDocument();
    expect(screen.getByText(/10\.8%/)).toBeInTheDocument();
  });

  it('[입고·판매 관리] 클릭 시 onOpenDrawer(product.id)를 호출한다', () => {
    const onOpen = vi.fn();
    renderInTable(
      <ProductDetailPanel product={base} colSpan={7} isEditablePeriod={false}
        onOpenDrawer={onOpen} onSaveAdSpend={vi.fn()} channelFilter="all" rgInventory={new Map()} rgInventoryLoading={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /입고·판매 관리/ }));
    expect(onOpen).toHaveBeenCalledWith('p1');
  });

  it('단일 월 기간이면 광고비를 편집해 onSaveAdSpend를 호출한다', () => {
    const onSave = vi.fn();
    renderInTable(
      <ProductDetailPanel product={{ ...base, ad_spend: 0 }} colSpan={7} isEditablePeriod={true}
        onOpenDrawer={vi.fn()} onSaveAdSpend={onSave} channelFilter="all" rgInventory={new Map()} rgInventoryLoading={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /광고비/ }));
    const input = screen.getByLabelText('광고비 입력');
    fireEvent.change(input, { target: { value: '50000' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith('p1', '50000');
  });

  it('Escape는 저장하지 않고 편집을 닫는다', () => {
    const onSave = vi.fn();
    renderInTable(
      <ProductDetailPanel product={{ ...base, ad_spend: 0 }} colSpan={7} isEditablePeriod={true}
        onOpenDrawer={vi.fn()} onSaveAdSpend={onSave} channelFilter="all" rgInventory={new Map()} rgInventoryLoading={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /광고비/ }));
    const input = screen.getByLabelText('광고비 입력');
    fireEvent.change(input, { target: { value: '99999' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('fifoError면 재고초과 안내 줄을 렌더한다', () => {
    renderInTable(
      <ProductDetailPanel product={base} colSpan={7} isEditablePeriod={false}
        onOpenDrawer={vi.fn()} onSaveAdSpend={vi.fn()} channelFilter="all" rgInventory={new Map()} rgInventoryLoading={false} fifoError />,
    );
    expect(screen.getByText(/입고 수량을 초과/)).toBeInTheDocument();
  });

  it('fifoError가 없으면 안내 줄이 없다', () => {
    renderInTable(
      <ProductDetailPanel product={base} colSpan={7} isEditablePeriod={false}
        onOpenDrawer={vi.fn()} onSaveAdSpend={vi.fn()} channelFilter="all" rgInventory={new Map()} rgInventoryLoading={false} />,
    );
    expect(screen.queryByText(/입고 수량을 초과/)).not.toBeInTheDocument();
  });
});
