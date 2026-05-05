import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QualityFieldsForm from '@/components/label/QualityFieldsForm';
import type { QualityFields } from '@/lib/label/label-templates';

const emptyFields: QualityFields = {
  productName: '',
  material: '',
  size: '',
  country: '',
  importer: '',
  address: '',
  phone: '',
  extra: '',
};

describe('QualityFieldsForm', () => {
  it('8개 입력 필드를 렌더한다', () => {
    render(<QualityFieldsForm fields={emptyFields} onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText(/품명/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/소재/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/크기/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/제조국/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/수입원/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/주소/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/전화번호/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/기타/)).toBeInTheDocument();
  });

  it('입력 변경 시 onChange를 올바른 key로 호출한다', () => {
    const onChange = vi.fn();
    render(<QualityFieldsForm fields={emptyFields} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/품명/), { target: { value: '세차타월' } });
    expect(onChange).toHaveBeenCalledWith({ ...emptyFields, productName: '세차타월' });
  });
});
