import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LabelPreview from '@/components/label/LabelPreview';
import type { QualityFields } from '@/lib/label/label-templates';

const mockFields: QualityFields = {
  productName: '세차타월',
  material: '극세사 80%',
  size: '40×40cm',
  country: '중국',
  importer: '㈜ 테스트',
  address: '서울시 강남구',
  phone: '02-000-0000',
  extra: '',
};

describe('LabelPreview', () => {
  it('id="label-preview" 요소를 렌더한다 (인쇄/PDF 대상)', () => {
    const { container } = render(
      <LabelPreview imageUrl="" fields={mockFields} />,
    );
    expect(container.querySelector('#label-preview')).not.toBeNull();
  });

  it('이미지 칸 3개와 텍스트 칸 3개를 렌더한다', () => {
    render(<LabelPreview imageUrl="" fields={mockFields} />);
    expect(screen.getAllByText('세차타월')).toHaveLength(3);
    expect(screen.getAllByText('이미지 없음')).toHaveLength(3);
  });

  it('imageUrl이 있으면 img가 3개 렌더된다', () => {
    render(<LabelPreview imageUrl="https://example.com/logo.png" fields={mockFields} />);
    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(3);
    images.forEach((img) => {
      expect(img).toHaveAttribute('src', 'https://example.com/logo.png');
    });
  });
});
