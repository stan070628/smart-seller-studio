import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DetailMakerInputPanel from '@/components/listing/detail-maker/DetailMakerInputPanel';

const baseProps = {
  productName: '',
  setProductName: vi.fn(),
  brandName: '',
  setBrandName: vi.fn(),
  category: 'basic' as const,
  setCategory: vi.fn(),
  uploadedUrls: [],
  uploading: false,
  isGenerating: false,
  error: null,
  onUploadFiles: vi.fn(),
  onRemoveImage: vi.fn(),
  onGenerate: vi.fn(),
  suggestedMoodIds: [],
  selectedMoodId: null,
  isSuggestingMood: false,
  onSelectMood: vi.fn(),
  thumbnailRefUrls: [],
  isGeneratingThumbnail: false,
  thumbnailError: null,
  onGenerateThumbnail: vi.fn(),
  thumbnailExtraUrls: [],
  uploadingThumbnailRef: false,
  onUploadThumbnailRef: vi.fn(),
  onRemoveThumbnailRef: vi.fn(),
  referenceText: '',
  setReferenceText: vi.fn(),
};

describe('DetailMakerInputPanel — 탭', () => {
  it('초기에 상세페이지 탭이 활성화되어 상품명 입력이 보인다', () => {
    render(<DetailMakerInputPanel {...baseProps} />);
    expect(screen.getByPlaceholderText(/나이키 에어맥스/)).toBeInTheDocument();
  });

  it('썸네일 탭 클릭 시 AI 썸네일 생성 버튼이 보인다', () => {
    render(<DetailMakerInputPanel {...baseProps} thumbnailRefUrls={['https://x/a.jpg']} />);
    fireEvent.click(screen.getByRole('button', { name: '썸네일' }));
    expect(screen.getByRole('button', { name: /AI 썸네일 생성/ })).toBeInTheDocument();
  });

  it('상세페이지 탭으로 돌아오면 상품명 입력이 다시 보인다', () => {
    render(<DetailMakerInputPanel {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: '썸네일' }));
    fireEvent.click(screen.getByRole('button', { name: '상세페이지' }));
    expect(screen.getByPlaceholderText(/나이키 에어맥스/)).toBeInTheDocument();
  });
});

describe('DetailMakerInputPanel — 참고 텍스트', () => {
  it('초기에 "참고 텍스트 추가" 버튼이 보이고 textarea는 숨겨져 있다', () => {
    render(<DetailMakerInputPanel {...baseProps} />);
    expect(screen.getByRole('button', { name: /참고 텍스트 추가/ })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/경쟁사 상세페이지/)).not.toBeInTheDocument();
  });

  it('"+ 참고 텍스트 추가" 클릭 시 textarea가 나타난다', () => {
    render(<DetailMakerInputPanel {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /참고 텍스트 추가/ }));
    expect(screen.getByPlaceholderText(/경쟁사 상세페이지/)).toBeInTheDocument();
  });

  it('textarea에 입력하면 setReferenceText가 호출된다', () => {
    const setReferenceText = vi.fn();
    render(<DetailMakerInputPanel {...baseProps} setReferenceText={setReferenceText} />);
    fireEvent.click(screen.getByRole('button', { name: /참고 텍스트 추가/ }));
    fireEvent.change(screen.getByPlaceholderText(/경쟁사 상세페이지/), {
      target: { value: '좋은 텍스트' },
    });
    expect(setReferenceText).toHaveBeenCalledWith('좋은 텍스트');
  });

  it('▲ 클릭 시 textarea가 숨겨진다 (내용 초기화 없음 — setReferenceText 호출 안함)', () => {
    const setReferenceText = vi.fn();
    render(
      <DetailMakerInputPanel
        {...baseProps}
        referenceText="기존 텍스트"
        setReferenceText={setReferenceText}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /참고 텍스트 추가/ }));
    fireEvent.click(screen.getByRole('button', { name: /참고 텍스트 ▲/ }));
    expect(screen.queryByPlaceholderText(/경쟁사 상세페이지/)).not.toBeInTheDocument();
    expect(setReferenceText).not.toHaveBeenCalledWith('');
  });

  it('× 클릭 시 setReferenceText("")가 호출되고 textarea가 숨겨진다', () => {
    const setReferenceText = vi.fn();
    render(
      <DetailMakerInputPanel
        {...baseProps}
        referenceText="기존 텍스트"
        setReferenceText={setReferenceText}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /참고 텍스트 추가/ }));
    fireEvent.click(screen.getByRole('button', { name: '참고 텍스트 초기화' }));
    expect(setReferenceText).toHaveBeenCalledWith('');
    expect(screen.queryByPlaceholderText(/경쟁사 상세페이지/)).not.toBeInTheDocument();
  });
});
