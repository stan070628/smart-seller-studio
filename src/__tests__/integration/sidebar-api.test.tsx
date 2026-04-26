/**
 * sidebar-api.test.tsx
 * Sidebar 컴포넌트 통합 테스트
 *
 * MSW로 실제 API 호출을 가로채 검증한다.
 * 실제 Sidebar는 /api/ai/generate-frames 엔드포인트를 호출한다.
 *
 * 테스트 케이스:
 *   1. 리뷰 입력 → AI 카피 버튼 클릭 → MSW 응답 → 완료 후 isGenerating=false
 *   2. AI API 500 에러 시 → 인라인 경고 메시지 표시
 *   3. 네트워크 오류(fetch 실패) 시 → 인라인 경고 메시지 표시
 *   4. 버튼 클릭 중(isGenerating) 재클릭 방지 - 버튼 disabled 확인
 *   5. 빈 리뷰(공백만) 입력 시 API 호출 안 됨
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
import { THEMES } from '@/lib/themes';
import Sidebar from '@/components/editor/Sidebar';

// ---------------------------------------------------------------------------
// 헬퍼: 스토어 초기화
// 실제 EditorStore에 존재하는 필드만 사용한다.
// ---------------------------------------------------------------------------
function resetStore() {
  useEditorStore.setState({
    uploadedImages: [],
    reviewText: '',
    productDescription: '',
    frames: [],
    isGenerating: false,
    imageAnalysis: null,
    isAnalyzing: false,
    frameImages: {},
    frameImageFit: {},
    frameImageSettings: {},
    theme: THEMES.functional,
    generatingImageForFrame: null,
    selectedFrameType: null,
    selectedFrameId: null,
    promptOutdatedFrames: new Set(),
    productExtract: null,
    isExtracting: false,
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
  it('리뷰 입력 후 AI 카피 버튼 클릭 시 MSW 응답으로 setFrames가 호출되고 isGenerating이 false로 복원된다', async () => {
    // /api/ai/generate-frames 핸들러 (실제 Sidebar가 호출하는 엔드포인트)
    server.use(
      http.post('/api/ai/generate-frames', () => {
        return HttpResponse.json({
          success: true,
          data: {
            frames: [
              {
                frameType: 'hero',
                headline: '강풍 자동개폐 카라비너 우산 방수 경량 안전버튼 남녀공용',
                subheadline: '바람에도 뒤집히지 않는 역풍 대응 구조',
                bodyText: null,
                ctaText: null,
                metadata: {},
                skip: false,
                imageDirection: null,
              },
              {
                frameType: 'feature_1',
                headline: '역풍 방지 자동 우산 카라비너 걸이 자동개폐 경량 방수',
                subheadline: null,
                bodyText: null,
                ctaText: null,
                metadata: {},
                skip: false,
                imageDirection: null,
              },
              {
                frameType: 'feature_2',
                headline: '자동 개폐 우산 강풍 카라비너 휴대 경량 방수 안전버튼',
                subheadline: null,
                bodyText: null,
                ctaText: null,
                metadata: {},
                skip: false,
                imageDirection: null,
              },
            ],
          },
        });
      }),
    );

    const user = userEvent.setup();
    render(<Sidebar />);

    // 리뷰 textarea에 텍스트 입력
    const textarea = screen.getByPlaceholderText(/쿠팡 리뷰를 여기에 복사해서 붙여넣으세요/);
    await user.type(textarea, '정말 좋은 제품입니다. 배송도 빠르고 품질도 최고에요.');

    // AI 카피 생성 버튼이 활성화되어야 함
    const generateButton = screen.getByRole('button', { name: /AI 카피 생성/ });
    expect(generateButton).not.toBeDisabled();

    // 버튼 클릭 → MSW가 /api/ai/generate-frames 응답
    await user.click(generateButton);

    // API 호출 완료 후 isGenerating이 false로 복원되어야 함
    await waitFor(() => {
      expect(useEditorStore.getState().isGenerating).toBe(false);
    });

    // 생성된 프레임이 store에 저장되어야 함
    const frames = useEditorStore.getState().frames;
    expect(frames.length).toBe(3);
    expect(frames[0].headline).toBe('강풍 자동개폐 카라비너 우산 방수 경량 안전버튼 남녀공용');
  });

  // ── 테스트 2 ──────────────────────────────────────────────────────────────
  it('AI API가 500 에러를 반환하면 인라인 경고 메시지가 표시된다', async () => {
    // 이 테스트에서만 500 에러 응답으로 오버라이드
    server.use(
      http.post('/api/ai/generate-frames', () => {
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

    // Sidebar는 alert 대신 인라인 경고 메시지를 표시함
    await waitFor(() => {
      expect(screen.getByText(/카피 생성에 실패했습니다/)).toBeInTheDocument();
    });

    // 카피 생성 완료 후 isGenerating이 false로 복원되어야 함
    await waitFor(() => {
      expect(useEditorStore.getState().isGenerating).toBe(false);
    });
  });

  // ── 테스트 3 ──────────────────────────────────────────────────────────────
  it('네트워크 오류(fetch 실패) 시 인라인 경고 메시지가 표시된다', async () => {
    // 네트워크 오류 시뮬레이션: MSW로 연결 오류 반환
    server.use(
      http.post('/api/ai/generate-frames', () => {
        return HttpResponse.error();
      }),
    );

    const user = userEvent.setup();
    render(<Sidebar />);

    const textarea = screen.getByPlaceholderText(/쿠팡 리뷰를 여기에 복사해서 붙여넣으세요/);
    await user.type(textarea, '테스트 리뷰 내용입니다.');

    const generateButton = screen.getByRole('button', { name: /AI 카피 생성/ });
    await user.click(generateButton);

    // 네트워크 오류 시 catch에서 인라인 경고 표시
    await waitFor(() => {
      expect(screen.getByText(/카피 생성에 실패했습니다. 다시 시도해주세요/)).toBeInTheDocument();
    });
  });

  // ── 테스트 4 ──────────────────────────────────────────────────────────────
  it('isGenerating이 true일 때 버튼이 disabled 상태가 된다 (재클릭 방지)', async () => {
    // 응답을 지연시켜 isGenerating=true 상태를 유지
    server.use(
      http.post('/api/ai/generate-frames', async () => {
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

    // 로딩 중에는 버튼 텍스트가 "카피 생성 중..."으로 변경됨
    await waitFor(() => {
      expect(screen.getByText(/카피 생성 중/)).toBeInTheDocument();
    });

    // isGenerating 상태에서 버튼 disabled 확인 (로딩 버튼 포함 영역)
    const loadingButton = screen.getByText(/카피 생성 중/).closest('button');
    expect(loadingButton).toBeDisabled();
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

    // store의 isGenerating 상태가 변하지 않아야 함
    const storeBefore = useEditorStore.getState();
    expect(storeBefore.isGenerating).toBe(false);

    // 프레임이 생성되지 않아야 함
    expect(useEditorStore.getState().frames).toHaveLength(0);
  });

  // ── 테스트 6 ──────────────────────────────────────────────────────────────
  it('테마 선택 버튼 클릭 시 store의 theme이 변경된다', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    // 초기 테마 확인 (functional)
    expect(useEditorStore.getState().theme.key).toBe('functional');

    // 뷰티제품 테마 버튼 클릭
    const beautyButton = screen.getByRole('button', { name: /뷰티제품/ });
    await user.click(beautyButton);

    // store의 theme이 beauty로 변경되어야 함
    await waitFor(() => {
      expect(useEditorStore.getState().theme.key).toBe('beauty');
    });
  });
});
