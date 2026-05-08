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
