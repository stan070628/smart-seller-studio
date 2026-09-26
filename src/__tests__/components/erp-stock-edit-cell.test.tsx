import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EditCell from '@/components/erp/stock/EditCell';
import type { StockRow } from '@/components/erp/stock/stock-view';

const row: StockRow = {
  skuId: 1, key: 'cp:1:블랙', name: '왜건', option: '블랙', legacyProductCostIds: [], self: 10, rgInbound: 0, rg: 0, value: 7000,
  hasLedger: true, lotCost: 700, legacyCost: null, costNeedsInput: false,
};

describe('EditCell', () => {
  it('지금 개수를 적으면 차이를 보이고, 저장하면 count 편집을 넘긴다', () => {
    const onSubmit = vi.fn();
    render(<EditCell row={row} location="self" countMode={false} onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('지금 개수'), { target: { value: '7' } });
    expect(screen.getByText('10 → 7 (-3)')).toBeInTheDocument();
    fireEvent.click(screen.getByText('저장'));
    expect(onSubmit).toHaveBeenCalledWith({ skuId: 1, location: 'self', mode: 'count', value: 7, expected: 10, reason: 'count_diff', note: '', unitCost: null });
  });

  it('±수량으로 늘리면 최근 lot 단가를 미리 채워 함께 넘긴다', () => {
    const onSubmit = vi.fn();
    render(<EditCell row={row} location="self" countMode={false} onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.click(screen.getByText('±수량'));
    fireEvent.change(screen.getByLabelText('±수량'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('사유'), { target: { value: 'return_in' } });
    expect(screen.getByLabelText('단가')).toHaveValue('700');
    fireEvent.click(screen.getByText('저장'));
    expect(onSubmit).toHaveBeenCalledWith({ skuId: 1, location: 'self', mode: 'delta', value: 2, expected: 10, reason: 'return_in', note: '', unitCost: 700 });
  });

  it('단가를 모르면 늘리는 저장이 막힌다', () => {
    render(<EditCell row={{ ...row, lotCost: null }} location="self" countMode={false} onSubmit={vi.fn()} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText('지금 개수'), { target: { value: '12' } });
    expect(screen.getByText('저장')).toBeDisabled();
  });

  it('실사 모드에서는 「담기」', () => {
    render(<EditCell row={row} location="rg_inbound" countMode onSubmit={vi.fn()} onCancel={() => {}} />);
    expect(screen.getByText('담기')).toBeInTheDocument();
  });

  describe('원장 전표가 없는 위치(빈 위치)', () => {
    const emptyRow: StockRow = { ...row, hasLedger: false };

    it('기초재고로 기록된다는 안내를 보이고, 사유는 서버가 정하므로 고르지 않는다', () => {
      render(<EditCell row={emptyRow} location="self" countMode={false} onSubmit={vi.fn()} onCancel={() => {}} />);
      expect(screen.getByText(/기초재고로 기록됩니다/)).toBeInTheDocument();
      expect(screen.queryByLabelText('사유')).not.toBeInTheDocument();
    });

    it('±수량에서 늘리면(+) 저장할 수 있다', () => {
      const onSubmit = vi.fn();
      render(<EditCell row={emptyRow} location="self" countMode={false} onSubmit={onSubmit} onCancel={() => {}} />);
      fireEvent.click(screen.getByText('±수량'));
      fireEvent.change(screen.getByLabelText('±수량'), { target: { value: '5' } });
      expect(screen.getByText('저장')).not.toBeDisabled();
      fireEvent.click(screen.getByText('저장'));
      expect(onSubmit).toHaveBeenCalled();
    });

    it('±수량에서 줄이면(−) 뺄 수 없다는 안내를 보이고 저장이 막힌다', () => {
      const onSubmit = vi.fn();
      render(<EditCell row={emptyRow} location="self" countMode={false} onSubmit={onSubmit} onCancel={() => {}} />);
      fireEvent.click(screen.getByText('±수량'));
      fireEvent.change(screen.getByLabelText('±수량'), { target: { value: '-2' } });
      expect(screen.getByText('비어 있는 위치에서는 뺄 수 없습니다(+ 만 기초재고로 기록됩니다)')).toBeInTheDocument();
      expect(screen.getByText('저장')).toBeDisabled();
      fireEvent.click(screen.getByText('저장'));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('원장이 있는 위치는 안내를 보이지 않고 사유를 고른다', () => {
      render(<EditCell row={row} location="self" countMode={false} onSubmit={vi.fn()} onCancel={() => {}} />);
      expect(screen.queryByText(/기초재고로 기록됩니다/)).not.toBeInTheDocument();
      expect(screen.getByLabelText('사유')).toBeInTheDocument();
    });
  });
});
