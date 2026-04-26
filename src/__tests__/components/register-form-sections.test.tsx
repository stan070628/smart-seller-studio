import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RegisterFormSections from '@/components/listing/register-form';

describe('RegisterFormSections', () => {
  it('6개 섹션 헤더가 모두 노출된다', () => {
    render(<RegisterFormSections onSuccess={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('기본정보')).toBeInTheDocument();
    expect(screen.getByText('가격/재고')).toBeInTheDocument();
    expect(screen.getByText('이미지')).toBeInTheDocument();
    expect(screen.getByText('상세설명')).toBeInTheDocument();
    expect(screen.getByText('배송')).toBeInTheDocument();
    expect(screen.getByText(/검색어/)).toBeInTheDocument();
  });

  it('등록 정보 확인/취소 버튼이 노출된다', () => {
    render(<RegisterFormSections onSuccess={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: /등록 정보 확인/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /취소/ })).toBeInTheDocument();
  });
});
