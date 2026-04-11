/**
 * 코스트코 모바일 목록 전용 타입
 * 필터 상태, 기본값, URL 파라미터 변환 유틸 포함
 */
import type { CostcoSortKey } from './costco';
import type { SourcingGrade } from '@/lib/sourcing/shared/grade';

export interface CostcoFilterState {
  category: string;           // '' = 전체
  grade: 'all' | SourcingGrade;
  stockStatus: 'all' | 'inStock' | 'lowStock' | 'outOfStock';
  genderFilter: 'all' | 'male_high' | 'male_friendly' | 'female';
  asteriskOnly: boolean;
  seasonOnly: boolean;
  /** 클라이언트 전용 — 서버에 전송 안 함 */
  hideHighCs: boolean;
  /** 클라이언트 전용 — 서버에 전송 안 함 */
  hideBlocked: boolean;
}

export const DEFAULT_FILTER_STATE: CostcoFilterState = {
  category: '',
  grade: 'all',
  stockStatus: 'all',
  genderFilter: 'all',
  asteriskOnly: false,
  seasonOnly: false,
  hideHighCs: true,
  hideBlocked: true,
};

/** URL searchParams ↔ FilterState 변환 */
export function parseFilterParams(params: URLSearchParams | Record<string, string | string[] | undefined>): CostcoFilterState {
  const get = (key: string): string => {
    if (params instanceof URLSearchParams) return params.get(key) ?? '';
    const v = (params as Record<string, string | string[] | undefined>)[key];
    return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
  };
  return {
    category:      get('category'),
    grade:         (get('grade') || 'all') as CostcoFilterState['grade'],
    stockStatus:   (get('stockStatus') || 'all') as CostcoFilterState['stockStatus'],
    genderFilter:  (get('genderFilter') || 'all') as CostcoFilterState['genderFilter'],
    asteriskOnly:  get('asteriskOnly') === '1',
    seasonOnly:    get('seasonOnly') === '1',
    hideHighCs:    get('hideHighCs') !== '0',   // 기본 true
    hideBlocked:   get('hideBlocked') !== '0',  // 기본 true
  };
}

/**
 * FilterState → URLSearchParams 변환
 * 클라이언트 전용 필드(hideHighCs, hideBlocked)는 서버에 전송하지 않음
 */
export function buildFilterParams(state: CostcoFilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (state.category)                   p.set('category', state.category);
  if (state.grade !== 'all')            p.set('grade', state.grade);
  if (state.stockStatus !== 'all')      p.set('stockStatus', state.stockStatus);
  if (state.genderFilter !== 'all')     p.set('genderFilter', state.genderFilter);
  if (state.asteriskOnly)               p.set('asteriskOnly', '1');
  if (state.seasonOnly)                 p.set('seasonOnly', '1');
  if (!state.hideHighCs)                p.set('hideHighCs', '0');
  if (!state.hideBlocked)               p.set('hideBlocked', '0');
  return p;
}

// CostcoSortKey를 이 모듈에서 re-export (편의용)
export type { CostcoSortKey };
