/**
 * grade.ts
 * S~D 소싱 등급 컷오프 + 색상 팔레트
 *
 * 코스트코 사입 / 도매꾹 드롭쉬핑 양쪽에서 공용
 * 도매꾹은 보너스(남성 +5, 시즌 최대 +10) 포함 최대 110점
 */

export type SourcingGrade = 'S' | 'A' | 'B' | 'C' | 'D';

export interface GradeInfo {
  grade: SourcingGrade;
  label: string;
  color: string;
  bg: string;
}

/** 등급 컷오프 (이상) */
const GRADE_CUTOFFS: { min: number; info: GradeInfo }[] = [
  { min: 80, info: { grade: 'S', label: '즉시소싱', color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.08)' } },
  { min: 65, info: { grade: 'A', label: '추천',    color: '#16a34a', bg: 'rgba(22, 163, 74, 0.08)' } },
  { min: 50, info: { grade: 'B', label: '검토',    color: '#2563eb', bg: 'rgba(37, 99, 235, 0.08)' } },
  { min: 35, info: { grade: 'C', label: '비추',    color: '#d97706', bg: 'rgba(217, 119, 6, 0.08)' } },
  { min: 0,  info: { grade: 'D', label: '탈락',    color: '#dc2626', bg: 'rgba(220, 38, 38, 0.08)' } },
];

/**
 * 점수를 S~D 등급으로 변환
 * 도매꾹 보너스 포함 시 110점까지 가능하지만 S 기준(80)은 동일
 */
export function getGrade(score: number): GradeInfo {
  for (const { min, info } of GRADE_CUTOFFS) {
    if (score >= min) return info;
  }
  return GRADE_CUTOFFS[GRADE_CUTOFFS.length - 1].info; // D
}

/** 등급별 색상 팔레트 (UI 배지 등에서 직접 참조) */
export const GRADE_COLORS: Record<SourcingGrade, { color: string; bg: string }> = {
  S: { color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.08)' },
  A: { color: '#16a34a', bg: 'rgba(22, 163, 74, 0.08)' },
  B: { color: '#2563eb', bg: 'rgba(37, 99, 235, 0.08)' },
  C: { color: '#d97706', bg: 'rgba(217, 119, 6, 0.08)' },
  D: { color: '#dc2626', bg: 'rgba(220, 38, 38, 0.08)' },
};
