/**
 * Claude Vision 기반 이미지 유사도 비교 모듈.
 *
 * 두 이미지 URL을 Claude Haiku에 전달해 유사도(0-100)와
 * 동일 상품 여부를 JSON으로 반환받는다.
 * 실패 시 안전값 { similarity: 0, isSameProduct: false }를 반환해
 * 호출부가 예외 처리를 별도로 하지 않아도 되도록 설계.
 */

import Anthropic from '@anthropic-ai/sdk';
import { fetchImagesFromUrls, resizeForClaude } from '@/lib/ai/claude-vision';

// Claude Vision 비교에 사용할 모델
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// 유사도 비교 프롬프트 — JSON만 반환하도록 명시
const COMPARISON_PROMPT = `두 이미지가 동일한 상품인지 판단해 주세요.

응답은 반드시 아래 JSON 형식만 반환하세요. 설명, 코드블록, 다른 텍스트는 절대 포함하지 마세요.
{"similarity": 0에서 100 사이의 정수, "is_same_product": true 또는 false}

판단 기준:
- similarity: 두 이미지의 시각적 유사도 (0=완전히 다름, 100=완전히 동일)
- is_same_product: 동일 상품이면 true, 다른 상품이면 false`;

export interface SimilarityResult {
  similarity: number;
  isSameProduct: boolean;
}

/**
 * 두 이미지 URL을 Claude Vision으로 비교해 유사도와 동일 상품 여부를 반환한다.
 * 네트워크 오류, API 오류, JSON 파싱 실패 등 모든 예외에서 안전값을 반환한다.
 */
export async function compareImages(
  imageUrl1: string,
  imageUrl2: string,
): Promise<SimilarityResult> {
  const SAFE_RESULT: SimilarityResult = { similarity: 0, isSameProduct: false };

  try {
    // 두 이미지를 병렬 다운로드 후 Claude 크기 제한에 맞게 리사이즈
    const rawImages = await fetchImagesFromUrls([imageUrl1, imageUrl2]);
    const [img1, img2] = await Promise.all([
      resizeForClaude(rawImages[0].imageBase64, rawImages[0].mimeType),
      resizeForClaude(rawImages[1].imageBase64, rawImages[1].mimeType),
    ]);

    const client = new Anthropic();

    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 80,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: img1.mimeType,
                data: img1.imageBase64,
              },
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: img2.mimeType,
                data: img2.imageBase64,
              },
            },
            {
              type: 'text',
              text: COMPARISON_PROMPT,
            },
          ],
        },
      ],
    });

    // 응답 텍스트 추출
    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      console.warn('[image-similarity] Claude 응답에 텍스트 블록 없음');
      return SAFE_RESULT;
    }

    // 코드블록 마크다운 제거 후 JSON 파싱
    const cleaned = textBlock.text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '');

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.warn('[image-similarity] JSON 파싱 실패:', cleaned.slice(0, 100));
      return SAFE_RESULT;
    }

    const obj = parsed as { similarity?: unknown; is_same_product?: unknown };

    const similarity =
      typeof obj.similarity === 'number'
        ? Math.min(100, Math.max(0, Math.round(obj.similarity)))
        : 0;

    const isSameProduct = typeof obj.is_same_product === 'boolean' ? obj.is_same_product : false;

    return { similarity, isSameProduct };
  } catch (err) {
    // 네트워크·API 오류 — 로그 후 안전값 반환
    console.error('[image-similarity] 비교 중 오류:', err instanceof Error ? err.message : err);
    return SAFE_RESULT;
  }
}
