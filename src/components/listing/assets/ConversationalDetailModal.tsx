'use client';

/**
 * ConversationalDetailModal.tsx
 *
 * 대화식 상세페이지 생성 모달.
 *
 * 흐름:
 * 1. 마운트 시 /api/ai/detail-page-suggest-answers Sonnet Vision 호출로 칩 후보 사전 채움
 * 2. 7개 질문(공통 5 + 카테고리 보충 2)을 순차 표시. 각 질문 카드는:
 *    - 추천 칩 ⭐ + 대안 칩 + 자유 입력 + 🤖 AI에게 맡기기 + ← 뒤로
 * 3. 마지막 답변 후 "생성하기" → /api/ai/generate-detail-html 호출 → onComplete 콜백
 *
 * 디자인 문서: docs/superpowers/specs/2026-05-16-conversational-detail-page-design.md §3.1
 */

import React, { useEffect, useMemo, useReducer, useState } from 'react';
import { X, Loader2, Sparkles, ArrowLeft, Bot, Send } from 'lucide-react';
import { C } from '@/lib/design-tokens';
import { getQuestionsForCategory } from '@/lib/conversational-detail/questions';
import type {
  CategoryKey,
  ChipSuggestion,
  ConversationContext,
  QuestionAnswer,
  QuestionDefinition,
} from '@/lib/conversational-detail/types';
import type { DetailPageContent } from '@/lib/ai/prompts/detail-page';
import { saveQASession, clearQASession } from '@/lib/listing/qa-session-draft';

interface Props {
  productName: string;
  category: CategoryKey;
  imageUrls: string[];
  initialAnswers?: QuestionAnswer[];  // 추가
  onClose: () => void;
  onComplete: (result: {
    html: string;
    content?: DetailPageContent;
    conversationContext: ConversationContext;
  }) => void;
}

type Phase = 'loading_suggestions' | 'qna' | 'generating' | 'error';

interface State {
  phase: Phase;
  questions: QuestionDefinition[];
  suggestions: ChipSuggestion[];
  answers: QuestionAnswer[];
  currentIndex: number;
  error: string | null;
}

type Action =
  | { type: 'suggestions_loaded'; suggestions: ChipSuggestion[] }
  | { type: 'suggestions_failed'; error: string }
  | { type: 'set_answer'; answer: QuestionAnswer }
  | { type: 'go_back' }
  | { type: 'start_generating' }
  | { type: 'set_error'; error: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'suggestions_loaded':
      return { ...state, phase: 'qna', suggestions: action.suggestions };
    case 'suggestions_failed':
      // graceful degradation: 정적 칩만으로 진행 가능
      return { ...state, phase: 'qna', suggestions: [], error: action.error };
    case 'set_answer': {
      const next = [...state.answers];
      const idx = next.findIndex((a) => a.questionId === action.answer.questionId);
      if (idx >= 0) next[idx] = action.answer;
      else next.push(action.answer);
      return {
        ...state,
        answers: next,
        currentIndex: Math.min(state.currentIndex + 1, state.questions.length),
      };
    }
    case 'go_back':
      return { ...state, currentIndex: Math.max(state.currentIndex - 1, 0) };
    case 'start_generating':
      return { ...state, phase: 'generating', error: null };
    case 'set_error':
      return { ...state, phase: 'error', error: action.error };
    default:
      return state;
  }
}

