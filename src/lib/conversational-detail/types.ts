/**
 * 대화식 상세페이지 생성 — 공유 타입 정의
 *
 * 디자인 문서: docs/superpowers/specs/2026-05-16-conversational-detail-page-design.md §4.1
 */

export type CategoryKey = 'basic' | 'fashion' | 'living' | 'food';

export interface QuestionDefinition {
  id: string;
  /** 사용자에게 보이는 질문 텍스트 */
  text: string;
  /** 카테고리 무관 고정 칩. 없으면 사전 채움에서 동적으로 생성. */
  staticChips?: string[];
  /** 카테고리 보충 질문이면 명시. 없으면 공통 질문(모든 카테고리). */
  appliesToCategory?: CategoryKey;
}

export interface ChipSuggestion {
  questionId: string;
  /** 3~4개 권장. 첫 번째가 추천(⭐). */
  chips: string[];
  recommendedIndex: number;
}

export interface QuestionAnswer {
  questionId: string;
  selectedChip?: string;
  freeText?: string;
  delegatedToAi?: boolean;
  /** 최종 답변. 칩/자유/위임 어느 경로든 이 한 필드로 통일. */
  resolvedValue: string;
}

export interface ConversationContext {
  productName: string;
  category: CategoryKey;
  /** Supabase 공개 URL. 최대 5장. */
  imageUrls: string[];
  answers: QuestionAnswer[];
}
