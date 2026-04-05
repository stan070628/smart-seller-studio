/**
 * Legal 체크 통합 모듈
 *
 * Layer 1 (KC) + Layer 2 (금지어) → 동기, 메인 수집 흐름에서 실행
 * Layer 3 (KIPRIS) → 비동기, 야간 배치에서 실행
 */

export { checkKcCertification } from './kc-check';
export { checkBannedKeywords } from './banned-filter';
export { checkTrademark, extractBrandCandidate } from './kipris';
export { resolveStatus } from './types';
export type { LegalIssue, LegalStatus, LegalLayer, LegalSeverity } from './types';

import { checkKcCertification } from './kc-check';
import { checkBannedKeywords } from './banned-filter';
import { resolveStatus, type LegalIssue, type LegalStatus } from './types';

/**
 * Layer 1 + Layer 2 동기 체크 (메인 수집 흐름에서 사용)
 * KIPRIS(Layer 3)는 포함하지 않음 — 별도 배치로 실행
 */
export function runSyncLegalCheck(
  title: string,
  safetyCert?: string | null,
): { status: LegalStatus; issues: LegalIssue[] } {
  const issues: LegalIssue[] = [];

  // Layer 1: KC 인증
  const kcIssue = checkKcCertification(title, safetyCert);
  if (kcIssue) issues.push(kcIssue);

  // Layer 2: 금지어
  const bannedIssues = checkBannedKeywords(title);
  issues.push(...bannedIssues);

  return {
    status: resolveStatus(issues),
    issues,
  };
}
