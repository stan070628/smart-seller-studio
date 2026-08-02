// src/lib/detail-page/image-usage.ts
//
// 업로드한 제품 이미지가 생성된 레이아웃에서 실제로 쓰였는지 집계한다.
//
// 왜 필요한가: 2026-08-02 나이키 다저스 티셔츠 실사용에서 업로드한 제품 사진 4장 중
// 블루 앞면이 한 번도 쓰이지 않았고, 화이트 앞면이 두 번 중복으로 들어갔다.
// 셀러가 결과 페이지를 끝까지 훑어보지 않으면 알 수 없다 — 검출 로직이 아예 없었다.
//
// 왜 warning인가: 미사용 자체가 결함은 아니다. 8장을 올리고 6장만 쓰는 편집 판단은
// 정상이다. 다만 "올렸는데 빠졌다"를 모르고 넘어가는 것이 손실이므로 알리기만 한다.
//
// imageRef의 의미는 product-options.ts와 같다 — productImages 배열의 0-based 인덱스.

/** 집계에 필요한 만큼만 좁힌 섹션 형태 */
export interface ImageUsageSection {
  imageSlots?: Array<{ imageRef?: number } | null | undefined>;
}

export interface ImageUsage {
  /** 업로드 이미지 인덱스 → 등장 횟수 (0회 포함) */
  counts: Map<number, number>;
  /** 한 번도 쓰이지 않은 인덱스 */
  unused: number[];
  /** 2회 이상 쓰인 인덱스 */
  duplicated: number[];
  /** imageRef가 업로드 범위 밖을 가리킨 슬롯 수 */
  outOfRange: number;
}

export function collectImageUsage(
  sections: ImageUsageSection[],
  productImageCount: number,
): ImageUsage {
  const counts = new Map<number, number>();
  for (let i = 0; i < productImageCount; i++) counts.set(i, 0);

  let outOfRange = 0;

  for (const sec of sections ?? []) {
    for (const slot of sec?.imageSlots ?? []) {
      const ref = slot?.imageRef;
      // imageRef가 없는 슬롯은 AI 생성 이미지가 채우는 자리다. 미사용 판정과 무관하다.
      if (typeof ref !== 'number' || !Number.isInteger(ref)) continue;
      if (ref < 0 || ref >= productImageCount) {
        outOfRange++;
        continue;
      }
      counts.set(ref, (counts.get(ref) ?? 0) + 1);
    }
  }

  const unused: number[] = [];
  const duplicated: number[] = [];
  for (const [idx, n] of counts) {
    if (n === 0) unused.push(idx);
    else if (n >= 2) duplicated.push(idx);
  }
  unused.sort((a, b) => a - b);
  duplicated.sort((a, b) => a - b);

  return { counts, unused, duplicated, outOfRange };
}

/** 사람이 세는 번호는 1부터다. "1번째, 3번째" */
function toLabels(indices: number[], names: string[]): string {
  return indices
    .map((i) => {
      const name = (names[i] ?? '').trim();
      return name ? `${i + 1}번째(${name})` : `${i + 1}번째`;
    })
    .join(', ');
}

/**
 * 미사용·중복 이미지를 셀러 문구로 만든다.
 *
 * optionNames는 있으면 라벨에 붙인다 — "3번째"보다 "3번째(블루)"가 어느 사진인지
 * 바로 알 수 있다. 없으면 번호만 쓴다.
 *
 * 중복은 미사용이 함께 있을 때만 알린다. 같은 사진을 의도적으로 두 번 배치하는 것은
 * 정상 편집이고, 문제가 되는 상황은 "쓸 사진이 남았는데 있는 걸 또 썼다"이다.
 */
export function imageUsageWarnings(
  sections: ImageUsageSection[],
  productImageCount: number,
  optionNames: string[] = [],
): string[] {
  if (productImageCount <= 0) return [];

  const { unused, duplicated, outOfRange } = collectImageUsage(sections, productImageCount);
  const warnings: string[] = [];

  if (unused.length > 0) {
    const used = productImageCount - unused.length;
    warnings.push(
      `업로드한 제품 이미지 ${productImageCount}장 중 ${used}장만 사용되었습니다. ` +
      `미사용: ${toLabels(unused, optionNames)}. 필요하면 결과 화면에서 직접 배치하세요.`,
    );
    if (duplicated.length > 0) {
      warnings.push(
        `같은 이미지가 두 번 이상 쓰였습니다 — ${toLabels(duplicated, optionNames)}. ` +
        `미사용 이미지로 교체하면 페이지가 덜 반복됩니다.`,
      );
    }
  }

  if (outOfRange > 0) {
    warnings.push(
      `없는 이미지를 가리키는 슬롯이 ${outOfRange}개 있습니다. 해당 자리는 비어 보일 수 있습니다.`,
    );
  }

  return warnings;
}
