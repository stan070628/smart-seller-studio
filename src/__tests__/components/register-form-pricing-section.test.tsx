import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PricingSection from '@/components/listing/register-form/sections/PricingSection';
import { useListingStore } from '@/store/useListingStore';

describe('PricingSection', () => {
  it('공통 판매가/정상가/재고/채널별 판매가 입력이 렌더된다', () => {
    render(<PricingSection />);
    // "공통 판매가" 텍스트는 라벨과 설명 span 두 곳에 존재하므로 getAllByText 사용
    expect(screen.getAllByText(/공통 판매가/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/정상가/)).toBeInTheDocument();
    expect(screen.getByText(/재고/)).toBeInTheDocument();
    // 쿠팡/네이버 채널별 판매가는 DOM 구조상 span이 섞여 있으므로 유연하게 검증
    expect(screen.getAllByText('판매가').length).toBeGreaterThanOrEqual(2);
  });

  it('판매가 입력 시 sharedDraft에 반영된다', () => {
    render(<PricingSection />);
    // placeholder="채널 공통 가격" 입력 필드
    const input = screen.getByPlaceholderText(/채널 공통 가격/);
    fireEvent.change(input, { target: { value: '12345' } });
    expect(useListingStore.getState().sharedDraft.salePrice).toBe('12345');
  });
});
