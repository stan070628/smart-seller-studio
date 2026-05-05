import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockGetLabelTemplates, mockSaveLabelTemplate } = vi.hoisted(() => ({
  mockGetLabelTemplates: vi.fn(),
  mockSaveLabelTemplate: vi.fn(),
}));

vi.mock('@/lib/label/label-templates', () => ({
  getLabelTemplates: mockGetLabelTemplates,
  saveLabelTemplate: mockSaveLabelTemplate,
  deleteLabelTemplate: vi.fn(),
}));

import TemplatePicker from '@/components/label/TemplatePicker';
import type { QualityFields, LabelTemplate } from '@/lib/label/label-templates';

const mockFields: QualityFields = {
  productName: '세차타월', material: '극세사', size: '40×40cm',
  country: '중국', importer: '㈜테스트', address: '서울', phone: '02-0000', extra: '',
};

const mockTemplate: LabelTemplate = {
  id: 'tmpl-1', user_id: 'u1', name: '기본 템플릿',
  image_url: '', fields: mockFields, created_at: '2026-05-05T00:00:00Z',
};

describe('TemplatePicker', () => {
  beforeEach(() => {
    mockGetLabelTemplates.mockResolvedValue([mockTemplate]);
    mockSaveLabelTemplate.mockResolvedValue(mockTemplate);
  });

  it('마운트 시 템플릿 목록을 로드한다', async () => {
    render(
      <TemplatePicker
        currentImageUrl="" currentFields={mockFields}
        onLoad={vi.fn()} onImageLoad={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(mockGetLabelTemplates).toHaveBeenCalledTimes(1);
    });
  });

  it('"불러오기" 클릭 시 onLoad가 선택된 템플릿 fields로 호출된다', async () => {
    const onLoad = vi.fn();
    render(
      <TemplatePicker
        currentImageUrl="" currentFields={mockFields}
        onLoad={onLoad} onImageLoad={vi.fn()}
      />,
    );
    await waitFor(() => screen.getByRole('combobox'));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'tmpl-1' } });
    fireEvent.click(screen.getByRole('button', { name: /불러오기/ }));
    expect(onLoad).toHaveBeenCalledWith(mockFields);
  });
});
