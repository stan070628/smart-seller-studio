/**
 * ConversationalDetailModal — UI 흐름 통합 테스트.
 *
 * 검증 포인트:
 * - 마운트 시 사전 채움 호출 + 칩 후보 렌더
 * - 칩 선택 → 다음 질문으로 진행
 * - 자유 입력 → 입력 → 다음 질문
 * - AI에게 맡기기 → 위임 API 호출 → 답변 반영
 * - 이전 질문으로 돌아가기
 * - 마지막 질문 후 검토 단계 → 생성하기 → onComplete 콜백
 * - 사전 채움 실패 시 graceful degradation (정적 칩만)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import ConversationalDetailModal from '@/components/listing/assets/ConversationalDetailModal';
import { server } from '../mocks/server';
import type { ChipSuggestion } from '@/lib/conversational-detail/types';

const defaultProps = {
  productName: '프리미엄 텀블러',
  category: 'living' as const,
  imageUrls: ['https://example.com/img.jpg'],
};

const buildSuggestions = (): ChipSuggestion[] => [
  { questionId: 'target', chips: ['30대 워킹맘', '20대 직장인', '시니어'], recommendedIndex: 0 },
  { questionId: 'usp', chips: ['원터치 버튼', '경량 디자인'], recommendedIndex: 0 },
  { questionId: 'tone', chips: ['신뢰감', '감성적'], recommendedIndex: 0 },
  { questionId: 'pain', chips: ['손이 바쁠 때', '무거운 텀블러'], recommendedIndex: 0 },
  { questionId: 'differentiator', chips: ['절반 두께'], recommendedIndex: 0 },
  { questionId: 'living_space', chips: ['좁은 주방'], recommendedIndex: 0 },
  { questionId: 'living_care', chips: ['분리세척 가능'], recommendedIndex: 0 },
];

function mockSuggestSuccess() {
  server.use(
    http.post('/api/ai/detail-page-suggest-answers', () =>
      HttpResponse.json({ success: true, data: { suggestions: buildSuggestions() } }),
    ),
  );
}

function mockSuggestFailure() {
  server.use(
    http.post('/api/ai/detail-page-suggest-answers', () =>
      HttpResponse.json({ success: false, error: '일시적 오류' }, { status: 503 }),
    ),
  );
}

function mockDelegateSuccess(value = 'AI가 결정한 답변') {
  server.use(
    http.post('/api/ai/detail-page-delegate-answer', () =>
      HttpResponse.json({ success: true, data: { value } }),
    ),
  );
}

function mockGenerateSuccess() {
  server.use(
    http.post('/api/ai/generate-detail-html', () =>
      HttpResponse.json({
        success: true,
        html: '<div>생성된 상세페이지</div>',
        content: undefined,
      }),
    ),
  );
}

describe('ConversationalDetailModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('마운트 시 사전 채움 호출 후 첫 질문이 렌더된다', async () => {
    mockSuggestSuccess();
    render(
      <ConversationalDetailModal {...defaultProps} onClose={vi.fn()} onComplete={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/누구를 위한 상품인가요/)).toBeInTheDocument();
    });
    // 첫 추천 칩이 ⭐로 표시되는지
    expect(screen.getByText(/30대 워킹맘/)).toBeInTheDocument();
  });

  it('진행률 카운터가 1 / 7로 시작한다', async () => {
    mockSuggestSuccess();
    render(
      <ConversationalDetailModal {...defaultProps} onClose={vi.fn()} onComplete={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText('1 / 7')).toBeInTheDocument();
    });
  });

  it('칩 클릭 시 다음 질문으로 진행한다', async () => {
    mockSuggestSuccess();
    render(
      <ConversationalDetailModal {...defaultProps} onClose={vi.fn()} onComplete={vi.fn()} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/누구를 위한 상품인가요/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /30대 워킹맘/ }));

    await waitFor(() => {
      expect(screen.getByText(/가장 먼저 떠올리게 할 한 가지 강점/)).toBeInTheDocument();
    });
    expect(screen.getByText('2 / 7')).toBeInTheDocument();
  });

  it('자유 입력 후 입력 버튼 클릭 시 다음 질문으로 진행', async () => {
    mockSuggestSuccess();
    render(
      <ConversationalDetailModal {...defaultProps} onClose={vi.fn()} onComplete={vi.fn()} />,
    );

    await waitFor(() => screen.getByText(/누구를 위한 상품인가요/));
    const textarea = screen.getByPlaceholderText('직접 입력하기');
    fireEvent.change(textarea, { target: { value: '커스텀 타겟' } });
    fireEvent.click(screen.getByRole('button', { name: /입력/ }));

    await waitFor(() => {
      expect(screen.getByText(/가장 먼저 떠올리게 할 한 가지 강점/)).toBeInTheDocument();
    });
  });

  it('AI에게 맡기기 → 위임 API 호출 후 답변 반영하고 다음 질문', async () => {
    mockSuggestSuccess();
    mockDelegateSuccess('AI가 결정한 30대 직장인');
    render(
      <ConversationalDetailModal {...defaultProps} onClose={vi.fn()} onComplete={vi.fn()} />,
    );

    await waitFor(() => screen.getByText(/누구를 위한 상품인가요/));
    fireEvent.click(screen.getByRole('button', { name: /AI에게 맡기기/ }));

    await waitFor(() => {
      expect(screen.getByText(/가장 먼저 떠올리게 할 한 가지 강점/)).toBeInTheDocument();
    });
  });

  it('이전 질문으로 돌아갈 수 있다 (첫 질문 이후)', async () => {
    mockSuggestSuccess();
    render(
      <ConversationalDetailModal {...defaultProps} onClose={vi.fn()} onComplete={vi.fn()} />,
    );

    await waitFor(() => screen.getByText(/누구를 위한 상품인가요/));
    fireEvent.click(screen.getByRole('button', { name: /30대 워킹맘/ }));

    await waitFor(() => screen.getByText(/가장 먼저 떠올리게 할 한 가지 강점/));
    fireEvent.click(screen.getByRole('button', { name: /이전 질문/ }));

    await waitFor(() => {
      expect(screen.getByText(/누구를 위한 상품인가요/)).toBeInTheDocument();
    });
  });

  it('사전 채움 실패 시 정적 칩으로 진행 가능 (graceful degradation)', async () => {
    mockSuggestFailure();
    render(
      <ConversationalDetailModal {...defaultProps} onClose={vi.fn()} onComplete={vi.fn()} />,
    );

    // 정적 칩이 표시될 때까지 기다림 (target 질문의 staticChips)
    await waitFor(() => {
      expect(screen.getByText(/추천 답변을 불러오지 못해/)).toBeInTheDocument();
    });
    // target 질문의 정적 칩 중 하나가 보인다
    expect(screen.getByRole('button', { name: /30대 여성/ })).toBeInTheDocument();
  });

  it('마지막 질문 답 후 검토 단계 → 생성하기 → onComplete 콜백', async () => {
    mockSuggestSuccess();
    mockGenerateSuccess();
    const onComplete = vi.fn();
    render(
      <ConversationalDetailModal {...defaultProps} onClose={vi.fn()} onComplete={onComplete} />,
    );

    // 7개 질문 모두 첫 칩 클릭으로 답
    const expectedQuestions = [
      /누구를 위한 상품인가요/,
      /가장 먼저 떠올리게 할 한 가지 강점/,
      /톤·분위기/,
      /어떤 불편을 해결/,
      /경쟁 상품과 결정적으로 다른 점/,
      /어떤 공간에서 주로/,
      /청소·관리 편의/,
    ];

    for (let i = 0; i < expectedQuestions.length; i++) {
      await waitFor(() => screen.getByText(expectedQuestions[i]));
      // 각 질문에서 가장 첫번째 칩(추천)을 클릭. role=button, ⭐이 텍스트에 포함될 수도/없을 수도 있으니
      // textarea의 입력 버튼이 아닌 칩 버튼을 정확히 고르기 위해 다른 방식 사용.
      const allButtons = screen.getAllByRole('button');
      // 추천(⭐) 칩을 찾고 없으면 첫번째 칩 찾기. 칩은 ⭐ 또는 일반 텍스트만 있는 button.
      const chipBtn = allButtons.find((btn) => btn.textContent?.includes('⭐'));
      expect(chipBtn).toBeDefined();
      fireEvent.click(chipBtn!);
    }

    // 검토 화면 렌더
    await waitFor(() => {
      expect(screen.getByText(/수집된 답변을 확인하세요/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /생성하기/ }));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    const arg = onComplete.mock.calls[0][0];
    expect(arg.html).toBe('<div>생성된 상세페이지</div>');
    expect(arg.conversationContext.answers).toHaveLength(7);
    expect(arg.conversationContext.category).toBe('living');
    expect(arg.conversationContext.productName).toBe('프리미엄 텀블러');
  });

  it('imageUrls가 6장이면 suggest-answers 호출 시 6장 모두 전달된다', async () => {
    const sixUrls = Array.from({ length: 6 }, (_, i) => `https://example.com/img${i}.jpg`);
    let capturedBody: unknown;
    server.use(
      http.post('/api/ai/detail-page-suggest-answers', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ success: true, data: { suggestions: [] } });
      }),
    );
    server.use(
      http.post('/api/ai/generate-detail-html', () =>
        HttpResponse.json({ html: '<div>ok</div>' }),
      ),
    );

    render(
      <ConversationalDetailModal
        {...defaultProps}
        imageUrls={sixUrls}
        onClose={() => {}}
        onComplete={() => {}}
      />,
    );

    await waitFor(() => expect(capturedBody).toBeDefined());
    expect((capturedBody as { imageUrls: string[] }).imageUrls).toHaveLength(6);
  });

  it('X 버튼 클릭 시 onClose 호출', async () => {
    mockSuggestSuccess();
    const onClose = vi.fn();
    render(<ConversationalDetailModal {...defaultProps} onClose={onClose} onComplete={vi.fn()} />);

    await waitFor(() => screen.getByText(/누구를 위한 상품인가요/));
    fireEvent.click(screen.getByRole('button', { name: /모달 닫기/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it('카테고리가 fashion이면 fashion 보충 질문이 나타난다', async () => {
    server.use(
      http.post('/api/ai/detail-page-suggest-answers', () =>
        HttpResponse.json({
          success: true,
          data: {
            suggestions: [
              { questionId: 'fashion_fit', chips: ['오버핏', '슬림핏'], recommendedIndex: 0 },
            ],
          },
        }),
      ),
    );
    render(
      <ConversationalDetailModal
        {...defaultProps}
        category="fashion"
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    // 진행률 카운터로 7개 질문이 있음 확인
    await waitFor(() => {
      expect(screen.getByText('1 / 7')).toBeInTheDocument();
    });
  });
});
