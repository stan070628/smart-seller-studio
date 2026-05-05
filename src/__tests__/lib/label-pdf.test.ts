import { describe, it, expect, vi, beforeEach } from 'vitest';

// html2pdf.js 모킹
const mockSave = vi.fn().mockResolvedValue(undefined);
const mockFrom = vi.fn().mockReturnThis();
const mockSet = vi.fn().mockReturnThis();
const mockInstance = { set: mockSet, from: mockFrom, save: mockSave };
const mockHtml2pdf = vi.fn(() => mockInstance);

vi.mock('html2pdf.js', () => ({ default: mockHtml2pdf }));

import { generatePdf, printLabel } from '@/lib/label/label-pdf';

describe('generatePdf', () => {
  beforeEach(() => {
    mockHtml2pdf.mockClear();
    mockSet.mockClear();
    mockFrom.mockClear();
    mockSave.mockClear();
  });

  it('html2pdf를 올바른 옵션으로 호출한다', async () => {
    const el = document.createElement('div');
    await generatePdf(el);

    expect(mockHtml2pdf).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'label.pdf',
        jsPDF: expect.objectContaining({ unit: 'mm', format: 'a4' }),
        html2canvas: expect.objectContaining({ scale: 2, useCORS: true }),
      }),
    );
    expect(mockFrom).toHaveBeenCalledWith(el);
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('printLabel', () => {
  it('window.print()를 호출한다', () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    const el = document.createElement('div');
    printLabel(el);
    expect(printSpy).toHaveBeenCalledTimes(1);
    printSpy.mockRestore();
  });
});
