import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import InfoShotGuide from '@/components/listing/InfoShotGuide';

describe('InfoShotGuide', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('상품명이 비면 아무것도 그리지 않는다', () => {
    const { container } = render(<InfoShotGuide productName="" />);
    expect(container).toBeEmptyDOMElement();
    // 공백만 있어도 마찬가지
    const { container: c2 } = render(<InfoShotGuide productName="   " />);
    expect(c2).toBeEmptyDOMElement();
  });

  it('의류면 장수와 필수 개수를 헤더에 보여준다', () => {
    render(<InfoShotGuide productName="남성 반바지" />);
    // 케어라벨·실측 2개가 필수
    expect(screen.getByText(/필수 2/)).toBeTruthy();
    expect(screen.getByText(/정보 사진 5장/)).toBeTruthy();
  });

  it('접힌 채로 시작하고 펼치면 항목이 보인다', () => {
    render(<InfoShotGuide productName="남성 반바지" />);
    expect(screen.queryByText(/케어라벨/)).toBeNull();

    fireEvent.click(screen.getByText(/정보 사진/));
    expect(screen.getByText(/케어라벨 \(품질표시 라벨\)/)).toBeTruthy();
    // 어디서 찾는지와 무엇을 얻는지가 함께 보여야 한다
    expect(screen.getByText(/왼쪽 옆선 밑단/)).toBeTruthy();
    expect(screen.getByText(/소재 혼용률/)).toBeTruthy();
  });

  it('상품명이 바뀌면 안내 항목도 바뀐다', () => {
    const { rerender } = render(<InfoShotGuide productName="남성 반바지" />);
    fireEvent.click(screen.getByText(/정보 사진/));
    expect(screen.getByText(/케어라벨 \(품질표시 라벨\)/)).toBeTruthy();

    rerender(<InfoShotGuide productName="유기농 견과류 간식" />);
    expect(screen.queryByText(/케어라벨 \(품질표시 라벨\)/)).toBeNull();
    expect(screen.getByText(/유통기한 각인/)).toBeTruthy();
  });

  it('체크리스트를 클립보드에 복사한다', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<InfoShotGuide productName="남성 반바지" />);
    fireEvent.click(screen.getByText(/정보 사진/));
    fireEvent.click(screen.getByText(/체크리스트 복사/));

    expect(writeText).toHaveBeenCalledOnce();
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain('케어라벨');
    expect(text).toContain('⭐ 필수');
  });

  it('클립보드 권한이 없어도 화면이 깨지지 않는다', () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(<InfoShotGuide productName="남성 반바지" />);
    fireEvent.click(screen.getByText(/정보 사진/));
    expect(() => fireEvent.click(screen.getByText(/체크리스트 복사/))).not.toThrow();
    // 목록은 그대로 보인다
    expect(screen.getByText(/케어라벨 \(품질표시 라벨\)/)).toBeTruthy();
  });
});
