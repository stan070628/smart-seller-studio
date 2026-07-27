/**
 * 섹션 모양 검사 — 시각 앵커 유무와 헤드라인 수량 일치.
 *
 * 둘 다 프롬프트에는 규칙이 있는데 검사가 없어 그냥 통과하던 것들이다.
 * layout-validator.ts에서 쓰지만, 판정 로직만 떼어 두면 테스트가 쉽고
 * 검증 루프가 더 길어지지 않는다.
 */

/**
 * 이 블록이 있으면 그 섹션은 "볼 것이 있다"고 본다.
 *
 * D2가 허용하는 범위(이미지·차트·stat·아이콘)에 표·옵션 카드·단계 흐름을 더했다.
 * 셋 다 화면에서 덩어리로 보여 텍스트 벽을 깨는 역할을 실제로 한다.
 * bullet_list는 넣지 않는다 — 불릿만 있는 섹션이 바로 문제 상황이다.
 */
const ANCHOR_TYPES: ReadonlySet<string> = new Set([
  'image',
  'stat_row',
  'icon_grid',
  'option_grid',
  'process_flow',
  'progress_bar',
  'layout_bar_chart',
  'radar_chart',
  'timeline',
  'spec_table',
]);

/** 섹션(또는 columns 안)에 시각 앵커가 하나라도 있는가 */
export function hasVisualAnchor(blocks: unknown): boolean {
  if (!Array.isArray(blocks)) return false;
  for (const b of blocks) {
    if (!b || typeof b !== 'object') continue;
    const block = b as Record<string, unknown>;
    if (typeof block.type === 'string' && ANCHOR_TYPES.has(block.type)) return true;
    if (Array.isArray(block.cols) && block.cols.some(hasVisualAnchor)) return true;
  }
  return false;
}

const KO_NUMBERS: Record<string, number> = {
  한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10,
};

/**
 * 헤드라인이 선언한 항목 수. 없으면 null.
 *
 * "가지"로만 센다. "개"·"매"는 항목 수가 아니라 제품 구성을 뜻하는 경우가 훨씬
 * 많아서다 — "2매 세트", "3개 구성"은 불릿 개수와 무관하다. 반면 "두 가지만",
 * "세 가지 이유"는 거의 항상 그 섹션이 나열할 것의 개수를 말한다.
 */
export function declaredCount(heading: string): number | null {
  if (typeof heading !== 'string') return null;
  const digit = /([0-9]+)\s*가지/.exec(heading);
  if (digit) return Number(digit[1]);
  const ko = /(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*가지/.exec(heading);
  if (ko) return KO_NUMBERS[ko[1]!] ?? null;
  return null;
}

/**
 * 섹션이 실제로 나열한 항목 수. 셀 것이 없으면 null.
 *
 * 여러 목록이 섞여 있으면 가장 큰 것을 쓴다 — 헤드라인이 가리키는 게 어느
 * 목록인지 알 수 없고, 작은 쪽을 고르면 "네 가지"에 불릿 4 + 카드 2가 있을 때
 * 거짓 불일치가 난다.
 */
export function countedItems(blocks: unknown): number | null {
  let max: number | null = null;
  const bump = (n: number) => { if (n > 0) max = Math.max(max ?? 0, n); };

  const walk = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const b of list) {
      if (!b || typeof b !== 'object') continue;
      const block = b as Record<string, unknown>;
      if (Array.isArray(block.items)) bump(block.items.length);
      if (block.type === 'spec_table' && Array.isArray(block.rows)) bump(block.rows.length);
      if (Array.isArray(block.cols)) for (const col of block.cols) walk(col);
    }
  };
  walk(blocks);
  return max;
}

/** 헤드라인이 선언한 수와 실제 항목 수가 어긋나면 그 쌍을 반환한다. */
export function countMismatch(
  heading: string,
  blocks: unknown,
): { declared: number; actual: number } | null {
  const declared = declaredCount(heading);
  if (declared === null) return null;
  const actual = countedItems(blocks);
  if (actual === null) return null;
  return declared === actual ? null : { declared, actual };
}
