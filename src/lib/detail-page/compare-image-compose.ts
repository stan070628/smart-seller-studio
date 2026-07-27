/**
 * 좌우 대비 이미지 결합. 서버 전용(Sharp).
 *
 * Gemini는 1:1로 생성하므로 그대로 좌우로 붙이면 390px에서 각 칸이 195px가 되고
 * 세부가 뭉개진다(시험에서 우측 튜브를 수건과 구분하지 못했다). 세로로 크롭해
 * 폭을 74%로 줄이면 같은 높이에서 피사체가 커져 개수·겹침·생활 흔적이 살아난다.
 *
 * 세로 스택(위아래 배치)이 가장 선명했지만 높이를 3배 쓰고 스크롤해야 하므로
 * "한눈에 대비"라는 목적이 약해진다.
 */
import sharp from 'sharp';

/** 크롭 후 남길 폭 비율. 1024 → 760 (약 74%) */
export const CROP_RATIO = 760 / 1024;

/** 좌우 사이 흰 간격(px). 두 장이 한 사진처럼 붙어 보이지 않게 하는 최소한의 구분. */
export const GAP = 4;

/**
 * 이미지 폭에서 중앙 크롭 영역을 구한다. 반올림으로 홀수 폭에서도 좌우가 대칭이 되게
 * left를 먼저 계산하고 width를 맞춘다.
 */
export function cropBox(width: number): { left: number; width: number } {
  const target = Math.max(1, Math.round(width * CROP_RATIO));
  const left = Math.max(0, Math.floor((width - target) / 2));
  return { left, width: Math.min(target, width - left) };
}

/**
 * 좌(기존 방식) · 우(우리 제품) 두 장을 중앙 크롭해 가로로 결합한다.
 *
 * 좌우 순서를 바꾸면 카피(좌: 기존 / 우: 우리)와 어긋나므로 인자 순서가 곧 배치다.
 * 두 이미지의 높이가 다르면 작은 쪽에 맞춰 잘라낸다 — 늘리면 비율이 깨진다.
 */
export async function composeComparePair(before: Buffer, after: Buffer): Promise<Buffer> {
  const [bm, am] = await Promise.all([sharp(before).metadata(), sharp(after).metadata()]);
  const bw = bm.width ?? 0;
  const bh = bm.height ?? 0;
  const aw = am.width ?? 0;
  const ah = am.height ?? 0;
  if (bw === 0 || bh === 0 || aw === 0 || ah === 0) {
    throw new Error('대비 이미지 결합 실패: 입력 이미지 크기를 읽지 못했습니다.');
  }

  const height = Math.min(bh, ah);
  const bBox = cropBox(bw);
  const aBox = cropBox(aw);

  const [bCrop, aCrop] = await Promise.all([
    sharp(before).extract({ left: bBox.left, top: 0, width: bBox.width, height }).png().toBuffer(),
    sharp(after).extract({ left: aBox.left, top: 0, width: aBox.width, height }).png().toBuffer(),
  ]);

  const totalWidth = bBox.width + GAP + aBox.width;

  return sharp({
    create: {
      width: totalWidth,
      height,
      channels: 3,
      background: '#ffffff',
    },
  })
    .composite([
      { input: bCrop, left: 0, top: 0 },
      { input: aCrop, left: bBox.width + GAP, top: 0 },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}