export default function ConversationalDetailModal({
  productName,
  category,
  imageUrls,
  initialAnswers,
  onClose,
  onComplete,
}: Props) {
  const questions = useMemo(() => getQuestionsForCategory(category), [category]);

  // initialAnswers가 있으면 pre-populate, currentIndex는 answers 수만큼 건너뜀
  const initialIndex = initialAnswers && initialAnswers.length >= questions.length
    ? questions.length  // 모든 답변 완료 → 리뷰 화면으로 바로 이동
    : (initialAnswers?.length ?? 0);

  const [state, dispatch] = useReducer(reducer, {
    phase: 'loading_suggestions' as Phase,
    questions,
    suggestions: [],
    answers: initialAnswers ?? [],
    currentIndex: initialIndex,
    error: null,
  });

  // 자유 입력 textarea 임시 상태 (현재 질문에 한정)
  const [freeText, setFreeText] = useState('');
  // AI 위임 호출 중 표시
  const [delegating, setDelegating] = useState(false);

  // 답변 저장 헬퍼: dispatch만 수행. 실제 저장은 아래 useEffect가 담당
  const dispatchAnswer = (answer: QuestionAnswer) => {
    dispatch({ type: 'set_answer', answer });
  };

  // 마운트 시 1회 사전 채움 호출
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ai/detail-page-suggest-answers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productName,
            category,
            imageUrls: imageUrls.slice(0, 6),
            questionIds: questions.map((q) => q.id),
          }),
        });
        const json = (await res.json()) as
          | { success: true; data: { suggestions: ChipSuggestion[] } }
          | { success: false; error: string };
        if (cancelled) return;
        if (!res.ok || !json.success) {
          dispatch({ type: 'suggestions_failed', error: !json.success ? json.error : '사전 채움 실패' });
          return;
        }
        dispatch({ type: 'suggestions_loaded', suggestions: json.data.suggestions });
      } catch (err) {
        if (cancelled) return;
        dispatch({
          type: 'suggestions_failed',
          error: err instanceof Error ? err.message : '사전 채움 호출 오류',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 질문 변경 시 자유 입력 초기화
  useEffect(() => {
    setFreeText('');
  }, [state.currentIndex]);

  // 답변이 바뀔 때마다 localStorage에 저장 (stale state 방지)
  useEffect(() => {
    if (state.answers.length > 0) {
      saveQASession(productName, state.answers);
    }
  }, [state.answers, productName]);

  const currentQuestion = state.questions[state.currentIndex];
  const isLastQuestion = state.currentIndex === state.questions.length;
  const suggestionForCurrent = state.suggestions.find((s) => s.questionId === currentQuestion?.id);

  const chipsForCurrent = useMemo(() => {
    if (!currentQuestion) return [];
    const dynamic = suggestionForCurrent?.chips ?? [];
    const staticChips = currentQuestion.staticChips ?? [];
    // 동적 칩 우선, 그 뒤 정적 칩 중 중복 제외하고 합산. 최대 5개.
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const chip of [...dynamic, ...staticChips]) {
      const trimmed = chip.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      merged.push(trimmed);
      if (merged.length >= 5) break;
    }
    return merged;
  }, [currentQuestion, suggestionForCurrent]);

  const recommendedIndex = suggestionForCurrent?.recommendedIndex ?? 0;

  const handleChipSelect = (chip: string) => {
    if (!currentQuestion) return;
    dispatchAnswer({
      questionId: currentQuestion.id,
      selectedChip: chip,
      resolvedValue: chip,
    });
  };

  const handleFreeTextSubmit = () => {
    if (!currentQuestion) return;
    const value = freeText.trim();
    if (!value) return;
    dispatchAnswer({
      questionId: currentQuestion.id,
      freeText: value,
      resolvedValue: value,
    });
  };

  const handleDelegate = async () => {
    if (!currentQuestion || delegating) return;
    setDelegating(true);
    try {
      const res = await fetch('/api/ai/detail-page-delegate-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName,
          category,
          questionId: currentQuestion.id,
          questionText: currentQuestion.text,
          previousAnswers: state.answers.map((a) => ({
            questionId: a.questionId,
            resolvedValue: a.resolvedValue,
          })),
        }),
      });
      const json = (await res.json()) as
        | { success: true; data: { value: string } }
        | { success: false; error: string };
      if (!res.ok || !json.success) {
        throw new Error(!json.success ? json.error : `위임 실패 (HTTP ${res.status})`);
      }
      dispatchAnswer({
        questionId: currentQuestion.id,
        delegatedToAi: true,
        resolvedValue: json.data.value,
      });
    } catch (err) {
      dispatch({
        type: 'set_error',
        error: err instanceof Error ? err.message : 'AI 위임 중 오류가 발생했습니다.',
      });
    } finally {
      setDelegating(false);
    }
  };

  const handleGenerate = async () => {
    dispatch({ type: 'start_generating' });
    const conversationContext: ConversationContext = {
      productName,
      category,
      imageUrls: imageUrls.slice(0, 6),
      answers: state.answers,
    };
    try {
      const res = await fetch('/api/ai/generate-detail-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrls: imageUrls.slice(0, 6),
          productName,
          category,
          studioMode: true,
          conversationContext,
        }),
      });
      const json = (await res.json()) as
        | { success: true; html: string; content?: DetailPageContent }
        | { success: false; error: string };
      if (!res.ok || !('html' in json) || !json.html) {
        throw new Error(
          'error' in json && json.error ? json.error : `상세페이지 생성 실패 (HTTP ${res.status})`,
        );
      }
      clearQASession(productName);
      onComplete({ html: json.html, content: json.content, conversationContext });
    } catch (err) {
      dispatch({
        type: 'set_error',
        error: err instanceof Error ? err.message : '상세페이지 생성 중 오류가 발생했습니다.',
      });
    }
  };

  // 키보드 ESC 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state.phase !== 'generating') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, state.phase]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.55)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '720px',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 헤더 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 24px 12px',
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={18} color="#7c3aed" />
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: C.text }}>
              AI 마케터와 함께 만들기
            </h2>
            {state.phase === 'qna' && (
              <span style={{ marginLeft: '8px', fontSize: '12px', color: C.textSub }}>
                {Math.min(state.currentIndex + 1, state.questions.length)} / {state.questions.length}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={state.phase === 'generating'}
            style={{
              background: 'none',
              border: 'none',
              cursor: state.phase === 'generating' ? 'not-allowed' : 'pointer',
              color: C.textSub,
              opacity: state.phase === 'generating' ? 0.4 : 1,
            }}
            aria-label="모달 닫기"
          >
            <X size={20} />
          </button>
        </div>

        {/* 본문 */}
        <div style={{ padding: '20px 24px', flex: 1, minHeight: '320px' }}>
          {state.phase === 'loading_suggestions' && <PhaseLoading text="이미지를 보고 답변 후보를 준비하고 있어요..." />}
          {state.phase === 'generating' && (
            <PhaseLoading text="대화 내용을 반영해 상세페이지를 만들고 있어요... (30초~1분)" />
          )}
          {state.phase === 'error' && (
            <PhaseError
              message={state.error ?? '알 수 없는 오류가 발생했습니다.'}
              onRetry={() => {
                // qna 단계로 돌려보내 사용자가 다시 시도할 수 있게 한다
                dispatch({ type: 'suggestions_loaded', suggestions: state.suggestions });
              }}
              onClose={onClose}
            />
          )}
          {state.phase === 'qna' && !isLastQuestion && currentQuestion && (
            <QuestionCard
              question={currentQuestion}
              chips={chipsForCurrent}
              recommendedIndex={recommendedIndex}
              showBack={state.currentIndex > 0}
              freeText={freeText}
              delegating={delegating}
              onChipSelect={handleChipSelect}
              onFreeTextChange={setFreeText}
              onFreeTextSubmit={handleFreeTextSubmit}
              onDelegate={handleDelegate}
              onBack={() => dispatch({ type: 'go_back' })}
              degradationNote={
                state.suggestions.length === 0 && state.error
                  ? '추천 답변을 불러오지 못해 기본 칩만 표시합니다. 직접 입력 또는 AI에게 맡기기를 사용하세요.'
                  : null
              }
            />
          )}
          {state.phase === 'qna' && isLastQuestion && (
            <ReviewAndGenerate
              answers={state.answers}
              questions={state.questions}
              onGenerate={handleGenerate}
              onBack={() => dispatch({ type: 'go_back' })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 하위 컴포넌트 ────────────────────────────────────────────────────────

function PhaseLoading({ text }: { text: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        height: '100%',
        minHeight: '280px',
      }}
    >
      <Loader2 size={32} color="#7c3aed" style={{ animation: 'spin 1s linear infinite' }} />
      <p style={{ margin: 0, fontSize: '13px', color: C.textSub }}>{text}</p>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function PhaseError({
  message,
  onRetry,
  onClose,
}: {
  message: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div
        style={{
          padding: '12px 14px',
          backgroundColor: '#fee2e2',
          color: '#b91c1c',
          fontSize: '13px',
          borderRadius: '8px',
        }}
      >
        {message}
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={onRetry}
          style={{
            padding: '9px 16px',
            fontSize: '13px',
            fontWeight: 600,
            backgroundColor: '#7c3aed',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
          }}
        >
          다시 시도
        </button>
        <button
          onClick={onClose}
          style={{
            padding: '9px 16px',
            fontSize: '13px',
            fontWeight: 600,
            backgroundColor: C.tableHeader,
            color: C.text,
            border: `1px solid ${C.border}`,
            borderRadius: '8px',
            cursor: 'pointer',
          }}
        >
          취소
        </button>
      </div>
    </div>
  );
}

interface QuestionCardProps {
  question: QuestionDefinition;
  chips: string[];
  recommendedIndex: number;
  showBack: boolean;
  freeText: string;
  delegating: boolean;
  onChipSelect: (chip: string) => void;
  onFreeTextChange: (v: string) => void;
  onFreeTextSubmit: () => void;
  onDelegate: () => void;
  onBack: () => void;
  degradationNote: string | null;
}

function QuestionCard({
  question,
  chips,
  recommendedIndex,
  showBack,
  freeText,
  delegating,
  onChipSelect,
  onFreeTextChange,
  onFreeTextSubmit,
  onDelegate,
  onBack,
  degradationNote,
}: QuestionCardProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: C.text, lineHeight: 1.5 }}>
        {question.text}
      </h3>

      {degradationNote && (
        <p
          style={{
            margin: 0,
            padding: '8px 10px',
            backgroundColor: '#fffbeb',
            color: '#92400e',
            fontSize: '11px',
            borderRadius: '6px',
            border: '1px solid #fcd34d',
          }}
        >
          {degradationNote}
        </p>
      )}

      {chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {chips.map((chip, idx) => {
            const isRecommended = idx === recommendedIndex;
            return (
              <button
                key={chip}
                onClick={() => onChipSelect(chip)}
                style={{
                  padding: '7px 12px',
                  fontSize: '13px',
                  borderRadius: '999px',
                  border: `1px solid ${isRecommended ? '#7c3aed' : C.border}`,
                  backgroundColor: isRecommended ? '#f5f3ff' : '#fff',
                  color: isRecommended ? '#5b21b6' : C.text,
                  fontWeight: isRecommended ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                {isRecommended ? '⭐ ' : ''}
                {chip}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: '6px' }}>
        <textarea
          value={freeText}
          onChange={(e) => onFreeTextChange(e.target.value)}
          placeholder="직접 입력하기"
          rows={2}
          maxLength={500}
          style={{
            flex: 1,
            padding: '8px 10px',
            fontSize: '13px',
            border: `1px solid ${C.border}`,
            borderRadius: '8px',
            outline: 'none',
            resize: 'vertical',
            boxSizing: 'border-box',
            color: C.text,
          }}
        />
        <button
          onClick={onFreeTextSubmit}
          disabled={!freeText.trim()}
          style={{
            padding: '8px 14px',
            fontSize: '13px',
            fontWeight: 600,
            backgroundColor: freeText.trim() ? '#7c3aed' : C.border,
            color: freeText.trim() ? '#fff' : C.textSub,
            border: 'none',
            borderRadius: '8px',
            cursor: freeText.trim() ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <Send size={14} /> 입력
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
        {showBack ? (
          <button
            onClick={onBack}
            style={{
              padding: '7px 10px',
              fontSize: '12px',
              backgroundColor: 'transparent',
              color: C.textSub,
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <ArrowLeft size={13} /> 이전 질문
          </button>
        ) : (
          <span />
        )}
        <button
          onClick={onDelegate}
          disabled={delegating}
          style={{
            padding: '7px 12px',
            fontSize: '12px',
            fontWeight: 600,
            backgroundColor: '#fff',
            color: '#7c3aed',
            border: '1px solid #ddd6fe',
            borderRadius: '8px',
            cursor: delegating ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          {delegating ? (
            <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
          ) : (
            <Bot size={13} />
          )}
          AI에게 맡기기
        </button>
      </div>
    </div>
  );
}

function ReviewAndGenerate({
  answers,
  questions,
  onGenerate,
  onBack,
}: {
  answers: QuestionAnswer[];
  questions: QuestionDefinition[];
  onGenerate: () => void;
  onBack: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: C.text }}>
        수집된 답변을 확인하세요
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {questions.map((q) => {
          const answer = answers.find((a) => a.questionId === q.id);
          return (
            <div
              key={q.id}
              style={{
                padding: '10px 12px',
                border: `1px solid ${C.border}`,
                borderRadius: '8px',
                backgroundColor: '#fafafa',
              }}
            >
              <p style={{ margin: 0, fontSize: '11px', color: C.textSub }}>{q.text}</p>
              <p style={{ margin: '2px 0 0', fontSize: '13px', color: C.text, fontWeight: 500 }}>
                {answer?.resolvedValue || '(답변 없음)'}
                {answer?.delegatedToAi && (
                  <span style={{ marginLeft: '6px', fontSize: '11px', color: '#7c3aed' }}>
                    🤖 AI 결정
                  </span>
                )}
              </p>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button
          onClick={onBack}
          style={{
            padding: '9px 16px',
            fontSize: '13px',
            fontWeight: 600,
            backgroundColor: C.tableHeader,
            color: C.text,
            border: `1px solid ${C.border}`,
            borderRadius: '8px',
            cursor: 'pointer',
          }}
        >
          이전
        </button>
        <button
          onClick={onGenerate}
          style={{
            padding: '9px 20px',
            fontSize: '13px',
            fontWeight: 700,
            backgroundColor: '#7c3aed',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Sparkles size={14} />
          생성하기
        </button>
      </div>
    </div>
  );
}
