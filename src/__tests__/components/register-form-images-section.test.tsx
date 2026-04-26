import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ImagesSection from '@/components/listing/register-form/sections/ImagesSection';

describe('ImagesSection', () => {
  it('썸네일/상세이미지 입력 영역이 모두 노출된다', () => {
    render(<ImagesSection />);
    expect(screen.getByText(/상품 이미지/)).toBeInTheDocument();
    // "상세페이지 이미지"는 label과 안내 문구 두 곳에 등장하므로 getAllByText 사용
    expect(screen.getAllByText(/상세페이지 이미지/).length).toBeGreaterThanOrEqual(1);
  });
});
