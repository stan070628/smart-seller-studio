// src/lib/detail-page/layout-image-blocks.ts
//
// claude_layout 섹션의 이미지 렌더링 정합성 유틸.
//
// 렌더러(section-renderer.ts renderClaudeLayout)는 attachedImages(슬롯)를 직접
// 그리지 않고, content.blocks 안의 { type:'image', attachedIndex:N } 블록으로만
// 그린다. attachedIndex가 섹션 attachedImages 범위를 벗어나면 무음 드롭된다.
// 따라서 "섹션 이미지 개수 ↔ image 블록"의 정합성을 코드로 보장해야
// 첫 섹션 외 나머지 슬롯 이미지도 미리보기·상세에 반영된다.

import type { LayoutBlock } from '@/types/detail-page';

/**
 * option_grid가 "이미지 캐리어"인지 — 카드마다 이미지를 직접 그리는지 판정한다.
 *
 * 개수가 정확히 일치할 때만 캐리어로 본다. 이미지가 카드보다 적으면 앞쪽 카드에만
 * 이미지가 박혀 그리드가 비대칭이 되므로(사이즈 안내 씬에서 실제로 발생), 그 경우는
 * 캐리어가 아니라고 보고 전 카드를 텍스트로 통일한다 — 전부 아니면 전무.
 *
 * 렌더러(section-renderer.ts option_grid)와 normalizeImageBlocks가 반드시 같은
 * 조건을 봐야 카드 이미지와 대형 image 블록의 중복/누락이 생기지 않는다.
 */
export function isOptionGridCarrier(block: LayoutBlock, imageCount: number): boolean {
  return (
    block.type === 'option_grid' &&
    imageCount > 0 &&
    Array.isArray(block.items) &&
    block.items.length === imageCount
  );
}

/** blocks(columns 중첩 포함)에서 image 블록을 모두 제거 */
function stripImageBlocks(blocks: LayoutBlock[]): LayoutBlock[] {
  const out: LayoutBlock[] = [];
  for (const b of blocks) {
    if (b.type === 'image') continue;
    if (b.type === 'columns') {
      out.push({ ...b, cols: b.cols.map((col) => stripImageBlocks(col)) });
      continue;
    }
    out.push(b);
  }
  return out;
}

/** blocks(columns 중첩 포함)에서 특정 슬롯 인덱스를 참조하는 image 블록이 있는지 */
export function hasImageBlock(blocks: LayoutBlock[], idx: number): boolean {
  return blocks.some((b) => {
    if (b.type === 'image') return b.attachedIndex === idx;
    if (b.type === 'columns')
      return b.cols.some((col) =>
        col.some((inner) => inner.type === 'image' && inner.attachedIndex === idx),
      );
    return false;
  });
}

/** blocks에 해당 슬롯 image 블록이 없으면 최상단에 자동 주입 */
export function ensureImageBlock(blocks: LayoutBlock[], idx: number): LayoutBlock[] {
  if (hasImageBlock(blocks, idx)) return blocks;
  return [{ type: 'image', attachedIndex: idx, align: 'center' }, ...blocks];
}

/**
 * 섹션 blocks의 image 블록을 실제 이미지 개수에 맞춰 정규화한다.
 *  - image 블록의 attachedIndex를 등장 순서대로 0..(imageCount-1)로 리매핑/클램프
 *    → LLM이 전역 인덱스·범위 초과 값을 넣어도 무음 드롭되지 않는다.
 *  - imageCount > 0 인데 image 블록이 하나도 없으면 최상단에 image 블록 주입
 *    → image 블록 없는 섹션의 이미지 누락(첫 섹션만 반영되는 버그)을 막는다.
 *
 * imageCount === 0 이면 image 블록은 렌더 불가하므로 원본을 그대로 둔다(렌더러가 no-op).
 */
export function normalizeImageBlocks(
  blocks: LayoutBlock[] | undefined,
  imageCount: number,
): LayoutBlock[] {
  if (!Array.isArray(blocks)) return [];

  // option_grid가 카드마다 이미지를 그리는 섹션에서는 대형 image 블록이 같은 이미지를
  // 한 번 더 보여주는 중복이 된다. 주입을 건너뛰는 것만으로는 부족하다 — LLM이 직접
  // 넣은 image 블록도 함께 걷어내야 한다.
  if (blocks.some((b) => isOptionGridCarrier(b, imageCount))) return stripImageBlocks(blocks);

  let seen = 0;
  const remap = (arr: LayoutBlock[]): LayoutBlock[] =>
    arr.map((b) => {
      if (b.type === 'image') {
        const attachedIndex =
          imageCount > 0 ? Math.min(seen, imageCount - 1) : b.attachedIndex;
        seen += 1;
        return { ...b, attachedIndex };
      }
      if (b.type === 'columns') {
        return { ...b, cols: b.cols.map((col) => remap(col)) };
      }
      return b;
    });
  const remapped = remap(blocks);
  // 여기까지 왔다면 캐리어가 아니다(= 카드는 텍스트만 그린다). 이미지가 있는데 image
  // 블록이 하나도 없으면 섹션에 시각 앵커가 사라지므로 최상단에 주입한다.
  if (imageCount > 0 && seen === 0) {
    return [{ type: 'image', attachedIndex: 0, align: 'center' }, ...remapped];
  }
  return remapped;
}
