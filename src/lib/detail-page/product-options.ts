// src/lib/detail-page/product-options.ts
//
// PRO 상세페이지의 상품 옵션(색상·모델) 도출과 커버리지 집계.
// 옵션은 업로드 이미지에 붙는 이름이며, 섹션이 쓰는 옵션은
// imageSlots[].imageRef가 가리키는 이미지에서 역산한다.

/** 옵션명이 붙은 제품 이미지 한 장 */
export interface ProductOption {
  /** 판매자가 입력한 옵션명. 예: "화이트" */
  name: string;
  /** productImages 배열 인덱스 (0-based) */
  imageIndex: number;
}

/** 커버리지 집계에 필요한 만큼만 좁힌 섹션 형태 */
export interface OptionSection {
  blocks?: Array<{ type?: string; items?: unknown[] } | null | undefined>;
  imageSlots?: Array<{ imageRef?: number }>;
}

export interface OptionCoverage {
  /** 비교 섹션 개수 */
  compareSectionCount: number;
  /** 옵션명 → 비교 섹션 밖 imageSlot 등장 횟수 (0회 옵션도 포함) */
  counts: Map<string, number>;
  /** 집계 대상 슬롯 총수 (비교 섹션 제외) */
  total: number;
  /** imageRef가 없거나 이름 없는 인덱스를 가리킨 슬롯 수 */
  unresolvedSlots: number;
}

const MAX_NAME_LENGTH = 40;

/**
 * optionNames[i]는 productImages[i]의 옵션명. 빈 문자열은 미지정.
 * 중복을 접지 않는다 — 블랙 사진이 2장이면 두 항목이 남아야
 * imageRef=2인 슬롯도 블랙으로 역산된다.
 */
export function deriveOptions(optionNames: string[]): ProductOption[] {
  return optionNames
    .map((name, imageIndex) => ({
      name: (name ?? '').trim().slice(0, MAX_NAME_LENGTH),
      imageIndex,
    }))
    .filter((o) => o.name !== '');
}

/** 고유 옵션명. 입력 순서 유지 */
export function uniqueOptionNames(options: ProductOption[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of options) {
    if (seen.has(o.name)) continue;
    seen.add(o.name);
    out.push(o.name);
  }
  return out;
}

/** 고유 옵션명이 2개 이상이면 옵션 모드 */
export function isOptionMode(options: ProductOption[]): boolean {
  return uniqueOptionNames(options).length >= 2;
}

/** imageIndex → 옵션명 (이름이 붙은 모든 인덱스를 담는다) */
export function optionNameByImageIndex(options: ProductOption[]): Map<number, string> {
  return new Map(options.map((o) => [o.imageIndex, o.name]));
}

/**
 * 옵션 비교 섹션인지 판정한다.
 * option_grid 존재만으로는 부족하다 — 사이즈 안내도 option_grid이므로
 * 슬롯 수가 옵션 수와 같고 items 수와도 같아야 비교 섹션으로 본다.
 */
export function isCompareSection(section: OptionSection, optionCount: number): boolean {
  const slots = section.imageSlots ?? [];
  if (slots.length !== optionCount) return false;
  const grid = (section.blocks ?? []).find((b) => b?.type === 'option_grid');
  if (!grid) return false;
  return Array.isArray(grid.items) && grid.items.length === slots.length;
}

/**
 * 비교 섹션을 제외한 이미지 슬롯에서 옵션별 등장 횟수를 센다.
 * 비교 섹션을 포함하면 그 섹션의 균등한 1:1이 나머지 편중을 가려버린다.
 */
export function collectOptionCoverage(
  sections: OptionSection[],
  nameByImageIndex: Map<number, string>,
): OptionCoverage {
  const optionNames = [...new Set(nameByImageIndex.values())];
  const counts = new Map<string, number>(optionNames.map((n) => [n, 0]));

  let compareSectionCount = 0;
  let total = 0;
  let unresolvedSlots = 0;

  for (const section of sections) {
    const slots = section?.imageSlots ?? [];
    if (slots.length === 0) continue;

    if (isCompareSection(section, optionNames.length)) {
      compareSectionCount++;
      continue;
    }

    for (const slot of slots) {
      total++;
      const name =
        typeof slot?.imageRef === 'number' ? nameByImageIndex.get(slot.imageRef) : undefined;
      if (name === undefined) {
        unresolvedSlots++;
        continue;
      }
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  return { compareSectionCount, counts, total, unresolvedSlots };
}
