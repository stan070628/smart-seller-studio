// src/lib/ai/repair-pro-layout.ts
import { callClaude } from '@/lib/ai/claude-cli';
import { extractJsonArray } from '@/lib/ai/json-extract';
import { DETAIL_PAGE_PERSONA, BLOCK_TYPE_RUBRIC } from '@/lib/ai/detail-page-rubric';
import type { Violation } from '@/lib/detail-page/layout-validator';

const REPAIR_SYSTEM = `${DETAIL_PAGE_PERSONA}

You are reviewing an ALREADY-GENERATED mobile detail-page layout (a JSON array of "claude_layout" sections).
Your job: fix problems and return the corrected JSON array only.

${BLOCK_TYPE_RUBRIC}

REVIEW CHECKLIST:
1. Fix every issue in the ISSUES list below.
2. Verify each block type fits its content per the rules above; reassign wrong types (예: 사이즈를 process_flow로 만든 경우 반드시 option_grid로 교체).
3. Rewrite any Chinese characters into Korean — never delete text leaving a broken sentence.
4. Keep all valid content and structure unchanged. If a section is already correct, return it unchanged.
5. 옵션 편중(option_coverage) 이슈가 있으면 imageSlots[].imageRef를 재배정해 옵션을 고르게 만든다. 단 섹션 내용과 옵션이 충돌하면 내용을 우선하고 다른 섹션에서 균형을 맞춘다. 비교 섹션(option_compare)은 옵션당 imageSlot 1개를 유지한다.

Return ONLY the corrected JSON array — no explanation, no code fences.`;

export interface RepairProductInfo {
  name: string;
  points: string[];
  category: string;
  /** 옵션 모드일 때만. 예: ['이미지 0 = "화이트"', '이미지 1 = "블랙"'] */
  optionLines?: string[];
}

/**
 * 생성된 레이아웃을 Claude(Sonnet)로 리뷰·수리한다.
 * 호출/파싱 실패 시 원본 sections를 그대로 반환한다(상위 폴백이 처리).
 */
export async function repairProLayout(
  sections: unknown[],
  violations: Violation[],
  productInfo: RepairProductInfo,
): Promise<unknown[]> {
  const issuesText = violations.length > 0
    ? violations.map((v) => `- [${v.code}] ${v.path}: ${v.message}`).join('\n')
    : '(no deterministic issues found — still verify block-type appropriateness per the rubric)';

  const userPrompt = [
    `Product: "${productInfo.name}"`,
    productInfo.category ? `Category: ${productInfo.category}` : '',
    productInfo.points.length > 0 ? `Key points:\n${productInfo.points.map((p) => `- ${p}`).join('\n')}` : '',
    productInfo.optionLines && productInfo.optionLines.length > 0
      ? `옵션(색상/모델): ${productInfo.optionLines.join(', ')}`
      : '',
    `ISSUES:\n${issuesText}`,
    `CURRENT LAYOUT JSON:\n${JSON.stringify(sections)}`,
  ].filter(Boolean).join('\n\n');

  let text: string;
  try {
    text = await callClaude(REPAIR_SYSTEM, userPrompt, 'sonnet', 16000);
  } catch (_e) {
    return sections;
  }

  const jsonStr = extractJsonArray(text);
  if (!jsonStr) return sections;
  try {
    const repaired = JSON.parse(jsonStr) as unknown[];
    return Array.isArray(repaired) && repaired.length > 0 ? repaired : sections;
  } catch {
    return sections;
  }
}
