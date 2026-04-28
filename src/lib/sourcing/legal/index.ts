/**
 * Legal 체크 통합 모듈
 *
 * Layer 1 (KC) + Layer 2 (금지어) + season + oversize + category → 동기, 메인 수집 흐름에서 실행
 * Layer 3 (KIPRIS) → 비동기, 야간 배치에서 실행
 */

export { checkKcCertification } from './kc-check';
export { checkBannedKeywords } from './banned-filter';
export { checkTrademark, extractBrandCandidate } from './kipris';
export { checkSeasonLimited } from './season-filter';
export { checkOversize } from './oversize-filter';
export { checkBlockedCategory } from './category-filter';
export { resolveStatus } from './types';
export type { LegalIssue, LegalStatus, LegalLayer, LegalSeverity } from './types';

import { checkKcCertification } from './kc-check';
import { checkBannedKeywords } from './banned-filter';
import { checkSeasonLimited } from './season-filter';
import { checkOversize } from './oversize-filter';
import { checkBlockedCategory } from './category-filter';
import { resolveStatus, type LegalIssue, type LegalStatus } from './types';

export interface SyncLegalCheckInput {
  title: string;
  safetyCert?: string | null;
  categoryName?: string | null;
}

/**
 * 동기 6 layer 체크 (메인 수집 흐름)
 * KIPRIS(Layer 3)는 별도 배치
 */
export function runSyncLegalCheck(
  input: SyncLegalCheckInput,
): { status: LegalStatus; issues: LegalIssue[] } {
  const { title, safetyCert, categoryName } = input;
  const issues: LegalIssue[] = [];

  const kcIssue = checkKcCertification(title, safetyCert);
  if (kcIssue) issues.push(kcIssue);

  const bannedIssues = checkBannedKeywords(title);
  issues.push(...bannedIssues);

  const seasonIssue = checkSeasonLimited(title);
  if (seasonIssue) issues.push(seasonIssue);

  const oversizeIssue = checkOversize(title);
  if (oversizeIssue) issues.push(oversizeIssue);

  const categoryIssue = checkBlockedCategory(categoryName);
  if (categoryIssue) issues.push(categoryIssue);

  return {
    status: resolveStatus(issues),
    issues,
  };
}
