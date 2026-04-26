import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BasicInfoSection from '@/components/listing/register-form/sections/BasicInfoSection';

describe('BasicInfoSection', () => {
  it('상품명 입력과 카테고리 선택 영역이 렌더된다', () => {
    render(<BasicInfoSection />);
    // 상품명 입력 필드
    expect(screen.getByPlaceholderText(/상품명/)).toBeInTheDocument();
    // 쿠팡/네이버 배지 + "카테고리" 텍스트는 별개 span으로 분리되므로
    // 배지 텍스트와 "카테고리" 텍스트 노드를 각각 확인
    expect(screen.getByText('쿠팡')).toBeInTheDocument();
    expect(screen.getByText('네이버')).toBeInTheDocument();
    // getAllByText로 "카테고리" 텍스트 노드가 2개 존재하는지 확인
    const categoryLabels = screen.getAllByText('카테고리');
    expect(categoryLabels).toHaveLength(2);
  });
});
