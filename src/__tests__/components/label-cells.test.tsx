import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LabelTextCell from '@/components/label/LabelTextCell';
import LabelImageCell from '@/components/label/LabelImageCell';
import type { QualityFields } from '@/lib/label/label-templates';

const mockFields: QualityFields = {
  productName: '세차타월',
  material: '극세사 80%',
  size: '40×40cm',
  country: '중국',
  importer: '㈜ 테스트',
  address: '서울시 강남구',
  phone: '02-000-0000',
  extra: 'KC인증 B123-456',
};

describe('LabelTextCell', () => {
  it('품질표시 항목 8개를 모두 렌더한다', () => {
    render(<LabelTextCell fields={mockFields} />);
    expect(screen.getByText('세차타월')).toBeInTheDocument();
    expect(screen.getByText('극세사 80%')).toBeInTheDocument();
    expect(screen.getByText('40×40cm')).toBeInTheDocument();
    expect(screen.getByText('중국')).toBeInTheDocument();
    expect(screen.getByText('㈜ 테스트')).toBeInTheDocument();
    expect(screen.getByText('서울시 강남구')).toBeInTheDocument();
    expect(screen.getByText('02-000-0000')).toBeInTheDocument();
    expect(screen.getByText('KC인증 B123-456')).toBeInTheDocument();
  });

  it('extra가 비어있으면 해당 행을 렌더하지 않는다', () => {
    const fields = { ...mockFields, extra: '' };
    render(<LabelTextCell fields={fields} />);
    expect(screen.queryByText(/KC인증/)).not.toBeInTheDocument();
  });
});

describe('LabelImageCell', () => {
  it('imageUrl이 있으면 img 태그를 렌더한다', () => {
    render(<LabelImageCell imageUrl="https://example.com/logo.png" />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/logo.png');
  });

  it('imageUrl이 없으면 플레이스홀더 텍스트를 렌더한다', () => {
    render(<LabelImageCell imageUrl="" />);
    expect(screen.getByText('이미지 없음')).toBeInTheDocument();
  });
});
