export async function generatePdf(element: HTMLElement): Promise<void> {
  const html2pdf = (await import('html2pdf.js')).default;

  const opts = {
    margin: 0,  // HTML 요소 자체가 정확히 210×297mm이므로 추가 마진 불필요
    filename: 'label.pdf',
    image: { type: 'jpeg' as const, quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm' as const, format: 'a4', orientation: 'portrait' as const },
  };

  await html2pdf().set(opts).from(element).save();
}

export function printLabel(_element: HTMLElement): void {
  window.print();
}
