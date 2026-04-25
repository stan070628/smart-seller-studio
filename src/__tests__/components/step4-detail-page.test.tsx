/**
 * step4-detail-page.test.tsx
 * Step4DetailPage — dangerouslySetInnerHTML XSS 방지 검증
 *
 * DOMPurify.sanitize가 XSS 페이로드를 제거함을 확인한다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ── DOMPurify mock: 실제 동작을 단순화해서 테스트 ─────────────────────────
vi.mock('dompurify', () => ({
  default: {
    sanitize: vi.fn((input: string) => {
      // 실제 DOMPurify와 동일한 핵심 동작 시뮬레이션: <script> 태그 제거
      return input
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');
    }),
  },
}));

import DOMPurify from 'dompurify';
import { Step4DetailPage } from '@/components/listing/auto-register/steps/Step4DetailPage';

const mockDOMPurifySanitize = DOMPurify.sanitize as ReturnType<typeof vi.fn>;

const onNext = vi.fn();
const onBack = vi.fn();

function renderStep4(html: string) {
  return render(
    <Step4DetailPage
      initialValue={{ detailHtml: html }}
      onNext={onNext}
      onBack={onBack}
    />,
  );
}

describe('Step4DetailPage — DOMPurify 적용 검증', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('렌더링 시 DOMPurify.sanitize가 HTML에 호출된다', () => {
    const html = '<p>상품 설명</p>';
    renderStep4(html);
    expect(mockDOMPurifySanitize).toHaveBeenCalledWith(html);
  });

  it('XSS 스크립트 태그가 포함된 HTML을 sanitize를 거쳐 렌더링한다', () => {
    const xssHtml = '<p>설명</p><script>alert("xss")</script>';
    renderStep4(xssHtml);
    // sanitize가 호출되었음을 확인 — 실제 XSS 제거는 DOMPurify 책임
    expect(mockDOMPurifySanitize).toHaveBeenCalledWith(xssHtml);
    // 렌더링된 결과에 script 태그가 없어야 함 (mock sanitize가 제거)
    const preview = document.querySelector('.border.border-gray-200.rounded-lg');
    expect(preview?.innerHTML).not.toContain('<script>');
  });

  it('onclick 핸들러가 포함된 HTML을 sanitize를 거쳐 렌더링한다', () => {
    const xssHtml = '<img src="x" onerror="alert(1)">';
    renderStep4(xssHtml);
    expect(mockDOMPurifySanitize).toHaveBeenCalledWith(xssHtml);
    const preview = document.querySelector('.border.border-gray-200.rounded-lg');
    expect(preview?.innerHTML).not.toContain('onerror=');
  });

  it('일반 HTML은 그대로 렌더링된다', () => {
    const safeHtml = '<p>안전한 상품 설명입니다.</p>';
    renderStep4(safeHtml);
    expect(screen.getByText('안전한 상품 설명입니다.')).toBeInTheDocument();
  });

  it('빈 HTML이면 안내 문구를 표시한다', () => {
    renderStep4('');
    expect(screen.getByText(/상세페이지 HTML이 없습니다/)).toBeInTheDocument();
  });
});
