/**
 * 쿠팡 상품명 + 대표 이미지 URL → 도매꾹 동일 상품 매칭 모듈.
 *
 * 처리 흐름:
 * 1. Gemini로 쿠팡 상품명에서 검색 키워드 추출
 * 2. 도매꾹 API로 키워드별 후보 10개 조회
 * 3. Claude Vision으로 이미지 유사도 비교
 * 4. 유사도 80% 이상 + isSameProduct=true 인 최고 유사도 항목 반환
 * 5. 매칭 실패 시 null 반환
 */

import { extractKeywordsFromProduct } from '@/lib/sourcing/ai-keyword-extract';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { compareImages } from './image-similarity';
import type { DomeggookListItem } from '@/types/sourcing';

// 동일 상품으로 판정할 최소 유사도 임계값 (%)
const SIMILARITY_THRESHOLD = 80;

// 키워드당 후보 조회 수
const CANDIDATE_PAGE_SIZE = 10;

export interface DomeggookMatch {
  productName: string;
  price: number;
  url: string;
  imageUrl: string;
  similarity: number;
}

/**
 * 쿠팡 상품명과 대표 이미지 URL을 받아 도매꾹에서 동일 상품을 찾는다.
 *
 * - 키워드 추출 실패 시: 상품명 원문을 그대로 단일 키워드로 사용
 * - 이미지 유사도 비교 중 일부 실패해도 나머지 결과로 매칭 진행
 * - 매칭 기준 미달 시 null 반환
 */
export async function matchOnDomeggook(
  coupangName: string,
  coupangImageUrl: string,
): Promise<DomeggookMatch | null> {
  // 1단계: 키워드 추출 (실패 시 원문 사용)
  const extractedKeywords = await extractKeywordsFromProduct(coupangName);
  const keywords: string[] =
    extractedKeywords && extractedKeywords.length > 0 ? extractedKeywords : [coupangName.trim()];

  const client = getDomeggookClient();

  // 2단계: 키워드별 후보 수집 (중복 상품번호 제거)
  const candidateMap = new Map<number, DomeggookListItem>();

  for (const kw of keywords) {
    try {
      const result = await client.getItemList({
        keyword: kw,
        pageSize: CANDIDATE_PAGE_SIZE,
        sort: 'rd',
      });
      for (const item of result.list) {
        if (!candidateMap.has(item.no)) {
          candidateMap.set(item.no, item);
        }
      }
    } catch (err) {
      // 특정 키워드 조회 실패는 무시하고 다음 키워드로 진행
      console.warn(
        '[domeggook-matcher] 키워드 조회 실패:',
        kw,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const candidates = Array.from(candidateMap.values());

  if (candidates.length === 0) {
    console.warn('[domeggook-matcher] 도매꾹 후보 상품 없음:', coupangName);
    return null;
  }

  // 3단계: 이미지 유사도 비교 — 썸네일(thumb)이 없는 항목은 건너뜀
  let bestMatch: DomeggookMatch | null = null;

  for (const candidate of candidates) {
    const thumbUrl = candidate.thumb;
    if (!thumbUrl) continue;

    const { similarity, isSameProduct } = await compareImages(coupangImageUrl, thumbUrl);

    // 4단계: 임계값 이상 + 동일 상품 판정된 항목만 채택
    if (similarity >= SIMILARITY_THRESHOLD && isSameProduct) {
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = {
          productName: candidate.title,
          price: candidate.price,
          url: candidate.url,
          imageUrl: thumbUrl,
          similarity,
        };
      }
    }
  }

  return bestMatch;
}
