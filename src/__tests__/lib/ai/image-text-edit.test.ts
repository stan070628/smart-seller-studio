/**
 * image-text-edit.ts 단위 테스트
 *
 * 외부 의존(Claude API)은 mock 없이는 호출 불가하므로 composeTextOnImage 등
 * 순수 합성 로직만 실제로 검증한다. extractTextRegions/parseEditIntent는
 * Zod 응답 파싱 + JSON 추출만 통합 단위에서 다루지 않는다 (라우트 통합 테스트로 커버).
 */

import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { composeTextOnImage, type EditOperation } from '@/lib/ai/image-text-edit';

async function makeBlankImage(width = 600, height = 200): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 200, b: 200 },
    },
  })
    .jpeg()
    .toBuffer();
}

describe('composeTextOnImage', () => {
  it('operations가 비어있으면 원본을 JPEG로 재인코딩한 결과를 반환한다', async () => {
    const original = await makeBlankImage();
    const result = await composeTextOnImage(original, []);
    const meta = await sharp(result).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(200);
  });

  it('한 영역에 한국어를 합성하면 valid JPEG를 반환한다', async () => {
    const original = await makeBlankImage();
    const operations: EditOperation[] = [
      {
        region: {
          text: '원본 텍스트',
          bbox: { x: 50, y: 60, w: 300, h: 60 },
          estimatedColor: '#111111',
          estimatedFontSizePx: 36,
        },
        newText: '새 한국어 가격 29,900원',
      },
    ];
    const result = await composeTextOnImage(original, operations);
    const meta = await sharp(result).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(200);
    expect(result.length).toBeGreaterThan(1000);
  });

  it('여러 영역을 동시에 합성한다', async () => {
    const original = await makeBlankImage(800, 400);
    const operations: EditOperation[] = [
      {
        region: { text: 'A', bbox: { x: 10, y: 10, w: 200, h: 40 }, estimatedFontSizePx: 28 },
        newText: '첫 번째 영역',
      },
      {
        region: { text: 'B', bbox: { x: 10, y: 100, w: 200, h: 40 }, estimatedFontSizePx: 28 },
        newText: '두 번째 영역',
      },
      {
        region: { text: 'C', bbox: { x: 10, y: 200, w: 200, h: 40 }, estimatedFontSizePx: 28 },
        newText: '세 번째 영역',
      },
    ];
    const result = await composeTextOnImage(original, operations);
    const meta = await sharp(result).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(400);
  });

  it('이미지 밖에 있는 region은 스킵한다 (에러 없이)', async () => {
    const original = await makeBlankImage(300, 200);
    const operations: EditOperation[] = [
      {
        region: { text: '범위밖', bbox: { x: 500, y: 60, w: 100, h: 40 }, estimatedFontSizePx: 24 },
        newText: '무시되어야 함',
      },
      {
        region: { text: '정상', bbox: { x: 10, y: 60, w: 100, h: 40 }, estimatedFontSizePx: 24 },
        newText: '정상 영역',
      },
    ];
    const result = await composeTextOnImage(original, operations);
    const meta = await sharp(result).metadata();
    expect(meta.format).toBe('jpeg');
  });

  it('새 텍스트가 너무 길면 폰트 크기를 자동 축소한다 (에러 없이 합성)', async () => {
    const original = await makeBlankImage(400, 100);
    const operations: EditOperation[] = [
      {
        region: { text: '짧음', bbox: { x: 10, y: 30, w: 380, h: 40 }, estimatedFontSizePx: 32 },
        newText: '아주아주아주 긴 텍스트가 영역에 들어가야 할 때 자동으로 작아지는지 검증',
      },
    ];
    const result = await composeTextOnImage(original, operations);
    expect(result.length).toBeGreaterThan(0);
  });

  it('XML 특수문자(<, >, &)가 있어도 SVG escape 처리되어 합성 성공', async () => {
    const original = await makeBlankImage();
    const operations: EditOperation[] = [
      {
        region: { text: 'orig', bbox: { x: 10, y: 60, w: 400, h: 40 }, estimatedFontSizePx: 28 },
        newText: 'A & B <태그> "인용" \'아포\'',
      },
    ];
    const result = await composeTextOnImage(original, operations);
    expect(result.length).toBeGreaterThan(0);
  });
});
