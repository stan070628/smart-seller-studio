/**
 * 업로드 전 사진 축소 (브라우저 전용).
 *
 * 아이폰 원본은 장당 6MB 안팎이고, **Vercel 함수는 요청 본문 4.5MB에서
 * 함수를 실행하지 않고 끊는다.** 그래서 서버의 `MAX_FILE_SIZE` 검사는
 * 애초에 도달할 수 없었다 — 막는 주체가 앱이 아니라 플랫폼이므로
 * 관문도 앱 안, 그것도 fetch 앞에 있어야 한다.
 *
 * 🔵 **판독 품질은 깎이지 않는다.** Claude는 긴 변이 2576px를 넘는 이미지를
 * 스스로 그 크기로 줄여서 본다(Claude 4.7 이후 고해상도 티어). 4032px를
 * 보내도 모델이 보는 것은 2576px다. 즉 여기서 줄이는 것은 판독에 쓰이지
 * 않는 화소이고, 대신 6MB가 0.5MB가 된다.
 *
 * ⚠️ **압축을 세게 걸지 않는다.** 영수증은 곧 글자이고, JPEG 아티팩트는
 * 작은 활자부터 무너뜨린다. 해상도를 상한에 맞추되 품질은 높게 둔다.
 */

/** Claude 고해상도 티어의 긴 변 상한. 이보다 크게 보내도 모델이 줄인다 */
export const MAX_LONG_EDGE = 2576;

/** 축소가 부족할 때 한 단계 낮출 긴 변 */
const FALLBACK_LONG_EDGE = 1800;

/** 글자를 지키기 위해 높게 잡은 JPEG 품질 */
const JPEG_QUALITY = 0.85;

/**
 * 한 요청에 담을 수 있는 총 바이트.
 *
 * Vercel 상한은 4.5MB지만 multipart 경계·헤더·base64가 아닌 원시 바이트
 * 외의 몫이 있으므로 4.0MB로 잡는다.
 */
export const UPLOAD_BUDGET_BYTES = 4_000_000;

export interface PreparedUpload {
  files: File[];
  totalBytes: number;
  /** 축소를 마치고도 예산을 넘는가 — 넘으면 보내기 전에 사용자에게 알린다 */
  overBudget: boolean;
}

/**
 * 비율을 지키며 긴 변을 상한에 맞춘다. **상한보다 작은 사진은 키우지 않는다** —
 * 없는 화소를 만들어내면 바이트만 늘고 글자는 오히려 흐려진다.
 */
export function fitLongEdge(
  width: number,
  height: number,
  maxLongEdge: number,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) return { width, height };

  const ratio = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/** 이 환경에서 캔버스 재인코딩이 가능한가 */
function canReencode(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof createImageBitmap === 'function' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.toBlob === 'function'
  );
}

/**
 * 한 장을 긴 변 `maxLongEdge`의 JPEG으로 다시 인코딩한다.
 *
 * 🔴 **실패하면 원본을 그대로 돌려준다.** 디코딩이 안 되는 사진 한 장 때문에
 * 매장에서 촬영 흐름이 멈추면 안 된다. 그래도 남는 용량 문제는 호출부가
 * `overBudget`으로 잡고, 그마저 새면 http.ts가 한국어로 알린다.
 */
export async function downscaleImage(
  file: File,
  maxLongEdge: number = MAX_LONG_EDGE,
  quality: number = JPEG_QUALITY,
): Promise<File> {
  if (!canReencode()) return file;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const { width, height } = fitLongEdge(bitmap.width, bitmap.height, maxLongEdge);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    });
    if (!blob) return file;

    // 원본이 이미 더 작으면 굳이 바꾸지 않는다 (재인코딩은 화질만 깎는다)
    if (blob.size >= file.size && bitmap.width <= maxLongEdge && bitmap.height <= maxLongEdge) {
      return file;
    }

    const name = file.name.replace(/\.[^.]+$/, '') || 'receipt';
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch (e) {
    // 원인을 삼키지는 않는다 — 콘솔에는 남긴다
    console.warn('[receipt] 사진 축소 실패, 원본으로 업로드합니다', e);
    return file;
  } finally {
    bitmap?.close();
  }
}

function sum(files: File[]): number {
  return files.reduce((n, f) => n + f.size, 0);
}

/**
 * 여러 장을 업로드용으로 준비한다.
 *
 * 한 번 줄여서도 예산을 넘으면 긴 변을 한 단계 더 낮춰 다시 시도하고,
 * 그래도 넘으면 `overBudget: true`로 **보내기 전에** 알린다.
 */
export async function prepareForUpload(input: File[]): Promise<PreparedUpload> {
  let files = await Promise.all(input.map((f) => downscaleImage(f)));

  if (sum(files) > UPLOAD_BUDGET_BYTES) {
    files = await Promise.all(input.map((f) => downscaleImage(f, FALLBACK_LONG_EDGE, 0.8)));
  }

  const totalBytes = sum(files);
  return { files, totalBytes, overBudget: totalBytes > UPLOAD_BUDGET_BYTES };
}
