/**
 * Sidebar.test.tsx
 * src/components/editor/Sidebar.tsx 컴포넌트 RTL 단위 테스트
 *
 * 실제 Sidebar.tsx DOM 구조 기반:
 *   - 섹션 0: 템플릿 스타일 테마 선택 (뷰티제품 / 기능 강조 / 정품 강조)
 *   - 섹션 1: 상품 이미지 업로드 (드롭 영역, 숨겨진 file input)
 *   - 섹션 1.5: 상품 정보 자동 추출 (URL 입력, 스크린샷)
 *   - 섹션 2: 제품 특징 입력 (textarea)
 *   - 섹션 3: 쿠팡 리뷰 붙여넣기 (textarea)
 *   - AI 카피 생성 버튼 (disabled: reviewText.trim() === 0 || isGenerating)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { THEMES } from '@/lib/themes';
import type { Theme } from '@/lib/themes';

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

const mockSetReviewText = vi.fn();
const mockAddImage = vi.fn();
const mockRemoveImage = vi.fn();
const mockUpdateImageStatus = vi.fn();
const mockSetIsGenerating = vi.fn();
const mockSetImageAnalysis = vi.fn();
const mockSetIsAnalyzing = vi.fn();
const mockSetProductDescription = vi.fn();
const mockSetFrames = vi.fn();
const mockSetTheme = vi.fn();
const mockAddCustomFrame = vi.fn();
const mockSetProductExtract = vi.fn();
const mockSetIsExtracting = vi.fn();

// Zustand 스토어를 직접 모킹 — 실제 상태를 외부에서 제어하기 위해
let storeState: {
  uploadedImages: Array<{ id: string; url: string; name: string; size: number; uploadedAt: string; uploadStatus?: string }>;
  reviewText: string;
  isGenerating: boolean;
  imageAnalysis: null | object;
  isAnalyzing: boolean;
  productDescription: string;
  productExtract: null | object;
  isExtracting: boolean;
  theme: Theme;
} = {
  uploadedImages: [],
  reviewText: '',
  isGenerating: false,
  imageAnalysis: null,
  isAnalyzing: false,
  productDescription: '',
  productExtract: null,
  isExtracting: false,
  theme: THEMES.functional,
};

vi.mock('@/store/useEditorStore', () => {
  const useEditorStore = (selector: (state: typeof storeState & {
    addImage: typeof mockAddImage;
    removeImage: typeof mockRemoveImage;
    updateImageStatus: typeof mockUpdateImageStatus;
    setReviewText: typeof mockSetReviewText;
    setIsGenerating: typeof mockSetIsGenerating;
    setImageAnalysis: typeof mockSetImageAnalysis;
    setIsAnalyzing: typeof mockSetIsAnalyzing;
    setProductDescription: typeof mockSetProductDescription;
    setFrames: typeof mockSetFrames;
    setTheme: typeof mockSetTheme;
    addCustomFrame: typeof mockAddCustomFrame;
    setProductExtract: typeof mockSetProductExtract;
    setIsExtracting: typeof mockSetIsExtracting;
  }) => unknown) => {
    return selector({
      ...storeState,
      addImage: mockAddImage,
      removeImage: mockRemoveImage,
      updateImageStatus: mockUpdateImageStatus,
      setReviewText: mockSetReviewText,
      setIsGenerating: mockSetIsGenerating,
      setImageAnalysis: mockSetImageAnalysis,
      setIsAnalyzing: mockSetIsAnalyzing,
      setProductDescription: mockSetProductDescription,
      setFrames: mockSetFrames,
      setTheme: mockSetTheme,
      addCustomFrame: mockAddCustomFrame,
      setProductExtract: mockSetProductExtract,
      setIsExtracting: mockSetIsExtracting,
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
    isGenerating: false,
    imageAnalysis: null,
    isAnalyzing: false,
    productDescription: '',
    productExtract: null,
    isExtracting: false,
    theme: THEMES.functional,
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

    // 실제 버튼 텍스트: "AI 카피 생성 (13 프레임)"
    const generateButton = screen.getByRole('button', { name: /AI 카피 생성/ });
    expect(generateButton).toBeDisabled();
  });

  // ── 테스트 3 ──────────────────────────────────────────────────────────────
  it('리뷰 Textarea에 텍스트 입력 시 setReviewText 호출됨', async () => {
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
    // Sidebar에 두 개의 file input이 있음 (이미지 업로드용, 스크린샷 추출용)
    // 첫 번째가 이미지 업로드용
    const fileInputs = document.querySelectorAll('input[type="file"]');
    expect(fileInputs.length).toBeGreaterThanOrEqual(1);
    const fileInput = fileInputs[0] as HTMLInputElement;

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
  it('테마 선택 버튼 클릭 시 setTheme 호출됨', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    // 뷰티제품 테마 버튼 클릭
    const beautyButton = screen.getByRole('button', { name: /뷰티제품/ });
    await user.click(beautyButton);

    expect(mockSetTheme).toHaveBeenCalledWith('beauty');
  });

  // ── 테스트 9 ──────────────────────────────────────────────────────────────
  it('현재 테마(functional)가 선택된 상태로 표시됨 ("선택됨" 텍스트)', () => {
    // storeState.theme = THEMES.functional (기본값)
    render(<Sidebar />);

    // "선택됨" 뱃지가 1개여야 함
    const selectedBadges = screen.getAllByText('선택됨');
    expect(selectedBadges).toHaveLength(1);

    // functional 테마 버튼에 선택됨 표시
    const functionalButton = screen.getByRole('button', { name: /기능 강조/ });
    expect(functionalButton).toHaveTextContent('선택됨');
  });

  // ── 테스트 10 ──────────────────────────────────────────────────────────────
  it('커스텀 템플릿 - 3컬럼 제품 비교 버튼 클릭 시 addCustomFrame 호출됨', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    const customFrameButton = screen.getByRole('button', { name: /3컬럼 제품 비교/ });
    await user.click(customFrameButton);

    expect(mockAddCustomFrame).toHaveBeenCalledWith('custom_3col');
  });

  // ── 테스트 11 ──────────────────────────────────────────────────────────────
  it('isGenerating이 true일 때 AI 카피 생성 버튼이 disabled 상태', () => {
    storeState.reviewText = '리뷰 내용';
    storeState.isGenerating = true;
    render(<Sidebar />);

    // isGenerating이 true이면 버튼이 disabled
    const button = screen.getByRole('button', { name: /AI 카피 생성|이미지 분석 중|카피 생성 중/ });
    expect(button).toBeDisabled();
  });
});
