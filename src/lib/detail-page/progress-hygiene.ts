/**
 * progress_bar 수치 위생.
 *
 * 렌더러(section-renderer.ts)는 displayValue가 없으면 바 길이를 `${pct}%`로 그대로 찍는다.
 * 따라서 근거 없는 수치를 방치하면 지어낸 숫자가 화면에 노출된다.
 *
 * 형식 검사로는 막을 수 없다 — "92%"는 형식상 완벽히 유효하다.
 * 판정 기준은 출처다: displayValue의 숫자가 상품 입력에 실제로 등장해야 한다.
 *
 * 이 모듈이 보증하지 않는 것: displayValue의 출처만 검증하며 바 길이(`value`,
 * 0~100 스케일)는 손대지 않는다. 근거가 있는 "180g"도 임의의 `value`로 그려질 수
 * 있다 — 바 길이 자체의 정직성은 이 모듈의 책임 밖이다.
 */

export interface ProgressItem {
  label?: string;
  value?: number;
  displayValue?: string;
  highlight?: boolean;
}

/** 숫자 토큰(정수·소수)을 뽑는다 */
const NUM_TOKEN = /\d+(?:\.\d+)?/g;
/** 퍼센트 토큰("숫자%", 공백 허용) — 단위까지 포함해 완전일치로 대조한다 */
const PCT_TOKEN = /\d+(?:\.\d+)?\s*%/g;

/** 문자열에서 숫자 토큰 집합을 만든다 */
function numberSet(text: string): Set<string> {
  return new Set(text.match(NUM_TOKEN) ?? []);
}

/** 문자열에서 퍼센트 토큰 집합을 만든다 (내부 공백 제거 후 정규화) */
function percentSet(text: string): Set<string> {
  return new Set((text.match(PCT_TOKEN) ?? []).map((p) => p.replace(/\s/g, '')));
}

/**
 * displayValue의 모든 숫자가 입력 원천에 등장하는지 판정한다.
 *
 * 완전일치만 인정한다 — 단위 환산(0.18kg vs 180g)과 반올림은 대조 실패로 본다.
 * 부분일치 정규식이 오탐을 낸 선례가 있어(커밋 5b0a49ba) 집합 완전일치를 쓴다.
 *
 * 미탐(지어낸 수치를 통과)은 0이 아니다 — 구조적으로 줄어들 뿐이다. 한국 의류
 * 입력의 숫자 대역(사이즈 95/100/105/110, 총장 70cm, 혼용률 100%)이 progress_bar가
 * 지어내는 0~100 퍼센트 대역과 겹치기 때문에, 순수 숫자 대조만으로는 "가슴둘레
 * 95cm"가 지어낸 "신축성 95%"를 정당화해버린다. 그래서 퍼센트는 숫자만이 아니라
 * "숫자%" 형태 자체가 입력에 등장해야 하는 별도 검사를 추가한다 — `%`로 좁힌 이유는
 * 한국어 접미사를 일반적으로 매칭하려 들면 커밋 5b0a49ba의 실패(부분일치가 "개월"
 * 등을 "개"로 오인)를 반복하기 때문이다. 그 외 단위(배·초·g 등)는 여전히 숫자만
 * 보므로 "3배 빠름"처럼 입력에 같은 숫자가 다른 단위로 존재하면 통과한다 — 알려진
 * 한계다.
 *
 * 오탐(정당한 수치를 제거) 사례 하나: 소스가 "30~40% 신축"처럼 범위 표기면
 * PCT_TOKEN이 "40%"만 토큰화하고 "30"은 숫자로만 남아 퍼센트로 인식되지 않는다.
 * 그 결과 displayValue "30%"는 차단되고 "40%"는 통과한다 — 소스의 30도 의미상
 * 퍼센트인데 표기상 단위가 붙어있지 않아서다. 한국 상품 텍스트에서 범위 표기가
 * 흔해 실제로 발생하는 한계지만, 과잉 제거(오탐) 방향이라 이 모듈이 미탐보다
 * 오탐을 택하는 편향과 일치하므로 고치지 않는다.
 *
 * 부수 한계: 콤마가 포함된 숫자("1,000회")는 콤마에서 끊겨 {"1","000"}으로
 * 쪼개진다 — "1"은 가장 충돌하기 쉬운 토큰이라 오염 가능성이 있다.
 */
export function isGroundedProgressItem(item: ProgressItem, sourceText: string): boolean {
  const display = (item?.displayValue ?? '').trim();
  if (display === '') return false;
  const source = sourceText ?? '';

  const nums = display.match(NUM_TOKEN);
  // 숫자가 없는 정성 표현("높음", "Omni-Wick")은 근거로 볼 수 없다
  if (!nums || nums.length === 0) return false;
  // source는 토큰과 무관하게 고정이므로 루프 밖에서 한 번만 계산한다
  // (호이스팅 전엔 숫자 토큰마다 source 전체를 재스캔해 Set을 다시 만들었다).
  const sourceNums = numberSet(source);
  if (!nums.every((n) => sourceNums.has(n))) return false;

  // 퍼센트는 그 자체로 비율 주장이다 — 숫자만 일치해서는 안 되고 "숫자%" 형태로
  // 입력에 등장해야 한다.
  const displayPcts = display.match(PCT_TOKEN);
  if (displayPcts && displayPcts.length > 0) {
    const srcPcts = percentSet(source);
    const normalized = displayPcts.map((p) => p.replace(/\s/g, ''));
    if (!normalized.every((p) => srcPcts.has(p))) return false;
  }

  return true;
}

/**
 * blocks 배열의 progress_bar를 위생 처리한다.
 *
 * topLevel이면 2개 미만일 때 items를 비워 pruneBlocks가 제거하게 하고,
 * cols 안(topLevel=false)이면 pruneBlocks가 닿지 않으므로 블록을 직접 뺀다.
 *
 * cleanStatBlocks(layout-validator.ts:150~182)와 동일한 규약(3가지: cols 재귀,
 * topLevel 분기, "필터링이 실제로 일어난 경우에만" 2개 미만 규칙)을 따른다 — 이 함수를
 * 고칠 때는 cleanStatBlocks도 같은 규약이 깨지지 않았는지 함께 확인할 것. 자동으로
 * 강제되지 않으므로 리뷰 시 수동 대조가 필요하다.
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

/**
 * 섹션의 progress_bar를 위생 처리한다.
 *
 * 반드시 pruneBlocks보다 앞에서 호출해야 한다 — 이 함수는 근거 없는 progress_bar를
 * items:[] 로 비우기만 하고, 그 빈 블록을 실제로 제거하는 것은 pruneBlocks의
 * 책임이다. 순서를 바꾸면 빈 progress_bar 블록이 렌더까지 그대로 간다.
 */
export function sanitizeProgressBars(sec: unknown, sourceText: string): unknown {
  if (!sec || typeof sec !== 'object') return sec;
  const s = { ...(sec as Record<string, unknown>) };
  if (!Array.isArray(s.blocks)) return s;
  s.blocks = cleanProgressBlocks(s.blocks as unknown[], true, sourceText);
  return s;
}
