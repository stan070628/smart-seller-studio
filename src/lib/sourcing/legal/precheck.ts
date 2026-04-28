/**
 * 1688 발주 사전체크 — checkTrademark 결과를 RED 차단으로 격상
 *
 * 채널 spec v2 §6.2: "등록상표 발견 시 빨간 배너 + 발주 차단"
 * cron 배치(YELLOW)와 분리된 컨텍스트로 동작.
 */

import { checkTrademark } from './kipris';
import type { LegalIssue } from './types';

export type PrecheckStatus = 'safe' | 'warning' | 'blocked';

export interface TrademarkPrecheckResult {
  status: PrecheckStatus;
  issue: LegalIssue | null;
  canProceed: boolean;
  brandCandidate: string | null;
}

export async function precheckTrademark(title: string): Promise<TrademarkPrecheckResult> {
  const issue = await checkTrademark(title);

  if (!issue) {
    return { status: 'safe', issue: null, canProceed: true, brandCandidate: null };
  }

  // TRADEMARK_CAUTION (등록상표) → RED 격상, 차단
  if (issue.code === 'TRADEMARK_CAUTION') {
    const escalated: LegalIssue = {
      ...issue,
      severity: 'RED',
      code: 'TRADEMARK_BLOCK',
      message: issue.message.replace('등록상표 발견', '[발주차단] 등록상표 충돌'),
    };
    return {
      status: 'blocked',
      issue: escalated,
      canProceed: false,
      brandCandidate: (issue.detail as { word?: string }).word ?? null,
    };
  }

  // TRADEMARK_PENDING → YELLOW 유지, 진행 가능 (사용자 판단)
  return {
    status: 'warning',
    issue,
    canProceed: true,
    brandCandidate: (issue.detail as { word?: string }).word ?? null,
  };
}
