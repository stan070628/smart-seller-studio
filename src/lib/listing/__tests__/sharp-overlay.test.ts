// @vitest-environment node

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  measureTextWidth,
  fitFontSize,
  composeOverlay,
  type OverlayBlock,
} from '@/lib/listing/sharp-overlay';

describe('measureTextWidth', () => {
  it('한국어 문자열의 픽셀 폭을 양수로 반환한다', () => {
    const w = measureTextWidth('테스트', 16);
    expect(w).toBeGreaterThan(0);
  });

  it('폰트 크기가 커지면 폭도 비례해서 커진다', () => {
    const small = measureTextWidth('테스트', 16);
    const big = measureTextWidth('테스트', 32);
    expect(big).toBeGreaterThan(small);
    expect(big / small).toBeCloseTo(2, 0);
  });

  it('빈 문자열의 폭은 0이다', () => {
    expect(measureTextWidth('', 16)).toBe(0);
  });
});

describe('fitFontSize', () => {
  it('초기 크기에 들어가면 그대로 반환한다', () => {
    const size = fitFontSize('가', { boxWidth: 1000, initialSize: 20, minSize: 8 });
    expect(size).toBe(20);
  });

  it('박스에 안 들어가면 점진적으로 축소한다', () => {
    const size = fitFontSize('가나다라마바사아자차카타파하', {
      boxWidth: 30,
      initialSize: 40,
      minSize: 8,
    });
    expect(size).toBeLessThan(40);
    expect(size).toBeGreaterThanOrEqual(8);
  });

  it('최소 크기 미만으로는 내려가지 않는다', () => {
    const size = fitFontSize('매우매우매우매우매우긴문자열입니다', {
      boxWidth: 5,
      initialSize: 40,
      minSize: 8,
    });
    expect(size).toBe(8);
  });
});

describe('composeOverlay', () => {
  async function makeRedSquare(size = 200): Promise<Buffer> {
    return sharp({
      create: {
        width: size,
        height: size,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer();
  }

  it('블록이 0개면 원본과 동일한 크기의 JPEG을 반환한다', async () => {
    const base = await makeRedSquare(200);
    const out = await composeOverlay(base, []);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200);
    expect(meta.format).toBe('jpeg');
  });

  it('흰 박스가 합성되면 해당 픽셀이 흰색에 가까워진다', async () => {
    const base = await makeRedSquare(200);
    const blocks: OverlayBlock[] = [
      { text_ko: '테스트', bbox: { x: 50, y: 50, w: 100, h: 30 } },
    ];
    const out = await composeOverlay(base, blocks);
    const center = await sharp(out)
      .extract({ left: 100, top: 65, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(center[0]).toBeGreaterThan(200);
    expect(center[1]).toBeGreaterThan(200);
    expect(center[2]).toBeGreaterThan(200);
  });

  it('블록 텍스트가 길어도 에러 없이 출력한다', async () => {
    const base = await makeRedSquare(400);
    const blocks: OverlayBlock[] = [
      {
        text_ko: '아주아주아주아주아주아주아주긴 한국어 텍스트입니다',
        bbox: { x: 10, y: 10, w: 80, h: 20 },
      },
    ];
    const out = await composeOverlay(base, blocks);
    expect(out.length).toBeGreaterThan(0);
  });
});
