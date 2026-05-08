import path from 'node:path';
import { readFileSync } from 'node:fs';
import opentype, { type Font } from 'opentype.js';

const FONT_PATH = path.join(
  process.cwd(),
  'src/lib/listing/fonts/PretendardVariable.ttf'
);

let _font: Font | null = null;

function getFont(): Font {
  if (_font) return _font;
  const buffer = readFileSync(FONT_PATH);
  _font = opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  return _font;
}

/**
 * 주어진 폰트 크기에서 문자열의 렌더 폭(px)을 반환합니다.
 */
export function measureTextWidth(text: string, fontSize: number): number {
  if (text.length === 0) return 0;
  const font = getFont();
  return font.getAdvanceWidth(text, fontSize);
}

interface FitOptions {
  boxWidth: number;
  initialSize: number;
  minSize: number;
}

/**
 * 주어진 박스 폭에 텍스트가 들어가도록 폰트 크기를 1px씩 줄입니다.
 * 박스 폭의 105%까지 허용하고, 그래도 안 들어가면 minSize까지 축소합니다.
 */
export function fitFontSize(text: string, opts: FitOptions): number {
  const tolerance = opts.boxWidth * 1.05;
  for (let size = opts.initialSize; size >= opts.minSize; size -= 1) {
    if (measureTextWidth(text, size) <= tolerance) return size;
  }
  return opts.minSize;
}

import sharp from 'sharp';

export interface OverlayBlock {
  text_ko: string;
  bbox: { x: number; y: number; w: number; h: number };
}

const PADDING_PX = 2;
const TEXT_COLOR = '#1a1a1a';
const BOX_COLOR = '#ffffff';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildBlockSvg(width: number, height: number, blocks: OverlayBlock[]): string {
  const rects = blocks
    .map((b) => {
      const x = b.bbox.x - PADDING_PX;
      const y = b.bbox.y - PADDING_PX;
      const w = b.bbox.w + PADDING_PX * 2;
      const h = b.bbox.h + PADDING_PX * 2;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${BOX_COLOR}"/>`;
    })
    .join('');

  const texts = blocks
    .map((b) => {
      const initial = Math.max(8, Math.floor(b.bbox.h * 0.7));
      const fontSize = fitFontSize(b.text_ko, {
        boxWidth: b.bbox.w,
        initialSize: initial,
        minSize: 8,
      });
      const cx = b.bbox.x + b.bbox.w / 2;
      const cy = b.bbox.y + b.bbox.h / 2 + fontSize * 0.35;
      return `<text x="${cx}" y="${cy}" font-family="Pretendard" font-size="${fontSize}" fill="${TEXT_COLOR}" text-anchor="middle">${escapeXml(b.text_ko)}</text>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rects}${texts}</svg>`;
}

/**
 * 원본 이미지에 흰 박스 + 한국어 텍스트 오버레이를 합성합니다.
 * 블록이 0개면 원본을 JPEG로 다시 인코딩만 합니다.
 */
export async function composeOverlay(
  baseImage: Buffer,
  blocks: OverlayBlock[]
): Promise<Buffer> {
  const meta = await sharp(baseImage).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width === 0 || height === 0) {
    throw new Error('[composeOverlay] 이미지 크기를 알 수 없습니다.');
  }

  if (blocks.length === 0) {
    return sharp(baseImage).jpeg({ quality: 90 }).toBuffer();
  }

  const svg = buildBlockSvg(width, height, blocks);
  return sharp(baseImage)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}
