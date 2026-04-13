/**
 * image-processor.ts
 *
 * Sharp 기반 이미지 가공 유틸리티.
 * - 대표이미지: 800×800 정방형 흰색 패딩 + 셀러 브랜드명 워터마크
 * - 상세이미지: 최대 너비 860px 리사이즈
 *
 * 서버 전용 — Node.js native addon (Sharp) 사용.
 */

import sharp from 'sharp';

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

const THUMB_SIZE = 800;           // 대표이미지 정방형 크기
const DETAIL_MAX_WIDTH = 860;     // 상세이미지 최대 너비
const JPEG_QUALITY = 85;          // JPEG 출력 품질

// ─────────────────────────────────────────
// 대표이미지 처리
// ─────────────────────────────────────────

/**
 * SVG 텍스트에 사용될 특수문자 이스케이프
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 대표이미지를 가공합니다.
 * 1. 800×800 정방형으로 리사이즈 (contain + 흰색 패딩)
 * 2. 우하단에 셀러 브랜드명 반투명 워터마크 삽입
 * 3. JPEG quality 85로 출력
 */
export async function processMainImage(
  inputBuffer: Buffer,
  brandName: string,
): Promise<Buffer> {
  // 1. 정방형 리사이즈 (흰 배경 패딩)
  const resized = await sharp(inputBuffer)
    .resize(THUMB_SIZE, THUMB_SIZE, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .toBuffer();

  // 2. 워터마크 SVG 생성 (최대 200px 너비, 우하단)
  const displayName = escapeXml(brandName.slice(0, 20)); // 너무 길면 잘라냄
  const svgWatermark = `
    <svg xmlns="http://www.w3.org/2000/svg" width="220" height="44">
      <rect width="220" height="44" rx="4" fill="rgba(0,0,0,0.35)"/>
      <text
        x="110" y="30"
        font-size="17"
        font-family="'Apple SD Gothic Neo','Malgun Gothic',sans-serif"
        font-weight="600"
        fill="rgba(255,255,255,0.90)"
        text-anchor="middle"
      >${displayName}</text>
    </svg>`;

  // 3. 워터마크 합성 + JPEG 출력
  return sharp(resized)
    .composite([
      {
        input: Buffer.from(svgWatermark),
        gravity: 'southeast',
        blend: 'over',
      },
    ])
    .jpeg({ quality: JPEG_QUALITY, progressive: true })
    .toBuffer();
}

// ─────────────────────────────────────────
// 상세이미지 처리
// ─────────────────────────────────────────

/**
 * 상세이미지를 가공합니다.
 * - 최대 너비 860px 리사이즈 (비율 유지, 업스케일 없음)
 * - JPEG quality 85로 출력
 */
export async function processDetailImage(inputBuffer: Buffer): Promise<Buffer> {
  const metadata = await sharp(inputBuffer).metadata();
  const originalWidth = metadata.width ?? 0;

  let pipeline = sharp(inputBuffer);

  if (originalWidth > DETAIL_MAX_WIDTH) {
    pipeline = pipeline.resize({ width: DETAIL_MAX_WIDTH, withoutEnlargement: true });
  }

  return pipeline
    .jpeg({ quality: JPEG_QUALITY, progressive: true })
    .toBuffer();
}

// ─────────────────────────────────────────
// 외부 이미지 다운로드
// ─────────────────────────────────────────

const DOWNLOAD_TIMEOUT_MS = 8_000;

/**
 * 외부 URL에서 이미지를 다운로드합니다.
 * 8초 타임아웃, 이미지 MIME 타입 검증.
 */
export async function downloadImage(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // 일부 서버가 브라우저 UA가 없으면 403을 반환함
        'User-Agent':
          'Mozilla/5.0 (compatible; SmartSellerStudio/1.0; +https://smartsellerstudio.vercel.app)',
      },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`이미지 다운로드 실패: ${res.status} ${url}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  // 도매꾹 CDN 등 일부 서버는 이미지를 application/octet-stream으로 반환
  const allowedTypes = ['image/', 'application/octet-stream'];
  if (!allowedTypes.some((t) => contentType.startsWith(t))) {
    throw new Error(`이미지가 아닌 응답: ${contentType} (${url})`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ─────────────────────────────────────────
// 동시성 제한 유틸리티
// ─────────────────────────────────────────

/**
 * tasks 배열을 limit 개씩 나눠 순차 실행합니다.
 * Promise.allSettled 방식이므로 개별 실패가 전체를 중단하지 않습니다.
 */
export async function withConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];

  for (let i = 0; i < tasks.length; i += limit) {
    const batch = tasks.slice(i, i + limit);
    const batchResults = await Promise.allSettled(batch.map((fn) => fn()));
    results.push(...batchResults);
  }

  return results;
}
