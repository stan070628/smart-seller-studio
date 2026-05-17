/**
 * conversational-detail/questions.ts 단위 테스트
 *
 * 검증 포인트:
 * - 카테고리별로 공통 5 + 보충 2 = 7개 질문 반환
 * - 공통 질문은 카테고리에 무관하게 동일
 * - 보충 질문은 카테고리에 맞는 것만 포함
 * - ALL_QUESTION_IDS가 모든 질문 ID를 중복 없이 포함
 */

import { describe, it, expect } from 'vitest';
import {
  COMMON_QUESTIONS,
  CATEGORY_QUESTIONS,
  getQuestionsForCategory,
  ALL_QUESTION_IDS,
} from '@/lib/conversational-detail/questions';
import type { CategoryKey } from '@/lib/conversational-detail/types';

const CATEGORIES: CategoryKey[] = ['basic', 'fashion', 'living', 'food'];

describe('COMMON_QUESTIONS', () => {
  it('공통 질문은 5개', () => {
    expect(COMMON_QUESTIONS).toHaveLength(5);
  });

  it('공통 질문은 카테고리에 묶이지 않는다 (appliesToCategory 없음)', () => {
    for (const q of COMMON_QUESTIONS) {
      expect(q.appliesToCategory).toBeUndefined();
    }
  });

  it('공통 질문 ID는 고유하다', () => {
    const ids = COMMON_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('CATEGORY_QUESTIONS', () => {
  it.each(CATEGORIES)('%s 카테고리는 보충 질문 2개', (category) => {
    expect(CATEGORY_QUESTIONS[category]).toHaveLength(2);
  });

  it.each(CATEGORIES)('%s 보충 질문은 해당 카테고리에 묶여 있다', (category) => {
    for (const q of CATEGORY_QUESTIONS[category]) {
      expect(q.appliesToCategory).toBe(category);
    }
  });
});

describe('getQuestionsForCategory', () => {
  it.each(CATEGORIES)('%s — 공통 5 + 보충 2 = 7개를 순서대로 반환', (category) => {
    const questions = getQuestionsForCategory(category);
    expect(questions).toHaveLength(7);
    // 앞 5개는 공통
    expect(questions.slice(0, 5).map((q) => q.id)).toEqual(COMMON_QUESTIONS.map((q) => q.id));
    // 뒤 2개는 해당 카테고리 보충
    expect(questions.slice(5).map((q) => q.id)).toEqual(
      CATEGORY_QUESTIONS[category].map((q) => q.id),
    );
  });

  it('서로 다른 카테고리는 보충 질문이 다르다', () => {
    const fashion = getQuestionsForCategory('fashion').slice(5).map((q) => q.id);
    const food = getQuestionsForCategory('food').slice(5).map((q) => q.id);
    expect(fashion).not.toEqual(food);
  });
});

describe('ALL_QUESTION_IDS', () => {
  it('공통 5 + 카테고리 4×2 = 13개 ID를 포함한다', () => {
    expect(ALL_QUESTION_IDS).toHaveLength(13);
  });

  it('중복 없는 ID 목록이다', () => {
    expect(new Set(ALL_QUESTION_IDS).size).toBe(ALL_QUESTION_IDS.length);
  });

  it('getQuestionsForCategory가 반환하는 모든 ID는 ALL_QUESTION_IDS에 존재한다', () => {
    for (const category of CATEGORIES) {
      for (const q of getQuestionsForCategory(category)) {
        expect(ALL_QUESTION_IDS).toContain(q.id);
      }
    }
  });
});
