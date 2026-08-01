/**
 * tab.ts
 * 상단 탭 내비게이션 타입
 */

export type Tab = {
  /** 라우트 첫 세그먼트. 탭의 고유 식별자 */
  id: string;
  /** 쿼리스트링을 포함한 전체 경로 */
  href: string;
  /** 탭에 표시할 이름 */
  label: string;
  /** 마지막으로 활성화된 시각 (ms). LRU 밀어내기 기준 */
  lastActiveAt: number;
  /** 편집 중이면 true. 상한 계산과 밀어내기에서 제외된다 */
  isDirty: boolean;
};
