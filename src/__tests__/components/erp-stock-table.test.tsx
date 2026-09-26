import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import StockTable from '@/components/erp/stock/StockTable';
import { filterGroups, groupRows, type StockRow } from '@/components/erp/stock/stock-view';

const row = (o: Partial<StockRow>): StockRow => ({
  skuId: 1, key: 'k1', name: '왜건', option: '블랙', legacyProductCostIds: [], self: 3, rgInbound: 1, rg: 2, value: 6000,
  hasLedger: true, lotCost: 1000, legacyCost: null, costNeedsInput: false, selfValue: 0, lastCountedAt: null, ...o,
});
const ROWS = [
  row({}),
  row({ skuId: 2, key: 'k2', option: '베이지', self: 5, rgInbound: 0, rg: 0, value: 5000 }),
  row({ skuId: 3, key: 'k3', name: '매트', option: '', self: 4, rgInbound: 0, rg: 0, value: 2000 }),
];
const NO_FILTER = { q: '', onlyStocked: false, onlyRgMismatch: false };

function renderTable(forceOpen = false) {
  const onEdit = vi.fn();
  const onSelect = vi.fn();
  render(
    <StockTable
      views={filterGroups(groupRows(ROWS, null), NO_FILTER, null)}
      forceOpen={forceOpen}
      recon={null}
      staged={new Map()}
      countMode={false}
      editing={null}
      selected={null}
      busy={false}
      onEdit={onEdit}
      onCancelEdit={() => {}}
      onSubmitEdit={() => {}}
      onSelect={onSelect}
      onRgApply={() => {}}
    />,
  );
  return { onEdit, onSelect };
}
const trOf = (text: string) => screen.getByText(text).closest('tr')!;

describe('StockTable — 상품 묶음', () => {
  it('옵션 여러 개인 상품은 합계 한 줄로 접혀 있고, 누르면 옵션 행이 펼쳐진다', () => {
    const { onSelect } = renderTable();
    const group = trOf('왜건');
    expect(within(group).getByText('옵션 2')).toBeInTheDocument();
    expect(within(group).getByText('8')).toBeInTheDocument(); // 집 3 + 5
    expect(within(group).queryByTitle('눌러서 고칩니다')).toBeNull(); // 묶음 줄은 고치지 않는다
    expect(screen.queryByText('베이지')).not.toBeInTheDocument();
    fireEvent.click(group);
    expect(screen.getByText('베이지')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled(); // 묶음 줄은 이력을 열지 않는다
    fireEvent.click(trOf('왜건'));
    expect(screen.queryByText('베이지')).not.toBeInTheDocument();
  });

  it('옵션 1개 상품은 묶지 않고 한 줄 — 그 줄에서 바로 고치고, 누르면 이력', () => {
    const { onEdit, onSelect } = renderTable();
    const mat = trOf('매트');
    expect(within(mat).queryByText(/^옵션 /)).toBeNull();
    fireEvent.click(within(mat).getAllByTitle('눌러서 고칩니다')[0]);
    expect(onEdit).toHaveBeenCalledWith(3, 'self');
    fireEvent.click(mat);
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it('전체 펼치기·전체 접기', () => {
    renderTable();
    fireEvent.click(screen.getByText('전체 펼치기'));
    expect(screen.getByText('블랙')).toBeInTheDocument();
    expect(screen.getByText('베이지')).toBeInTheDocument();
    fireEvent.click(screen.getByText('전체 접기'));
    expect(screen.queryByText('블랙')).not.toBeInTheDocument();
  });

  it('조회조건이 걸리면(forceOpen) 묶음이 펼쳐져 있고 펼치기 버튼은 잠긴다', () => {
    renderTable(true);
    expect(screen.getByText('베이지')).toBeInTheDocument();
    expect(screen.getByText('전체 접기')).toBeDisabled();
  });

  it('「마지막 실사」 — 옵션은 날짜(KST) 또는 「안 셈」, 묶음은 안 센 옵션 수', () => {
    render(
      <StockTable
        views={filterGroups(groupRows([
          row({ lastCountedAt: '2026-09-26T15:30:00Z' }),
          row({ skuId: 2, key: 'k2', option: '베이지' }),
        ], null), NO_FILTER, null)}
        forceOpen
        recon={null} staged={new Map()} countMode={false} editing={null} selected={null} busy={false}
        onEdit={() => {}} onCancelEdit={() => {}} onSubmitEdit={() => {}} onSelect={() => {}} onRgApply={() => {}}
      />,
    );
    expect(screen.getByText('마지막 실사')).toBeInTheDocument();
    expect(screen.getByText('2026-09-27')).toBeInTheDocument();
    expect(within(trOf('베이지')).getByText('안 셈')).toBeInTheDocument();
    expect(within(trOf('왜건')).getByText('안 셈 1')).toBeInTheDocument();
  });
});
