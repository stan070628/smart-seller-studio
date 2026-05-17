/**
 * 대화식 상세페이지 생성 — 질문 정의
 *
 * 디자인 문서: docs/superpowers/specs/2026-05-16-conversational-detail-page-design.md §6
 */

import type { CategoryKey, QuestionDefinition } from './types';

/** 공통 질문 5개 — 모든 카테고리에 던진다 */
export const COMMON_QUESTIONS: QuestionDefinition[] = [
  {
    id: 'target',
    text: '누구를 위한 상품인가요?',
    // 정적 칩은 일반적 후보. Sonnet이 카테고리·사진 보고 동적으로 보완.
    staticChips: ['30대 여성', '20대 남성', '워킹맘', '인테리어 관심 20대', '시니어'],
  },
  {
    id: 'usp',
    text: '가장 먼저 떠올리게 할 한 가지 강점은?',
  },
  {
    id: 'tone',
    text: '톤·분위기는 어떻게 가져갈까요?',
    staticChips: ['감성적', '전문적', '캐주얼', '유머러스', '신뢰감'],
  },
  {
    id: 'pain',
    text: '어떤 불편을 해결하나요?',
  },
  {
    id: 'differentiator',
    text: '경쟁 상품과 결정적으로 다른 점은?',
  },
];

/** 카테고리별 보충 질문 (각 2개) */
export const CATEGORY_QUESTIONS: Record<CategoryKey, QuestionDefinition[]> = {
  basic: [
    {
      id: 'basic_material',
      text: '주된 재질·구성은 무엇인가요?',
      appliesToCategory: 'basic',
    },
    {
      id: 'basic_compat',
      text: '어떤 규격·호환성을 강조할까요?',
      appliesToCategory: 'basic',
    },
  ],
  fashion: [
    {
      id: 'fashion_fit',
      text: '핏·사이즈 특성은 어떤가요?',
      staticChips: ['오버핏', '슬림핏', '표준핏', '루즈핏'],
      appliesToCategory: 'fashion',
    },
    {
      id: 'fashion_styling',
      text: '어떤 코디 상황에 추천하나요?',
      appliesToCategory: 'fashion',
    },
  ],
  living: [
    {
      id: 'living_space',
      text: '어떤 공간에서 주로 쓰나요?',
      appliesToCategory: 'living',
    },
    {
      id: 'living_care',
      text: '청소·관리 편의를 어떻게 강조할까요?',
      appliesToCategory: 'living',
    },
  ],
  food: [
    {
      id: 'food_storage',
      text: '보관·원산지를 어떻게 강조할까요?',
      appliesToCategory: 'food',
    },
    {
      id: 'food_taste',
      text: '맛을 어떻게 표현할까요?',
      appliesToCategory: 'food',
    },
  ],
};

/** 카테고리에 맞는 전체 질문 시퀀스(공통 5 + 보충 2 = 7개)를 반환 */
export function getQuestionsForCategory(category: CategoryKey): QuestionDefinition[] {
  return [...COMMON_QUESTIONS, ...CATEGORY_QUESTIONS[category]];
}

/** 화이트리스트: 신규 라우트의 Zod 검증에서 유효한 questionId 목록 */
export const ALL_QUESTION_IDS: readonly string[] = [
  ...COMMON_QUESTIONS.map((q) => q.id),
  ...Object.values(CATEGORY_QUESTIONS)
    .flat()
    .map((q) => q.id),
];
