// src/__tests__/lib/qa-session-draft.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveQASession, loadQASession, clearQASession } from '@/lib/listing/qa-session-draft';

const PRODUCT = '테스트상품';

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('saveQASession / loadQASession', () => {
  it('저장 후 로드하면 같은 answers를 반환한다', () => {
    const answers = [{ questionId: 'target', resolvedValue: '30대 여성' }];
    saveQASession(PRODUCT, answers);
    expect(loadQASession(PRODUCT)).toEqual(answers);
  });

  it('24시간이 지난 세션은 null을 반환하고 항목을 삭제한다', () => {
    // setSystemTime 사용 전 fake timers 활성화 필수
    vi.useFakeTimers();
    const answers = [{ questionId: 'tone', resolvedValue: '감성적' }];
    saveQASession(PRODUCT, answers);
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    expect(loadQASession(PRODUCT)).toBeNull();
  });

  it('저장된 항목이 없으면 null을 반환한다', () => {
    expect(loadQASession('없는상품')).toBeNull();
  });
});

describe('clearQASession', () => {
  it('저장 후 clear하면 null을 반환한다', () => {
    saveQASession(PRODUCT, [{ questionId: 'usp', resolvedValue: '가볍다' }]);
    clearQASession(PRODUCT);
    expect(loadQASession(PRODUCT)).toBeNull();
  });
});
