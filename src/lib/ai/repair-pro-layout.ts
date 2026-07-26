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
4. Keep all valid content unchanged. If a section is already correct, return it unchanged.
   Section ORDER may be changed ONLY when fixing a narrative issue (rule 7).
   기존 섹션의 imageSlots에 슬롯을 추가하는 것은 rule 8에서 허용된다.
5. 옵션 편중(option_coverage) 이슈가 있으면 imageSlots[].imageRef를 재배정해 옵션을 고르게 만든다. 단 섹션 내용과 옵션이 충돌하면 내용을 우선하고 다른 섹션에서 균형을 맞춘다. 비교 섹션(option_compare)은 옵션당 imageSlot 1개를 유지한다.
6. 모든 섹션은 beat 필드를 가져야 한다. beat 값은 다음 중 하나다:
   hook, problem, solution, compare, evidence, detail, usecase, option, assure
   beat 필드를 절대 삭제하지 마라. 없거나 위 9개 중에 없는 값(오탈자·새로 만든 값)이면
   섹션 내용을 보고 알맞은 값으로 채우거나 교체하라.
   hook=첫 화면 / problem=기존 방식의 불편 / solution=우리 제품의 해법
   compare=기존 방식 대비 우위 / evidence=관찰 가능한 근거 / detail=물리적 마감·소재
   usecase=사용 상황 / option=색상·사이즈 선택지 / assure=세탁·보관·제품정보
7. narrative 이슈가 있으면 다음을 고쳐라. hook_first는 error라 단독으로도 repair를
   트리거하고, assure_tail은 warning이라 단독으로는 트리거하지 않지만 다른 error와
   함께 발생하면(흔한 경우) repair가 돌 때 이 지시도 함께 전달된다 — 그래서 둘 다
   "없으면 새로 만든다"까지 명시한다. 새 섹션을 만들 때는 배열 끝에 붙이지 말고
   서사 흐름에 맞는 자리에 넣는다 — solution은 problem 바로 다음, compare는 solution
   다음(solution이 없으면 detail 다음)에 둔다:
   - 첫 섹션의 beat가 hook이 아니면: 다른 곳에 hook 섹션이 있으면 맨 앞으로 옮기고,
     hook 섹션이 아예 없으면 첫 섹션의 beat를 hook으로 바꾸거나(내용이 도입부에 맞으면)
     hook 섹션을 새로 만들어 맨 앞에 둔다.
   - compare 섹션이 없으면 하나를 만든다. columns 블록으로 2단 대비 구조를 쓰고
     (좌: 기존 방식의 한계 / 우: 우리 제품), 배수·퍼센트·순위 표현은 쓰지 않는다.
     특정 경쟁사·브랜드를 지목하지 말고 카테고리 공지의 사실만 다룬다.
   - beat=compare인데 columns 2단이 없으면 columns 구조로 다시 쓴다.
   - compare 섹션에 배수(예: "3배")·순위(예: "업계 1위")·우위 표현과 결합된 퍼센트
     (예: "40% 향상", "대비 20% 증가")가 있으면 그 표현을 지우고 카테고리 공지의
     사실 진술로 바꾼다. 조성비·함량 표현(예: "면 60%")은 그대로 둔다.
   - problem이 있는데 solution이 없으면 solution 섹션을 추가한다.
   - assure 섹션을 마지막 3개 섹션 안으로 옮긴다. assure 섹션이 아예 없으면
     세탁·보관·제품정보를 담은 assure 섹션을 만들어 끝에 둔다.
8. wearing_coverage 이슈가 있으면 다음을 고쳐라.
   - model_wearing 슬롯을 가진 섹션이 1개뿐이면 다른 섹션의 imageSlots에 하나를
     추가한다. 새 섹션을 만들지 마라 — 섹션 수 상한을 넘길 수 있다.
   - 그 섹션에 flux_lifestyle이나 detail_closeup이 이미 있으면 다른 섹션을 고르거나,
     model_wearing을 imageSlots 배열의 첫 번째로 옮겨라. 섹션당 AI 씬은 첫 슬롯
     하나만 생성된다.
   - 기존 것이 faceVisible: true면 새것은 false로(detail 또는 evidence 비트 섹션에),
     기존 것이 false면 새것은 true로(hook 또는 usecase 비트 섹션에) 둔다.
     faceVisible을 생략하지 마라 — 생략하면 두 컷이 모두 얼굴 컷이 된다.
   - 두 씬의 promptHint가 겹치면 안 된다. 기존 슬롯을 삭제하지 마라.
   - promptHint에는 상황만 쓴다. 모델 외형·프레이밍·조명·포즈는 시스템이 붙인다.

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
