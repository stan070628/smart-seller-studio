import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Step1SourceSelect from '@/components/listing/workflow/Step1SourceSelect';
import { useListingStore } from '@/store/useListingStore';

describe('Step1SourceSelect — URL 입력 전용', () => {
  it('URL 입력 필드와 자동 처리 시작 버튼만 노출된다', () => {
    render(<Step1SourceSelect />);
    expect(screen.getByPlaceholderText(/https?:\/\//)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /자동 처리 시작/ })).toBeInTheDocument();
    // 제거된 항목
    expect(screen.queryByText(/썸네일 만들기/)).not.toBeInTheDocument();
    expect(screen.queryByText(/이미지로 만들기/)).not.toBeInTheDocument();
    expect(screen.queryByText(/상품 기본 정보/)).not.toBeInTheDocument();
  });

  it('빈 URL이면 버튼이 비활성화된다', () => {
    render(<Step1SourceSelect />);
    const btn = screen.getByRole('button', { name: /자동 처리 시작/ });
    expect(btn).toBeDisabled();
  });

  it('http(s)가 아닌 URL이면 에러를 표시하고 다음 단계로 가지 않는다', () => {
    const goNextStep = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useListingStore.setState({ goNextStep } as any);
    render(<Step1SourceSelect />);
    const input = screen.getByPlaceholderText(/https?:\/\//);
    fireEvent.change(input, { target: { value: 'invalid' } });
    fireEvent.click(screen.getByRole('button', { name: /자동 처리 시작/ }));
    expect(screen.getByText(/올바른 URL/)).toBeInTheDocument();
    expect(goNextStep).not.toHaveBeenCalled();
  });
});
