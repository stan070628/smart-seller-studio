import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DeliverySection from '@/components/listing/register-form/sections/DeliverySection';

describe('DeliverySection', () => {
  it('배송비 유형/배송비/반품배송비/교환배송비 영역이 노출된다', () => {
    render(<DeliverySection />);
    expect(screen.getByText(/배송비 유형/)).toBeInTheDocument();
    // 배송비 label은 "배송비 (원)" 형태
    expect(screen.getByText('배송비 (원)')).toBeInTheDocument();
    expect(screen.getByText(/반품배송비/)).toBeInTheDocument();
    // 네이버 교환배송비
    expect(screen.getByText(/교환배송비/)).toBeInTheDocument();
  });
});
