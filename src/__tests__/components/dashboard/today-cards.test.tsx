// src/__tests__/components/dashboard/today-cards.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import TodayCards from '@/components/dashboard/TodayCards';
import TodayFlow from '@/components/dashboard/TodayFlow';
import type { TodayData } from '@/lib/erp/home/today';
import { E } from '@/lib/design-tokens';

const ok = <T,>(data: T) => ({ data, error: null });
const base: TodayData = {
  newOrders: ok({ count: 9, stale: 2 }),
  unmapped: ok({ lines: 0 }),
  jobFailures: ok({ jobs: [{ job: 'orders-sync', count: 3, lastAt: '2026-10-09T01:15:00.000Z' }] }),
  shortage: ok({ lines: 16, skus: 8 }),
  rgMismatch: ok({ alerts: 0, runAt: '2026-10-09T00:37:00.000Z' }),
  flow: ok({ paid: 10, shipping: 4, delivered: 70, confirmed: 2, cancel_requested: 0, canceled: 3, return_requested: 0, returned: 1 }),
};

describe('TodayCards', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-09T03:00:00.000Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('카드 5개 — 숫자·경고·링크', () => {
    render(<TodayCards data={base} />);
    const n = screen.getByRole('link', { name: /출고 대기 주문/ });
    expect(n).toHaveAttribute('href', '/orders');
    expect(within(n).getByText('9')).toBeInTheDocument();
    expect(within(n).getByText(/출고 지연 의심 2건/)).toBeInTheDocument();
    expect(n).toHaveStyle({ borderColor: E.loss });
    expect(screen.getByRole('link', { name: /재고 부족 보류/ })).toHaveAttribute('href', '/erp/stock');
    expect(screen.getByText(/16줄 · 8 SKU/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /오늘 실사 목록 보기/ })).toHaveAttribute('href', '/erp/stock');
    expect(screen.getByText(/orders-sync 3회/)).toBeInTheDocument();
  });

  it('0건 카드는 「없음」으로 남는다(숨기지 않는다)', () => {
    render(<TodayCards data={base} />);
    const m = screen.getByRole('link', { name: /매핑 필요/ });
    expect(within(m).getByText('없음')).toBeInTheDocument();
    const rg = screen.getByRole('link', { name: /RG 대조 경고/ });
    expect(within(rg).getByText('없음')).toBeInTheDocument();
  });

  it('출고 지연 의심이 없으면 기본 보조 문구', () => {
    render(<TodayCards data={{ ...base, newOrders: ok({ count: 3, stale: 0 }) }} />);
    expect(within(screen.getByRole('link', { name: /출고 대기 주문/ })).getByText(/직접발송 · 결제됐고 출고 전/)).toBeInTheDocument();
  });

  it('RG 경고 건수가 있으면 숫자로 보인다', () => {
    render(<TodayCards data={{ ...base, rgMismatch: ok({ alerts: 2, runAt: '2026-10-09T00:37:00.000Z' }) }} />);
    expect(within(screen.getByRole('link', { name: /RG 대조 경고/ })).getByText('2')).toBeInTheDocument();
  });

  it('RG 대조가 26시간 넘게 없으면 경고 0건이어도 경고 문구', () => {
    render(<TodayCards data={{ ...base, rgMismatch: ok({ alerts: 0, runAt: '2026-10-08T00:00:00.000Z' }) }} />);
    const rg = screen.getByRole('link', { name: /RG 대조 경고/ });
    expect(within(rg).getByText(/26시간 넘게 대조가 없다/)).toBeInTheDocument();
    expect(rg).toHaveStyle({ borderColor: E.warn });
  });

  it('RG 대조가 정확히 26시간 전이면 아직 낡지 않았다(경계)', () => {
    render(<TodayCards data={{ ...base, rgMismatch: ok({ alerts: 0, runAt: '2026-10-08T01:00:00.000Z' }) }} />);
    const rg = screen.getByRole('link', { name: /RG 대조 경고/ });
    expect(within(rg).queryByText(/26시간 넘게/)).not.toBeInTheDocument();
    expect(rg).not.toHaveStyle({ borderColor: E.warn });
  });

  it('RG 대조 기록이 아예 없으면 「대조 기록 없음」', () => {
    render(<TodayCards data={{ ...base, rgMismatch: ok({ alerts: 0, runAt: null }) }} />);
    expect(within(screen.getByRole('link', { name: /RG 대조 경고/ })).getByText('대조 기록 없음')).toBeInTheDocument();
  });

  it('카드 하나가 오류면 그 카드만 오류 문구', () => {
    render(<TodayCards data={{ ...base, unmapped: { data: null, error: 'boom' } }} />);
    const m = screen.getByRole('link', { name: /매핑 필요/ });
    expect(within(m).getByText(/불러오지 못했다/)).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: /출고 대기 주문/ })).getByText('9')).toBeInTheDocument();
  });
});

describe('TodayFlow', () => {
  it('상태 순서대로 건수 · 구매확정 라벨', () => {
    render(<TodayFlow flow={base.flow} />);
    expect(screen.getByText('최근 7일 직접발송 주문')).toBeInTheDocument();
    expect(screen.getByText('결제완료 10')).toBeInTheDocument();
    expect(screen.getByText('구매확정 2')).toBeInTheDocument();
    expect(screen.getByText(/취소 3/)).toBeInTheDocument();
    expect(screen.getByText(/반품 1/)).toBeInTheDocument();
  });
});
