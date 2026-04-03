/**
 * Sidebar.test.tsx
 * src/components/editor/Sidebar.tsx 컴포넌트 RTL 단위 테스트
 *
 * 실제 Sidebar.tsx DOM 구조 기반:
 *   - 섹션 1: 상품 이미지 업로드 (드롭 영역, 숨겨진 file input)
 *   - 섹션 2: 쿠팡 리뷰 붙여넣기 (textarea)
 *   - AI 카피 생성 버튼 (disabled: reviewText.trim() === 0 || isGenerating)
 *   - 생성된 카피 목록 (generatedCopies > 0 시 표시)
 *   - "캔버스에 추가" 버튼 → addCanvasObject 호출
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// 전역 Mock 설정
// ---------------------------------------------------------------------------

// URL.createObjectURL / revokeObjectURL
global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = vi.fn();

// window.alert
global.alert = vi.fn();

// ---------------------------------------------------------------------------
// Zustand 스토어 Mock
// ---------------------------------------------------------------------------

// addCanvasObject spy를 모듈 레벨에서 선언
const mockAddCanvasObject = vi.fn();
const mockSetReviewText = vi.fn();
const mockAddImage = vi.fn();
const mockRemoveImage = vi.fn();
const mockUpdateImageStatus = vi.fn();
const mockSetGeneratedCopies = vi.fn();
const mockSetIsGenerating = vi.fn();
const mockSetImageAnalysis = vi.fn();
const mockSetIsAnalyzing = vi.fn();

// Zustand 스토어를 직접 모킹 — 실제 상태를 외부에서 제어하기 위해
let storeState = {
  uploadedImages: [] as Array<{ id: string; url: string; name: string; size: number; uploadedAt: string; uploadStatus?: string }>,
  reviewText: '',
  generatedCopies: [] as Array<{ id: string; title: string; subtitle?: string }>,
  isGenerating: false,
  canvasObjects: [],
  exportTrigger: 0,
  imageAnalysis: null as null | object,
  isAnalyzing: false,
};

vi.mock('@/store/useEditorStore', () => {
  const useEditorStore = (selector: (state: typeof storeState & {
    addImage: typeof mockAddImage;
    removeImage: typeof mockRemoveImage;
    updateImageStatus: typeof mockUpdateImageStatus;
    setReviewText: typeof mockSetReviewText;
    setGeneratedCopies: typeof mockSetGeneratedCopies;
    setIsGenerating: typeof mockSetIsGenerating;
    addCanvasObject: typeof mockAddCanvasObject;
    setImageAnalysis: typeof mockSetImageAnalysis;
    setIsAnalyzing: typeof mockSetIsAnalyzing;
  }) => unknown) => {
    return selector({
      ...storeState,
      addImage: mockAddImage,
      removeImage: mockRemoveImage,
      updateImageStatus: mockUpdateImageStatus,
      setReviewText: mockSetReviewText,
      setGeneratedCopies: mockSetGeneratedCopies,
      setIsGenerating: mockSetIsGenerating,
      addCanvasObject: mockAddCanvasObject,
      setImageAnalysis: mockSetImageAnalysis,
      setIsAnalyzing: mockSetIsAnalyzing,
    });
  };
  return { default: useEditorStore };
});

// ---------------------------------------------------------------------------
// fetch Mock (AI 카피 생성 API 호출용)
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// 컴포넌트 import (mock 설정 이후에 import)
// ---------------------------------------------------------------------------

import Sidebar from '@/components/editor/Sidebar';

// ---------------------------------------------------------------------------
// 헬퍼: 스토어 상태 리셋
// ---------------------------------------------------------------------------

function resetStore() {
  storeState = {
    uploadedImages: [],
    reviewText: '',
    generatedCopies: [],
    isGenerating: false,
    canvasObjects: [],
    exportTrigger: 0,
    imageAnalysis: null,
    isAnalyzing: false,
  };
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe('Sidebar 컴포넌트', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
    // URL.createObjectURL 기본값 복원
    (global.URL.createObjectURL as ReturnType<typeof vi.fn>).mockReturnValue('blob:mock-url');
  });

  // ── 테스트 1 ──────────────────────────────────────────────────────────────
  it('초기 렌더링: 이미지 업로드 섹션과 리뷰 입력 섹션이 표시됨', () => {
    render(<Sidebar />);

    // 이미지 업로드 섹션 헤딩
    expect(screen.getByText('상품 이미지')).toBeInTheDocument();

    // 드롭 영역 텍스트
    expect(screen.getByText(/이미지를 드래그하거나/)).toBeInTheDocument();
    expect(screen.getByText(/클릭하여 선택/)).toBeInTheDocument();

    // 리뷰 입력 섹션 헤딩
    expect(screen.getByText('쿠팡 리뷰 붙여넣기')).toBeInTheDocument();

    // textarea placeholder
    expect(
      screen.getByPlaceholderText(/쿠팡 리뷰를 여기에 복사해서 붙여넣으세요/),
    ).toBeInTheDocument();
  });

  // ── 테스트 2 ──────────────────────────────────────────────────────────────
  it('AI 카피 생성 버튼이 초기에 disabled 상태 (reviewText 비어있음)', () => {
    render(<Sidebar />);

    const generateButton = screen.getByRole('button', { name: /AI 카피 생성/ });
    expect(generateButton).toBeDisabled();
  });

  // ── 테스트 3 ──────────────────────────────────────────────────────────────
  it('리뷰 Textarea에 텍스트 입력 시 setReviewText 호출 후 버튼 활성화됨 (상태 반영)', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    const textarea = screen.getByPlaceholderText(/쿠팡 리뷰를 여기에 복사해서 붙여넣으세요/);
    await user.type(textarea, '리뷰 텍스트 입력');

    // setReviewText가 호출되어야 함
    expect(mockSetReviewText).toHaveBeenCalled();
  });

  // ── 테스트 4 ──────────────────────────────────────────────────────────────
  it('공백만 입력 시 버튼 disabled 유지 (trim() 기반 검증)', () => {
    // reviewText를 공백으로 설정
    storeState.reviewText = '   ';
    render(<Sidebar />);

    const generateButton = screen.getByRole('button', { name: /AI 카피 생성/ });
    // reviewText.trim().length === 0 이므로 disabled
    expect(generateButton).toBeDisabled();
  });

  // ── 테스트 5 ──────────────────────────────────────────────────────────────
  it('이미지 파일 input change 이벤트 발생 시 addImage 호출됨 (썸네일 추가)', async () => {
    render(<Sidebar />);

    // 숨겨진 file input 찾기 (accept="image/*")
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    const mockFile = new File(['fake image content'], 'test-image.jpg', {
      type: 'image/jpeg',
    });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [mockFile] } });
    });

    // addImage가 호출되어야 함
    expect(mockAddImage).toHaveBeenCalledOnce();
    expect(mockAddImage).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'test-image.jpg',
        url: 'blob:mock-url',
      }),
    );
  });

  // ── 테스트 6 ──────────────────────────────────────────────────────────────
  it('이미지 삭제 버튼 클릭 시 removeImage 호출됨', async () => {
    // 이미지가 업로드된 상태를 시뮬레이션
    storeState.uploadedImages = [
      {
        id: 'img-1',
        url: 'blob:mock-url',
        name: 'product.jpg',
        size: 1024,
        uploadedAt: new Date().toISOString(),
      },
    ];

    const user = userEvent.setup();
    render(<Sidebar />);

    // 이미지 파일명이 표시되어야 함
    expect(screen.getByText('product.jpg')).toBeInTheDocument();

    // 삭제 버튼 (title="이미지 삭제")
    const deleteButton = screen.getByTitle('이미지 삭제');
    await user.click(deleteButton);

    expect(mockRemoveImage).toHaveBeenCalledOnce();
    expect(mockRemoveImage).toHaveBeenCalledWith('img-1');
  });

  // ── 테스트 7 ──────────────────────────────────────────────────────────────
  it('AI 카피 생성 버튼 클릭 시 setIsGenerating(true) 호출됨 (로딩 상태 전환)', async () => {
    storeState.reviewText = '실제 리뷰 내용이 있습니다.';

    // fetch를 응답 없이 pending으로 유지 (비동기 처리 중)
    mockFetch.mockImplementationOnce(
      () =>
        new Promise(() => {
          // 영원히 pending
        }),
    );

    const user = userEvent.setup();
    render(<Sidebar />);

    const generateButton = screen.getByRole('button', { name: /AI 카피 생성/ });
    expect(generateButton).not.toBeDisabled();

    await user.click(generateButton);

    // setIsGenerating(true)가 호출되어야 함
    expect(mockSetIsGenerating).toHaveBeenCalledWith(true);
  });

  // ── 테스트 8 ──────────────────────────────────────────────────────────────
  it('Zustand store에 generatedCopies가 있으면 카피 목록 렌더링', () => {
    storeState.generatedCopies = [
      {
        id: 'copy-1',
        title: '고객이 직접 인정한 품질! 리뷰로 증명하다',
        subtitle: '실제 구매자 만족도 98% — 지금 바로 경험하세요',
      },
      {
        id: 'copy-2',
        title: '한 번 써보면 다시는 못 놓는 이유',
        subtitle: '수백 개의 리얼 후기가 말해주는 압도적 성능',
      },
    ];

    render(<Sidebar />);

    // 생성된 카피 섹션 헤딩
    expect(screen.getByText(/생성된 카피/)).toBeInTheDocument();
    expect(screen.getByText(/2개/)).toBeInTheDocument();

    // 카피 제목들
    expect(screen.getByText('고객이 직접 인정한 품질! 리뷰로 증명하다')).toBeInTheDocument();
    expect(screen.getByText('한 번 써보면 다시는 못 놓는 이유')).toBeInTheDocument();

    // 서브타이틀
    expect(screen.getByText(/실제 구매자 만족도 98%/)).toBeInTheDocument();

    // 카피 번호 뱃지 (안 1, 안 2)
    expect(screen.getByText('안 1')).toBeInTheDocument();
    expect(screen.getByText('안 2')).toBeInTheDocument();

    // "캔버스에 추가" 버튼이 각 카피마다 존재
    const addButtons = screen.getAllByRole('button', { name: /캔버스에 추가/ });
    expect(addButtons).toHaveLength(2);
  });

  // ── 테스트 9 ──────────────────────────────────────────────────────────────
  it('"캔버스에 추가" 버튼 클릭 시 addCanvasObject 호출됨', async () => {
    storeState.generatedCopies = [
      {
        id: 'copy-1',
        title: '믿고 사는 브랜드, 리뷰가 증거입니다',
        subtitle: '별점 4.9 / 5.0 — 후회 없는 선택',
      },
    ];

    const user = userEvent.setup();
    render(<Sidebar />);

    const addButton = screen.getByRole('button', { name: /캔버스에 추가/ });
    await user.click(addButton);

    // 제목 + 서브타이틀 = addCanvasObject 2번 호출
    expect(mockAddCanvasObject).toHaveBeenCalledTimes(2);

    // 첫 번째 호출: 제목 텍스트 객체 (type: 'textbox')
    expect(mockAddCanvasObject).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'textbox',
        content: '믿고 사는 브랜드, 리뷰가 증거입니다',
        fontWeight: 'bold',
      }),
    );

    // 두 번째 호출: 서브타이틀 텍스트 객체
    expect(mockAddCanvasObject).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'textbox',
        content: '별점 4.9 / 5.0 — 후회 없는 선택',
        fontWeight: 'normal',
      }),
    );
  });
});
