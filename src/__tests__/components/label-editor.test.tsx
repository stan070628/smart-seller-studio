import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const { mockGetLabelTemplates } = vi.hoisted(() => ({
  mockGetLabelTemplates: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/label/label-templates', () => ({
  getLabelTemplates: mockGetLabelTemplates,
  saveLabelTemplate: vi.fn(),
  deleteLabelTemplate: vi.fn(),
}));

vi.mock('@/lib/label/label-pdf', () => ({
  generatePdf: vi.fn().mockResolvedValue(undefined),
  printLabel: vi.fn(),
}));

import LabelEditor from '@/components/label/LabelEditor';

describe('LabelEditor', () => {
  it('"PDF 저장"과 "바로 인쇄" 버튼을 렌더한다', () => {
    render(<LabelEditor />);
    expect(screen.getByRole('button', { name: /PDF 저장/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /바로 인쇄/ })).toBeInTheDocument();
  });

  it('품명 입력 필드가 렌더된다', () => {
    render(<LabelEditor />);
    expect(screen.getByPlaceholderText(/품명/)).toBeInTheDocument();
  });
});
