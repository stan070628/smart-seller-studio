'use client';

/**
 * 마진 계산기 화면 전용 localStorage 저장/복원 유틸.
 *
 * - `loadCalcState`는 서버 렌더링 단계(typeof window === 'undefined')에서는 항상 빈 객체를 반환한다.
 *   저장값이 없거나 JSON.parse에 실패해도 빈 객체로 폴백하므로 호출부는 항상 안전한 기본값과
 *   `??`로 병합하면 된다.
 * - `saveCalcState`는 사파리 프라이빗 모드 등 localStorage 접근이 막힌 환경에서도 예외를
 *   삼켜 계산기 자체가 죽지 않도록 한다.
 */

/** 저장된 계산기 상태를 읽는다. 없거나 깨졌으면 빈 객체를 반환한다. */
export function loadCalcState<T extends object>(key: string): Partial<T> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Partial<T>) : {};
  } catch {
    return {};
  }
}

/** 계산기 상태를 localStorage에 저장한다. 접근 실패는 조용히 무시한다. */
export function saveCalcState(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 사파리 프라이빗 모드 등 저장 실패 — 계산기 동작에는 영향 없음 */
  }
}

/** 디바운스 저장 지연(ms). 숫자 입력은 한 번에 타이핑하는 길이가 짧아 300ms 안팎이면 충분하다. */
export const CALC_SAVE_DEBOUNCE_MS = 400;
