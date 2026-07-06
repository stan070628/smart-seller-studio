import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OverstockBadge } from '@/components/orders/cost-table/OverstockBadge';

describe('OverstockBadge', () => {
  it('재고초과 경고 텍스트와 툴팁을 렌더한다', () => {
    render(<OverstockBadge />);
    const el = screen.getByText(/재고초과/);
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute('title', expect.stringContaining('초과'));
  });
});
