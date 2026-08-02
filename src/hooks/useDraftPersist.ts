'use client';

/**
 * useDraftPersist.ts
 * "제출 전 입력값"을 localStorage에 디바운스 저장하고, 언마운트 시 마지막 값을
 * 동기로 flush하는 범용 훅.
 *
 * 배경 — 주문/매출 화면(CostEntryDrawer·SaleEntryPanel 등)의 모달·드로어는
 * 탭을 옮기면 통째로 언마운트됐다 재마운트된다(useTabUiState.ts 참고).
 * 그 안의 입력 폼은 평범한 useState라 언마운트 시 사라진다 — 서버에 제출하기
 * 전 값이라 서버 저장 대상이 아니고, localStorage가 맞는 자리다.
 *
 * 재사용: 계산기 작업(82de74fe)이 만든 src/components/calculator/persist.ts의
 * loadCalcState/saveCalcState를 그대로 쓴다(SSR 안전, 파싱 실패 시 빈 값 폴백은
 * 이미 검증됨). 라벨 작업(3b2e229c)에 이어 이 훅이 세 번째 사용처이지만,
 * persist.ts를 공용 위치로 옮기지는 않았다 — 계산기 8개·라벨 9개 파일의 import
 * 경로를 바꿔야 하는 비용 대비, 이미 범용적으로 동작하는 함수 이름
 * (loadCalcState 등은 "계산기 전용"이 아니라 그냥 localStorage 헬퍼)이라
 * 얻는 이득이 작다고 판단했다. 대신 이 훅이 도메인에 맞는 이름(초안 저장)으로
 * 감싸 재노출한다.
 *
 * 디바운스 도중 언마운트되면 마지막 입력이 사라지는 구멍(계산기·라벨에 이미
 * 있던 문제)을 이 훅은 처음부터 막는다 — ref로 최신 값을 들고 있다가,
 * key가 바뀌거나(다른 대상으로 전환) 컴포넌트가 사라질 때 그 값을 동기 저장한다.
 *
 * 복원은 이 훅이 하지 않는다 — 호출부가 마운트 직후 한 번 loadDraft(key)를 읽어
 * 여러 개의 개별 state(form, subForm 등)에 나눠 세팅해야 하는 경우가 많고,
 * 그 분배 방식은 컴포넌트마다 다르기 때문이다.
 */

import { useCallback, useEffect, useRef } from 'react';
import { loadCalcState, saveCalcState, CALC_SAVE_DEBOUNCE_MS } from '@/components/calculator/persist';

/** 저장된 초안을 읽는다. 없거나 깨졌으면 빈 객체를 반환한다(계산기 헬퍼와 동일한 계약). */
export function loadDraft<T extends object>(key: string): Partial<T> {
  return loadCalcState<T>(key);
}

/** 초안을 즉시(동기) 저장한다. 디바운스 없이 바로 써야 하는 자리(제출 직후 등)에 쓴다. */
export function saveDraftNow(key: string, value: unknown): void {
  saveCalcState(key, value);
}

/** 초안을 지운다. 제출 성공 후 호출해 "다음에 열 때 옛 값이 남는" 문제를 막는다. */
export function clearDraft(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* 사파리 프라이빗 모드 등 저장 접근 실패 — 무시 */
  }
}

/** 이 키에 저장된 초안이 있는지만 확인한다. "작성 중" 배지 표시에 쓴다 — 값 자체는 필요 없을 때. */
export function hasDraft(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

/**
 * 폼 초안을 디바운스 저장하고 언마운트 시 flush한다.
 *
 * @param key            localStorage 키. null이면 이 훅은 아무 것도 하지 않는다
 *                       (예: 대상 productId가 아직 정해지지 않은 경우).
 * @param draft          저장할 값(직렬화 가능한 순수 객체). 매 렌더 새로 만들어 넘겨도
 *                       된다 — 이 훅은 참조가 아니라 매 렌더의 최신값을 ref로 추적한다.
 * @param shouldPersist  false면 저장 대신 삭제한다. "지금은 초안으로 남길 내용이
 *                       없다"(예: 입력 폼이 닫혀 있음, 모두 빈 값)는 뜻으로 쓴다.
 * @returns { clearNow }  제출 성공 직후 호출한다. **모달을 닫아 이 컴포넌트가 바로
 *                        언마운트되는 흐름**(ExpenseModal·ShippingGroupModal 등:
 *                        저장 성공 → onSaved() → 부모가 즉시 unmount)에서는 단순히
 *                        localStorage만 지우는 것으로 부족하다 — 언마운트 시 flush
 *                        effect가 "마지막 렌더의" shouldPersist(아직 true)를 ref에서
 *                        읽어 지운 값을 그대로 되살려버리는 경합이 있다(실측으로 확인:
 *                        clearDraft만 부르면 저장 직후에도 draft가 되살아났다).
 *                        clearNow()는 localStorage를 지우면서 ref도 함께
 *                        shouldPersist=false로 동기 갱신해 그 경합을 막는다.
 *                        같은 컴포넌트가 계속 살아있는 흐름(CostEntryDrawer의 인라인
 *                        "취소"처럼 setState로 자연히 shouldPersist가 false가 되는
 *                        경우)에서도 그냥 이걸 쓰면 된다 — 항상 안전한 쪽이다.
 */
export function useDraftPersist<T>(
  key: string | null,
  draft: T,
  shouldPersist: boolean,
): { clearNow: () => void } {
  const latestRef = useRef({ draft, shouldPersist });
  latestRef.current = { draft, shouldPersist };

  const flush = (k: string) => {
    if (latestRef.current.shouldPersist) saveCalcState(k, latestRef.current.draft);
    else clearDraft(k);
  };

  // 디바운스 저장 — 타이핑마다 바로 쓰지 않고 잠시 모아서 쓴다.
  useEffect(() => {
    if (!key) return;
    const timer = setTimeout(() => flush(key), CALC_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // draft·shouldPersist가 바뀔 때마다 새로 디바운스를 건다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, draft, shouldPersist]);

  // 동기 flush — key가 바뀌거나(다른 대상으로 전환) 컴포넌트가 사라질 때만 실행된다.
  // deps를 [key]로 좁혀서 매 렌더(=매 키 입력)마다 실행되지 않게 한다 — ref가
  // 항상 최신값을 들고 있으므로 이 시점에만 flush해도 마지막 입력을 놓치지 않는다.
  useEffect(() => {
    if (!key) return;
    return () => flush(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const clearNow = useCallback(() => {
    if (key) clearDraft(key);
    // ref를 직접 갱신 — setState가 아니라 즉시 반영된다. 이 직후 부모가 동기적으로
    // 컴포넌트를 unmount해도(re-render 기회 없이) 위 flush effect의 cleanup이
    // 이 최신 ref를 읽으므로 shouldPersist=false로 정확히 처리된다.
    latestRef.current = { draft: latestRef.current.draft, shouldPersist: false };
  }, [key]);

  return { clearNow };
}
