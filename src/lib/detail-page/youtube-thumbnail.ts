import sharp from 'sharp';
import { uploadToStorage } from '@/lib/supabase/server';

// 중앙 재생버튼 SVG (빨간 라운드 + 흰 삼각형)
function playButtonSvg(size: number): Buffer {
  const r = Math.round(size * 0.18);
  const w = r * 2.8;
  const h = r * 2;
  const cx = w / 2;
  const cy = h / 2;
  const tri = r * 0.7;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <rect x="0" y="0" width="${w}" height="${h}" rx="${h * 0.28}" fill="#FF0033"/>
      <polygon points="${cx - tri},${cy - tri} ${cx - tri},${cy + tri} ${cx + tri * 1.3},${cy}" fill="#ffffff"/>
    </svg>`,
  );
}

async function fetchThumb(videoId: string): Promise<Buffer> {
  const candidates = [
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const ab = await res.arrayBuffer();
        if (ab.byteLength > 0) return Buffer.from(ab);
      }
    } catch {
      // 다음 후보로
    }
  }
  throw new Error(`유튜브 썸네일을 가져오지 못했습니다: ${videoId}`);
}

/** 유튜브 썸네일에 재생버튼을 합성해 Supabase에 업로드하고 공개 URL을 반환한다. */
export async function composeYoutubeThumbnail(
  videoId: string,
  _aspect: 'vertical' | 'horizontal',
): Promise<string> {
  const thumb = await fetchThumb(videoId);
  const meta = await sharp(thumb).metadata();
  const baseWidth = meta.width ?? 1280;
  const baseHeight = meta.height ?? 720;
  // 재생버튼 크기는 짧은 변 기준으로 산정한다. SVG 자체는 0x0이 되지 않도록 최소 크기를
  // 확보해 생성한 뒤(sharp는 0 치수 SVG를 거부함), 베이스보다 크면 아래에서 축소한다.
  // (테스트의 1x1 px 더미 이미지처럼 매우 작은 베이스에서도 합성이 실패하지 않게 하기 위함)
  const targetSize = Math.max(Math.min(baseWidth, baseHeight), 64);
  const overlay = await sharp(playButtonSvg(targetSize)).png().toBuffer();
  const overlayMeta = await sharp(overlay).metadata();
  const overlayWidth = overlayMeta.width ?? targetSize;
  const overlayHeight = overlayMeta.height ?? targetSize;

  const compositeInput =
    overlayWidth > baseWidth || overlayHeight > baseHeight
      ? await sharp(overlay)
          .resize({
            width: Math.max(1, Math.min(overlayWidth, baseWidth)),
            height: Math.max(1, Math.min(overlayHeight, baseHeight)),
            fit: 'inside',
          })
          .png()
          .toBuffer()
      : overlay;

  const resultBuffer = await sharp(thumb)
    .composite([{ input: compositeInput, gravity: 'center' }])
    .jpeg({ quality: 85 })
    .toBuffer();

  const arrayBuffer = resultBuffer.buffer.slice(
    resultBuffer.byteOffset,
    resultBuffer.byteOffset + resultBuffer.byteLength,
  ) as ArrayBuffer;
  const path = `ai-detail/youtube/${videoId}-${resultBuffer.byteLength}.jpg`;
  const { url } = await uploadToStorage(path, arrayBuffer, 'image/jpeg', resultBuffer.byteLength);
  return url;
}
