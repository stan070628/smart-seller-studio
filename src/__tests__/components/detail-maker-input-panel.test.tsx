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
  url1688: '',
  setUrl1688: vi.fn(),
  specs1688: [],
  onToggleSpec: vi.fn(),
  isFetching1688: false,
  onFetch1688: vi.fn(),
  fetch1688Error: null,
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

describe('DetailMakerInputPanel — 1688 스펙 가져오기', () => {
  it('기본 상태에서 URL 입력 필드가 보이지 않는다', () => {
    render(<DetailMakerInputPanel {...baseProps} />);
    expect(screen.queryByPlaceholderText(/1688\.com/)).not.toBeInTheDocument();
  });

  it('헤더 클릭 시 URL 입력 필드가 나타난다', () => {
    render(<DetailMakerInputPanel {...baseProps} />);
    fireEvent.click(screen.getByText(/1688에서 스펙 가져오기/));
    expect(screen.getByPlaceholderText(/1688\.com/)).toBeInTheDocument();
  });

  it('가져오기 버튼 클릭 시 onFetch1688이 호출된다', () => {
    render(<DetailMakerInputPanel {...baseProps} />);
    fireEvent.click(screen.getByText(/1688에서 스펙 가져오기/));
    fireEvent.click(screen.getByRole('button', { name: /가져오기/ }));
    expect(baseProps.onFetch1688).toHaveBeenCalledTimes(1);
  });

  it('isFetching1688=true일 때 가져오기 버튼이 비활성화된다', () => {
    render(<DetailMakerInputPanel {...baseProps} isFetching1688={true} />);
    fireEvent.click(screen.getByText(/1688에서 스펙 가져오기/));
    expect(screen.getByRole('button', { name: /가져오기/ })).toBeDisabled();
  });

  it('specs1688가 있으면 체크박스 목록이 렌더된다', () => {
    const specs1688 = [
      { label: '소재', value: '면 100%', checked: true },
      { label: '색상', value: '블랙/화이트', checked: false },
    ];
    render(<DetailMakerInputPanel {...baseProps} specs1688={specs1688} />);
    fireEvent.click(screen.getByText(/1688에서 스펙 가져오기/));
    expect(screen.getByText('소재')).toBeInTheDocument();
    expect(screen.getByText('면 100%')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('체크박스 클릭 시 onToggleSpec(idx)이 호출된다', () => {
    const specs1688 = [
      { label: '소재', value: '면 100%', checked: true },
    ];
    render(<DetailMakerInputPanel {...baseProps} specs1688={specs1688} />);
    fireEvent.click(screen.getByText(/1688에서 스펙 가져오기/));
    fireEvent.click(screen.getByRole('checkbox'));
    expect(baseProps.onToggleSpec).toHaveBeenCalledWith(0);
  });

  it('fetch1688Error가 있으면 에러 메시지가 표시된다', () => {
    render(<DetailMakerInputPanel {...baseProps} fetch1688Error="캡차 감지됐습니다" />);
    fireEvent.click(screen.getByText(/1688에서 스펙 가져오기/));
    expect(screen.getByText(/캡차 감지됐습니다/)).toBeInTheDocument();
  });
});
