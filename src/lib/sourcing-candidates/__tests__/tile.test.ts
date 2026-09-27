import { describe, it, expect } from 'vitest';
import { computeTiles, findContentEnd, TILE_HEIGHT, TILE_OVERLAP } from '@/lib/sourcing-candidates/tile';

describe('computeTiles', () => {
  it('상한 이하면 한 장', () => {
    expect(computeTiles(2000)).toEqual([{ top: 0, height: 2000 }]);
  });
  it('찜질 캡처(빈칸 제거 후 4,456px) → 2장, 600px 겹침', () => {
    expect(computeTiles(4456)).toEqual([
      { top: 0, height: 2576 },
      { top: 1976, height: 2480 },
    ]);
  });
  it('도마 캡처(6,755px) → 4장, 끝까지 덮는다', () => {
    const tiles = computeTiles(6755);
    expect(tiles.map((t) => t.top)).toEqual([0, 1976, 3952, 5928]);
    const last = tiles[tiles.length - 1];
    expect(last.top + last.height).toBe(6755);
  });
  it('겹침은 카드 한 칸(약 430px)보다 크다', () => {
    expect(TILE_OVERLAP).toBeGreaterThan(430);
    expect(TILE_HEIGHT).toBe(2576);
  });
});

describe('findContentEnd', () => {
  it('마지막 내용 줄 + 여백', () => {
    const blank = [false, false, true, false, ...Array(100).fill(true)];
    expect(findContentEnd(blank, 20)).toBe(4 + 20);
  });
  it('여백은 이미지 끝을 넘지 않는다', () => {
    expect(findContentEnd([false, false, false], 20)).toBe(3);
  });
  it('전부 빈칸이면 전체 높이', () => {
    expect(findContentEnd([true, true], 20)).toBe(2);
  });
});
