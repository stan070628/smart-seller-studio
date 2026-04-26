import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DescriptionSection from '@/components/listing/register-form/sections/DescriptionSection';
import { useListingStore } from '@/store/useListingStore';

describe('DescriptionSection', () => {
  it('description textarea가 노출된다', () => {
    render(<DescriptionSection />);
    expect(screen.getByPlaceholderText(/상세 설명/)).toBeInTheDocument();
  });

  it('입력 시 sharedDraft.description에 반영된다', () => {
    render(<DescriptionSection />);
    const ta = screen.getByPlaceholderText(/상세 설명/);
    fireEvent.change(ta, { target: { value: '<p>설명</p>' } });
    expect(useListingStore.getState().sharedDraft.description).toBe('<p>설명</p>');
  });
});
