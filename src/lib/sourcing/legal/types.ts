/**
 * Legal 체크 공통 타입
 */

export type LegalLayer = 'kc' | 'banned' | 'trademark' | 'season' | 'oversize' | 'category';
export type LegalSeverity = 'RED' | 'YELLOW' | 'GREEN';
export type LegalStatus = 'blocked' | 'warning' | 'safe' | 'unchecked';

export interface LegalIssue {
  layer: LegalLayer;
  severity: LegalSeverity;
  code: string;
  message: string;
  detail: Record<string, unknown>;
}

/**
 * 이슈 배열로부터 최종 legal_status 결정
 * RED 하나라도 → 'blocked'
 * YELLOW 하나라도 → 'warning'
 * 나머지 → 'safe'
 */
export function resolveStatus(issues: LegalIssue[]): LegalStatus {
  if (issues.some((i) => i.severity === 'RED')) return 'blocked';
  if (issues.some((i) => i.severity === 'YELLOW')) return 'warning';
  return 'safe';
}
