import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import KeywordsSection from '@/components/listing/register-form/sections/KeywordsSection';
import { useListingStore } from '@/store/useListingStore';

describe('KeywordsSection', () => {
  it('태그 입력 필드와 추가 버튼이 렌더된다', () => {
    render(<KeywordsSection />);
    expect(screen.getByRole('button', { name: '추가' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/등산가방/)).toBeInTheDocument();
  });

  it('Enter 키로 태그를 추가하면 store에 반영된다', () => {
    useListingStore.getState().resetSharedDraft();
    render(<KeywordsSection />);
    const input = screen.getByPlaceholderText(/등산가방/);
    fireEvent.change(input, { target: { value: '테스트태그' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useListingStore.getState().sharedDraft.tags).toContain('테스트태그');
  });
});
