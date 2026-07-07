import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { confirmDialog, ConfirmHost } from '@/components/ui/confirm';

describe('confirmDialog', () => {
  it('확인 클릭 시 true로 resolve된다', async () => {
    render(<ConfirmHost />);
    const p = confirmDialog('삭제할까요?');
    expect(await screen.findByText('삭제할까요?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    expect(await p).toBe(true);
  });

  it('취소 클릭 시 false로 resolve되고 닫힌다', async () => {
    render(<ConfirmHost />);
    const p = confirmDialog('지울까요?');
    expect(await screen.findByText('지울까요?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(await p).toBe(false);
    expect(screen.queryByText('지울까요?')).not.toBeInTheDocument();
  });
});
