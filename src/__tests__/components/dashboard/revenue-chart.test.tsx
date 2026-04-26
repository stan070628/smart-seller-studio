/**
 * RevenueChart SVG 라인차트 테스트
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RevenueChart from '@/components/dashboard/RevenueChart';

const TARGETS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950, 1000];

describe('RevenueChart', () => {
  it('타이틀과 SVG 차트를 렌더한다', () => {
    render(
      <RevenueChart
        weeks={[1,2,3,4,5,6,7,8,9,10,11,12]}
        target={TARGETS}
        actual={[10, null, null, null, null, null, null, null, null, null, null, null]}
        currentWeek={1}
      />
    );
    expect(screen.getByText(/12주 누적 매출/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /매출 추세 차트/ })).toBeInTheDocument();
  });

  it('actual이 모두 null이어도 충돌 없이 렌더한다', () => {
    render(
      <RevenueChart
        weeks={[1,2,3,4,5,6,7,8,9,10,11,12]}
        target={TARGETS}
        actual={new Array(12).fill(null)}
        currentWeek={1}
      />
    );
    expect(screen.getByRole('img', { name: /매출 추세 차트/ })).toBeInTheDocument();
  });

  it('Y축 최대값 라벨에 1000만원이 표시된다', () => {
    render(
      <RevenueChart
        weeks={[1,2,3,4,5,6,7,8,9,10,11,12]}
        target={TARGETS}
        actual={new Array(12).fill(null)}
        currentWeek={1}
      />
    );
    expect(screen.getByText('1000')).toBeInTheDocument();
  });
});
