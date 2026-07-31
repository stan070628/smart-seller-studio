import { describe, it, expect } from 'vitest';
import {
  hasImageBlock,
  ensureImageBlock,
  normalizeImageBlocks,
} from '@/lib/detail-page/layout-image-blocks';
import type { LayoutBlock } from '@/types/detail-page';

describe('normalizeImageBlocks', () => {
  it('image 블록이 없고 이미지가 있으면 최상단에 attachedIndex:0 image 블록을 주입한다', () => {
    const blocks: LayoutBlock[] = [{ type: 'heading', text: '제목', size: 'lg' }];
    const out = normalizeImageBlocks(blocks, 1);
    expect(out[0]).toEqual({ type: 'image', attachedIndex: 0, align: 'center' });
    expect(out).toHaveLength(2);
  });

  it('attachedIndex가 범위를 벗어나면 클램프한다 (imageCount=1 → 0)', () => {
    const blocks: LayoutBlock[] = [{ type: 'image', attachedIndex: 3 }];
    const out = normalizeImageBlocks(blocks, 1);
    expect(out).toEqual([{ type: 'image', attachedIndex: 0 }]);
  });

  it('여러 image 블록을 등장 순서대로 0..len-1로 리매핑한다', () => {
    const blocks: LayoutBlock[] = [
      { type: 'image', attachedIndex: 5 },
      { type: 'heading', text: 'x', size: 'md' },
      { type: 'image', attachedIndex: 9 },
      { type: 'image', attachedIndex: 0 },
    ];
    const out = normalizeImageBlocks(blocks, 3);
    const idxs = out.filter((b): b is Extract<LayoutBlock, { type: 'image' }> => b.type === 'image').map(b => b.attachedIndex);
    expect(idxs).toEqual([0, 1, 2]);
  });

  it('image 블록 수가 이미지 수보다 많으면 마지막 인덱스로 클램프한다', () => {
    const blocks: LayoutBlock[] = [
      { type: 'image', attachedIndex: 0 },
      { type: 'image', attachedIndex: 0 },
      { type: 'image', attachedIndex: 0 },
    ];
    const out = normalizeImageBlocks(blocks, 2);
    const idxs = out.map(b => (b.type === 'image' ? b.attachedIndex : -1));
    expect(idxs).toEqual([0, 1, 1]);
  });

  it('columns 중첩 image 블록도 리매핑한다', () => {
    const blocks: LayoutBlock[] = [
      { type: 'columns', cols: [[{ type: 'image', attachedIndex: 7 }], [{ type: 'image', attachedIndex: 8 }]] },
    ];
    const out = normalizeImageBlocks(blocks, 2);
    const col = out[0] as Extract<LayoutBlock, { type: 'columns' }>;
    expect(col.cols[0][0]).toEqual({ type: 'image', attachedIndex: 0 });
    expect(col.cols[1][0]).toEqual({ type: 'image', attachedIndex: 1 });
  });

  it('imageCount가 0이면 image 블록을 주입하지 않고 원본을 유지한다', () => {
    const blocks: LayoutBlock[] = [{ type: 'heading', text: '제목', size: 'lg' }];
    const out = normalizeImageBlocks(blocks, 0);
    expect(out).toEqual(blocks);
  });

  it('이미 image 블록이 있으면 중복 주입하지 않는다', () => {
    const blocks: LayoutBlock[] = [{ type: 'image', attachedIndex: 0 }];
    const out = normalizeImageBlocks(blocks, 1);
    expect(out).toHaveLength(1);
  });

  it('option_grid가 있으면 대형 image 블록을 주입하지 않는다(카드가 이미지를 표시)', () => {
    const blocks: LayoutBlock[] = [
      { type: 'heading', text: '두 가지 컬러', size: 'lg' },
      { type: 'option_grid', items: [{ label: '베이지' }, { label: '로즈' }] },
    ];
    const out = normalizeImageBlocks(blocks, 2);
    expect(out.some(b => b.type === 'image')).toBe(false);
    expect(out).toHaveLength(2);
  });

  it('캐리어 option_grid 섹션에 남아 있는 image 블록은 중복이므로 제거한다', () => {
    const blocks: LayoutBlock[] = [
      { type: 'image', attachedIndex: 0 },
      { type: 'option_grid', items: [{ label: '베이지' }, { label: '로즈' }] },
    ];
    const out = normalizeImageBlocks(blocks, 2);
    expect(out.some(b => b.type === 'image')).toBe(false);
    expect(out).toHaveLength(1);
  });

  it('columns 안의 image 블록도 캐리어 섹션에서는 제거한다', () => {
    const blocks: LayoutBlock[] = [
      { type: 'columns', cols: [[{ type: 'image', attachedIndex: 0 }], [{ type: 'badge', text: 'NEW' }]] },
      { type: 'option_grid', items: [{ label: '베이지' }, { label: '로즈' }] },
    ];
    const out = normalizeImageBlocks(blocks, 2);
    const col = out[0] as Extract<LayoutBlock, { type: 'columns' }>;
    expect(col.cols[0]).toHaveLength(0);
    expect(col.cols[1]).toHaveLength(1);
  });

  it('카드 수와 이미지 수가 다른 option_grid는 캐리어가 아니므로 대형 image 블록을 주입한다', () => {
    // 사이즈 안내 씬: 카드 4개인데 이미지는 1장 — 카드가 이미지를 그리지 않으므로
    // 섹션의 시각 앵커는 대형 image 블록이 담당해야 한다.
    const blocks: LayoutBlock[] = [
      { type: 'heading', text: 'M · L · XL · XXL', size: 'lg' },
      { type: 'option_grid', items: [{ label: 'M' }, { label: 'L' }, { label: 'XL' }, { label: 'XXL' }] },
    ];
    const out = normalizeImageBlocks(blocks, 1);
    expect(out[0]).toEqual({ type: 'image', attachedIndex: 0, align: 'center' });
    expect(out).toHaveLength(3);
  });
});

describe('hasImageBlock / ensureImageBlock', () => {
  it('columns 중첩 image 블록을 감지한다', () => {
    const blocks: LayoutBlock[] = [
      { type: 'columns', cols: [[{ type: 'image', attachedIndex: 0 }]] },
    ];
    expect(hasImageBlock(blocks, 0)).toBe(true);
    expect(hasImageBlock(blocks, 1)).toBe(false);
  });

  it('image 블록이 없으면 주입, 있으면 그대로', () => {
    expect(ensureImageBlock([], 0)[0]).toEqual({ type: 'image', attachedIndex: 0, align: 'center' });
    const existing: LayoutBlock[] = [{ type: 'image', attachedIndex: 0 }];
    expect(ensureImageBlock(existing, 0)).toBe(existing);
  });
});
