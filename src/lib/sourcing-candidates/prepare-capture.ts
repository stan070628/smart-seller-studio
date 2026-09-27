'use client';

import { computeTiles, findContentEnd } from '@/lib/sourcing-candidates/tile';
import { MAX_LONG_EDGE, UPLOAD_BUDGET_BYTES } from '@/lib/receipt/downscale';

/**
 * 업로드 전 캡처 준비 (브라우저 전용).
 *
 * 한 장이든 전체 페이지 캡처든 같은 길을 탄다: 폭을 2,576px 이하로 맞추고 →
 * 아래 빈칸을 잘라내고 → 세로로 조각내 JPEG로 만든다.
 * 서버가 아니라 여기서 하는 이유는 Vercel 요청 본문 4.5MB 상한이다 —
 * 찜질 전체 페이지 캡처 PNG가 이미 4.5MB였다.
 */

/** 행 안의 밝기 편차가 이 값 이하면 빈 줄 (흰 패널과 회색 배경의 차이는 약 30) */
const BLANK_SPREAD = 40;
const CONTENT_MARGIN = 40;
const JPEG_QUALITY = 0.9;

export interface PreparedCapture {
  files: File[];
  totalBytes: number;
  overBudget: boolean;
}

function rowBlankMap(ctx: CanvasRenderingContext2D, width: number, height: number): boolean[] {
  const data = ctx.getImageData(0, 0, width, height).data;
  const blank: boolean[] = new Array(height);
  for (let y = 0; y < height; y++) {
    let min = 255;
    let max = 0;
    for (let x = 0; x < width; x += 4) {
      const i = (y * width + x) * 4;
      const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      if (lum < min) min = lum;
      if (lum > max) max = lum;
    }
    blank[y] = max - min <= BLANK_SPREAD;
  }
  return blank;
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG 변환 실패'))), 'image/jpeg', JPEG_QUALITY);
  });
}

async function prepareOne(file: File): Promise<File[]> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_LONG_EDGE / bitmap.width);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const full = document.createElement('canvas');
    full.width = width;
    full.height = height;
    const ctx = full.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('캔버스를 만들 수 없습니다');
    ctx.drawImage(bitmap, 0, 0, width, height);

    const end = findContentEnd(rowBlankMap(ctx, width, height), CONTENT_MARGIN);
    const base = file.name.replace(/\.[^.]+$/, '') || 'capture';

    const out: File[] = [];
    for (const [i, t] of computeTiles(end).entries()) {
      const tile = document.createElement('canvas');
      tile.width = width;
      tile.height = t.height;
      tile.getContext('2d')!.drawImage(full, 0, t.top, width, t.height, 0, 0, width, t.height);
      const blob = await toJpeg(tile);
      out.push(new File([blob], `${base}-${i}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }));
    }
    return out;
  } finally {
    bitmap.close();
  }
}

/** 여러 캡처를 올린 순서대로 조각내 한 줄로 이어 붙인다 — 순위가 이 순서를 따른다 */
export async function prepareCaptures(input: File[]): Promise<PreparedCapture> {
  const files: File[] = [];
  for (const f of input) files.push(...(await prepareOne(f)));
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  return { files, totalBytes, overBudget: totalBytes > UPLOAD_BUDGET_BYTES };
}
