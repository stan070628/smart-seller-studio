import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GroupRow from '@/components/orders/cost-table/GroupRow';

const group = {
  kind: 'group', sellerProductId: '100', productName: '무선이어폰',
  children: [
    { id: 'a', sale_quantity: 100, hidden: false },
    { id: 'b', sale_quantity: 36, hidden: false },
  ],
  totalStock: 120, totalStockValue: 360000, totalProfit: 380000,
  totalSalesAmount: 2290000, avgCost: 3000, groupMarginRate: 16.6,
} as any;

function renderGroup(props = {}) {
  const defaults = { group, expanded: false, colCount: 7, onToggleGroup: vi.fn(), onToggleGroupHide: vi.fn() };
  return render(<table><tbody><GroupRow {...defaults} {...props} /></tbody></table>);
}

describe('GroupRow', () => {
  it('집계 매출·실현손익·마진율과 옵션 수를 표시한다', () => {
    renderGroup();
    expect(screen.getByText('무선이어폰')).toBeInTheDocument();
    expect(screen.getByText(/380,000/)).toBeInTheDocument();
    expect(screen.getByText(/16\.6%/)).toBeInTheDocument();
    expect(screen.getByText(/옵션 2개/)).toBeInTheDocument();
  });

  it('행 클릭 시 옵션 펼침(onToggleGroup)을 호출한다', () => {
    const onToggle = vi.fn();
    renderGroup({ onToggleGroup: onToggle });
    fireEvent.click(screen.getByText('무선이어폰'));
    expect(onToggle).toHaveBeenCalledWith('100');
  });

  it('그룹 숨김 버튼은 그룹 토글을 유발하지 않는다(전파 차단)', () => {
    const onToggle = vi.fn();
    const onHide = vi.fn();
    renderGroup({ onToggleGroup: onToggle, onToggleGroupHide: onHide });
    fireEvent.click(screen.getByLabelText(/그룹.*숨기기|그룹 복원/));
    expect(onHide).toHaveBeenCalledWith(group);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
