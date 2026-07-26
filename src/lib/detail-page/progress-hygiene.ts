/**
 * progress_bar 수치 위생.
 *
 * 렌더러(section-renderer.ts)는 displayValue가 없으면 바 길이를 `${pct}%`로 그대로 찍는다.
 * 따라서 근거 없는 수치를 방치하면 지어낸 숫자가 화면에 노출된다.
 *
 * 형식 검사로는 막을 수 없다 — "92%"는 형식상 완벽히 유효하다.
 * 판정 기준은 출처다: displayValue의 숫자가 상품 입력에 실제로 등장해야 한다.
 */

export interface ProgressItem {
  label?: string;
  value?: number;
  displayValue?: string;
  highlight?: boolean;
}

/** 숫자 토큰(정수·소수)을 뽑는다 */
const NUM_TOKEN = /\d+(?:\.\d+)?/g;

/** 문자열에서 숫자 토큰 집합을 만든다 */
function numberSet(text: string): Set<string> {
  return new Set(text.match(NUM_TOKEN) ?? []);
}

/**
 * displayValue의 모든 숫자가 입력 원천에 등장하는지 판정한다.
 *
 * 완전일치만 인정한다 — 단위 환산(0.18kg vs 180g)과 반올림은 대조 실패로 본다.
 * 오탐(정당한 수치를 제거)은 감수하고 미탐(지어낸 수치를 통과)을 0으로 만드는 선택이다.
 * 부분일치 정규식이 오탐을 낸 선례가 있어(커밋 5b0a49ba) 집합 완전일치를 쓴다.
 */
export function isGroundedProgressItem(item: ProgressItem, sourceText: string): boolean {
  const display = (item?.displayValue ?? '').trim();
  if (display === '') return false;

  const nums = display.match(NUM_TOKEN);
  // 숫자가 없는 정성 표현("높음", "Omni-Wick")은 근거로 볼 수 없다
  if (!nums || nums.length === 0) return false;

  const source = numberSet(sourceText ?? '');
  return nums.every((n) => source.has(n));
}

/**
 * blocks 배열의 progress_bar를 위생 처리한다.
 *
 * topLevel이면 2개 미만일 때 items를 비워 pruneBlocks가 제거하게 하고,
 * cols 안(topLevel=false)이면 pruneBlocks가 닿지 않으므로 블록을 직접 뺀다.
 * cleanStatBlocks(layout-validator.ts)와 동일한 규약이다.
 */
export function cleanProgressBlocks(
  blocks: unknown[],
  topLevel: boolean,
  sourceText: string,
): unknown[] {
  const out: unknown[] = [];

  for (const b of blocks) {
    if (!b || typeof b !== 'object') {
      out.push(b);
      continue;
    }
    const block = { ...(b as Record<string, unknown>) };

    if (Array.isArray(block.cols)) {
      const cols = (block.cols as unknown[])
        .map((col) => (Array.isArray(col) ? cleanProgressBlocks(col, false, sourceText) : col))
        .filter((col) => !Array.isArray(col) || col.length > 0);
      if (cols.length === 0) continue; // 모든 컬럼이 비면 columns 자체를 드롭
      block.cols = cols;
    }

    if (block.type === 'progress_bar' && Array.isArray(block.items)) {
      const original = block.items as ProgressItem[];
      const kept = original.filter(
        (it) => it && typeof it === 'object' && isGroundedProgressItem(it, sourceText),
      );
      // 위생의 목적은 잡음 제거지 구조 개편이 아니다 —
      // 필터링이 실제로 일어난 경우에만 2개 미만 규칙을 적용한다.
      if (kept.length < 2 && kept.length < original.length) {
        if (!topLevel) continue; // cols 안: 블록 자체 제거
        block.items = [];        // 최상위: pruneBlocks가 제거
      } else {
        block.items = kept;
      }
    }

    out.push(block);
  }

  return out;
}

/** 섹션의 progress_bar를 위생 처리한다 */
export function sanitizeProgressBars(sec: unknown, sourceText: string): unknown {
  if (!sec || typeof sec !== 'object') return sec;
  const s = { ...(sec as Record<string, unknown>) };
  if (!Array.isArray(s.blocks)) return s;
  s.blocks = cleanProgressBlocks(s.blocks as unknown[], true, sourceText);
  return s;
}
