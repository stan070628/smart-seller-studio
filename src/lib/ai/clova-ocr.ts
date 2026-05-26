/**
 * CLOVA OCR API 래퍼
 * 네이버 클로바 OCR을 사용해 이미지에서 텍스트를 추출한다.
 */

interface ClovaOcrField {
  inferText: string;
  inferConfidence: number;
}

interface ClovaOcrImage {
  inferResult: 'SUCCESS' | 'ERROR' | 'EMPTY';
  fields?: ClovaOcrField[];
}

interface ClovaOcrResponse {
  images: ClovaOcrImage[];
}

/** 신뢰도 최소값 — 이 값 미만의 텍스트는 제거 */
const MIN_CONFIDENCE = 0.7;

/**
 * base64 인코딩된 이미지에서 텍스트를 추출한다.
 *
 * @param imageBase64 - base64 인코딩된 이미지 데이터
 * @param mimeType - 이미지 MIME 타입 (예: 'image/jpeg', 'image/png')
 * @returns 신뢰도 기준을 통과한 텍스트 배열; 환경변수 미설정 시 빈 배열
 * @throws {Error} API 응답이 실패(HTTP 비-2xx)일 때
 */
export async function extractTextFromImage(
  imageBase64: string,
  mimeType: string
): Promise<string[]> {
  const keyId = process.env.NAVER_CLOVA_OCR_API_KEY_ID;
  const apiKey = process.env.NAVER_CLOVA_OCR_API_KEY;

  // 환경변수 미설정 시 기능 비활성화
  if (!keyId || !apiKey) return [];

  const format = mimeType === 'image/png' ? 'png' : 'jpg';

  const response = await fetch('https://naveropenapi.apigw.ntruss.com/ocr/v1/infer', {
    method: 'POST',
    headers: {
      'X-NCP-APIGW-API-KEY-ID': keyId,
      'X-NCP-APIGW-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: 'V2',
      requestId: `ocr-${Date.now()}`,
      timestamp: Date.now(),
      lang: 'ko',
      images: [{ format, name: 'product', data: imageBase64 }],
      enableTableDetect: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`CLOVA OCR API 오류: ${response.status}`);
  }

  const data = (await response.json()) as ClovaOcrResponse;
  const image = data.images[0];

  // 결과가 없거나 SUCCESS가 아니면 빈 배열 반환
  if (!image || image.inferResult !== 'SUCCESS' || !image.fields) return [];

  return image.fields
    .filter((f) => f.inferConfidence >= MIN_CONFIDENCE)
    .map((f) => f.inferText.trim())
    .filter(Boolean);
}
