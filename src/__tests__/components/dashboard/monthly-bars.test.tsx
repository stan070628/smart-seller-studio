// src/__tests__/components/dashboard/monthly-bars.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MonthlyBars from '@/components/dashboard/MonthlyBars';
import type { MonthTotal } from '@/lib/erp/home/monthly';

const months: MonthTotal[] = [
  { month: '2026-07', revenue: 15050303, orders: 784, source: 'legacy' },
  { month: '2026-08', revenue: 15852140, orders: 806, source: 'legacy' },
  { month: '2026-09', revenue: 16408880, orders: 862, source: 'erp' },
];

describe('MonthlyBars', () => {
  it('달마다 막대 · 옛 장부 달은 표시가 붙는다', () => {
    render(<MonthlyBars months={months} />);
    expect(screen.getByRole('region', { name: '최근 월 매출' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '9월 매출 16,408,880원' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '7월 매출 15,050,303원 (옛 장부 기준)' })).toBeInTheDocument();
    expect(screen.getByText(/옛 장부 기준 · 실제보다 적을 수 있음/)).toBeInTheDocument();
  });

  it('마우스를 올리면 월·금액·건수, 옛 장부 달은 주의 문구', () => {
    render(<MonthlyBars months={months} />);
    fireEvent.mouseEnter(screen.getByRole('img', { name: /7월 매출/ }));
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('2026년 7월 · 15,050,303원 · 784건');
    expect(tip).toHaveTextContent('옛 장부 기준 — 실제보다 적을 수 있음');
    fireEvent.mouseEnter(screen.getByRole('img', { name: /9월 매출/ }));
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('옛 장부');
  });

  it('옛 장부 달이 없으면 주의 문구도 없다', () => {
    render(<MonthlyBars months={[months[2]]} />);
    expect(screen.queryByText(/옛 장부 기준 · 실제보다 적을 수 있음/)).not.toBeInTheDocument();
  });
});
