import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const replaceMock = vi.fn();
const searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  usePathname: () => '/listing',
}));

import ListingDashboard from '@/components/listing/ListingDashboard';

describe('ListingDashboard — 탭 구조', () => {
  beforeEach(() => {
    replaceMock.mockClear();
    for (const k of Array.from(searchParams.keys())) searchParams.delete(k);
  });

  it('탭 3개가 렌더된다', () => {
    render(<ListingDashboard />);
    expect(screen.getByRole('button', { name: /AI 상품 등록/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /내 상품 조회/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /썸네일.*상세만 만들기/ })).toBeInTheDocument();
  });

  it('탭 클릭 시 URL ?tab= 파라미터로 동기화된다', () => {
    render(<ListingDashboard />);
    fireEvent.click(screen.getByRole('button', { name: /내 상품 조회/ }));
    expect(replaceMock).toHaveBeenCalledWith('/listing?tab=browse', { scroll: false });
  });

  it('헤더 우측의 URL 자동등록 버튼은 더 이상 존재하지 않는다', () => {
    render(<ListingDashboard />);
    expect(screen.queryByText(/URL 자동등록/)).not.toBeInTheDocument();
  });
});
