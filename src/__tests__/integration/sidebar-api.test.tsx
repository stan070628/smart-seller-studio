/**
 * sidebar-api.test.tsx
 * Sidebar 컴포넌트 통합 테스트
 *
 * MSW로 실제 API 호출을 가로채 검증한다.
 * 테스트 케이스:
 *   1. 리뷰 입력 → AI 카피 버튼 클릭 → MSW 응답 → 카피 3개 표시
 *   2. AI API 500 에러 시 → window.alert 호출됨
 *   3. 네트워크 오류(fetch 실패) 시 → window.alert 호출됨
 *   4. 버튼 클릭 중(isGenerating) 재클릭 방지 - 버튼 disabled 확인
 *   5. 빈 리뷰(공백만) 입력 시 API 호출 안 됨
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';

// ---------------------------------------------------------------------------
// 전역 Mock
// ---------------------------------------------------------------------------
global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = vi.fn();

const alertMock = vi.fn();
global.alert = alertMock;

// ---------------------------------------------------------------------------
// Zustand 스토어: 실제 스토어를 사용하되 테스트 간 격리를 위해 초기화
// ---------------------------------------------------------------------------
import useEditorStore from '@/store/useEditorStore';
import Sidebar from '@/components/editor/Sidebar';

// ---------------------------------------------------------------------------
// 헬퍼: 스토어 초기화
// ---------------------------------------------------------------------------
function resetStore() {
  useEditorStore.setState({
    uploadedImages: [],
    reviewText: '',
    generatedCopies: [],
    canvasObjects: [],
    isGenerating: false,
    exportTrigger: 0,
    imageAnalysis: null,
    isAnalyzing: false,
  });
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------
describe('Sidebar 통합 테스트 (MSW)', () => {
  beforeEach(() => {
    resetStore();
    alertMock.mockClear();
  });

  // ── 테스트 1 ──────────────────────────────────────────────────────────────
  it('리뷰 입력 후 AI 카피 버튼 클릭 시 MSW 응답으로 카피 3개가 표시된다', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    // 리뷰 textarea에 텍스트 입력
    const textarea = screen.getByPlaceholderText(/쿠팡 리뷰를 여기에 복사해서 붙여넣으세요/);
    await user.type(textarea, '정말 좋은 제품입니다. 배송도 빠르고 품질도 최고에요.');

    // AI 카피 생성 버튼이 활성화되어야 함
    const generateButton = screen.getByRole('button', { name: /AI 카피 생성/ });
    expect(generateButton).not.toBeDisabled();

    // 버튼 클릭 → MSW가 /api/ai/generate-copy 응답
    await user.click(generateButton);

    // 카피 3개가 렌더링될 때까지 대기
    await waitFor(() => {
      expect(screen.getByText(/생성된 카피/)).toBeInTheDocument();
    });

    // handlers.ts의 응답: titles 배열 3개
    expect(
      screen.getByText('강풍 자동개폐 카라비너 우산 방수 경량 안전버튼 남녀공용'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('역풍 방지 자동 우산 카라비너 걸이 자동개폐 경량 방수'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('자동 개폐 우산 강풍 카라비너 휴대 경량 방수 안전버튼'),
    ).toBeInTheDocument();

    // "3개" 카운트 표시
    expect(screen.getByText(/3개/)).toBeInTheDocument();
  });

  // ── 테스트 2 ──────────────────────────────────────────────────────────────
  it('AI API가 500 에러를 반환하면 window.alert가 호출된다', async () => {
    // 이 테스트에서만 500 에러 응답으로 오버라이드
    server.use(
      http.post('/api/ai/generate-copy', () => {
        return HttpResponse.json(
          { success: false, error: 'Internal Server Error' },
          { status: 500 },
        );
      }),
    );

    const user = userEvent.setup();
    render(<Sidebar />);

    const textarea = screen.getByPlaceholderText(/쿠팡 리뷰를 여기에 복사해서 붙여넣으세요/);
    await user.type(textarea, '테스트 리뷰 내용입니다.');

    const generateButton = screen.getByRole('button', { name: /AI 카피 생성/ });
    await user.click(generateButton);

    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith('카피 생성에 실패했습니다. 다시 시도해주세요.');
    });

    // 카피 목록이 표시되지 않아야 함
    expect(screen.queryByText(/생성된 카피/)).not.toBeInTheDocument();
  });

  // ── 테스트 3 ──────────────────────────────────────────────────────────────
  it('네트워크 오류(fetch 실패) 시 window.alert가 호출된다', async () => {
    // 네트워크 오류 시뮬레이션: MSW로 연결 오류 반환
    server.use(
      http.post('/api/ai/generate-copy', () => {
        return HttpResponse.error();
      }),
    );

    const user = userEvent.setup();
    render(<Sidebar />);

    const textarea = screen.getByPlaceholderText(/쿠팡 리뷰를 여기에 복사해서 붙여넣으세요/);
    await user.type(textarea, '테스트 리뷰 내용입니다.');

    const generateButton = screen.getByRole('button', { name: /AI 카피 생성/ });
    await user.click(generateButton);

    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith('카피 생성에 실패했습니다. 다시 시도해주세요.');
    });
  });

  // ── 테스트 4 ──────────────────────────────────────────────────────────────
  it('isGenerating이 true일 때 버튼이 disabled 상태가 된다 (재클릭 방지)', async () => {
    // 응답을 지연시켜 isGenerating=true 상태를 유지
    server.use(
      http.post('/api/ai/generate-copy', async () => {
        // 응답을 영원히 보류하여 pending 상태 유지
        await new Promise<void>(() => {
          // never resolves
        });
        return HttpResponse.json({});
      }),
    );

    const user = userEvent.setup();
    render(<Sidebar />);

    const textarea = screen.getByPlaceholderText(/쿠팡 리뷰를 여기에 복사해서 붙여넣으세요/);
    await user.type(textarea, '테스트 리뷰 내용입니다.');

    const generateButton = screen.getByRole('button', { name: /AI 카피 생성/ });
    expect(generateButton).not.toBeDisabled();

    // 첫 번째 클릭 → isGenerating = true
    await act(async () => {
      await user.click(generateButton);
    });

    // 로딩 중에는 버튼이 disabled
    await waitFor(() => {
      // 로딩 중 버튼 텍스트로 변경됨
      expect(screen.getByText(/AI 분석 중/)).toBeInTheDocument();
    });

    // isGenerating 상태에서 버튼 disabled 확인 (로딩 버튼 포함 영역)
    const loadingArea = screen.getByText(/AI 분석 중/).closest('button');
    expect(loadingArea).toBeDisabled();
  });

  // ── 테스트 5 ──────────────────────────────────────────────────────────────
  it('빈 리뷰(공백만) 입력 시 버튼이 disabled되어 API 호출이 발생하지 않는다', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    const textarea = screen.getByPlaceholderText(/쿠팡 리뷰를 여기에 복사해서 붙여넣으세요/);

    // 공백만 입력
    await user.type(textarea, '   ');

    const generateButton = screen.getByRole('button', { name: /AI 카피 생성/ });

    // 버튼은 disabled 상태여야 함
    expect(generateButton).toBeDisabled();

    // 강제로 클릭을 시도해도 API 호출 없음 확인
    // (disabled 버튼은 userEvent로 클릭해도 핸들러 미호출)
    // 대신 store의 isGenerating 상태가 변하지 않아야 함
    const storeBefore = useEditorStore.getState();
    expect(storeBefore.isGenerating).toBe(false);

    // 카피 목록이 없어야 함
    expect(screen.queryByText(/생성된 카피/)).not.toBeInTheDocument();
  });
});
