/**
 * 전체 페이지 캡처를 판독 가능한 조각으로 나누는 경계 계산 (순수 함수).
 *
 * 2,576px: Claude 고해상도 상한(receipt/downscale.ts와 같은 값). 세로로 긴 캡처를
 * 통째로 보내면 모델이 긴 변을 이 값으로 줄여 폭 1,985px가 약 310px가 되고 글자가 뭉개진다.
 * 600px 겹침: 상품 카드 한 칸(폭 1,985px 기준 약 430px)보다 커야 모든 카드가
 * 어느 조각엔가 온전히 들어간다. 가장자리에서 잘린 카드는 판독 프롬프트가 버린다.
 */
export const TILE_HEIGHT = 2576;
export const TILE_OVERLAP = 600;

export interface TileBox { top: number; height: number }

export function computeTiles(height: number): TileBox[] {
  const step = TILE_HEIGHT - TILE_OVERLAP;
  const tiles: TileBox[] = [];
  let top = 0;
  for (;;) {
    const h = Math.min(TILE_HEIGHT, height - top);
    tiles.push({ top, height: h });
    if (top + h >= height) break;
    top += step;
  }
  return tiles;
}

/**
 * 내용이 끝나는 높이.
 * 찜질 캡처는 16,384px 중 위 4,456px만 상품이고 나머지는 흰 빈칸이었다(Chrome 캡처 상한 +
 * 네이버가 화면 밖 상품을 그리지 않음). 마지막 내용 줄 뒤에 여백을 조금 둔다.
 */
export function findContentEnd(rowIsBlank: boolean[], margin: number): number {
  let last = -1;
  for (let y = rowIsBlank.length - 1; y >= 0; y--) {
    if (!rowIsBlank[y]) { last = y; break; }
  }
  if (last < 0) return rowIsBlank.length;
  return Math.min(rowIsBlank.length, last + 1 + margin);
}
