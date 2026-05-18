/**
 * 소싱 에이전트 메인 파이프라인
 *
 * 1. 카테고리 선택 (opts.categoryId 지정 또는 last_crawled_at 오래된 순 자동 선택)
 * 2. crawlCoupangCategory로 상위 20개 상품 수집
 * 3. 각 상품별: 중복 체크 → 도매꾹 매칭 → 마진율 계산 → 30% 미만 제외 → 1688 매칭
 * 4. 마진율 내림차순 상위 5개 DB 저장
 * 5. 카테고리 last_crawled_at 갱신
 */

import { getSourcingPool } from '@/lib/sourcing/db';
import {
  getNextCategory,
  getCategoryById,
  isDuplicateProduct,
  saveAgentResults,
  updateCategoryLastCrawled,
  type AgentResultInsert,
} from './db';
import { crawlCoupangCategory } from './coupang-crawler';
import { matchOnDomeggook } from './domeggook-matcher';
import { matchOn1688 } from './china-matcher';
import { calcMarginRate } from '@/lib/sourcing/domeggook-pricing';

// 도매꾹 마진율 최소 기준 (%)
const MIN_MARGIN_RATE_PCT = 30;

// 최종 저장할 상위 상품 수
const TOP_N = 5;

export interface PipelineOptions {
  categoryId?: number;
}

export interface PipelineResult {
  categoryName: string;
  crawledCount: number;
  savedCount: number;
}

export async function runSourcingAgentPipeline(opts?: PipelineOptions): Promise<PipelineResult> {
  const pool = getSourcingPool();

  // 1단계: 처리 대상 카테고리 결정
  const category = opts?.categoryId
    ? await getCategoryById(pool, opts.categoryId)
    : await getNextCategory(pool);

  if (!category) {
    throw new Error('처리할 활성 카테고리가 없습니다.');
  }

  console.info(`[pipeline] 카테고리 시작: ${category.name} (id=${category.id})`);

  // 2단계: 쿠팡 카테고리 크롤링
  const coupangProducts = await crawlCoupangCategory(category.coupang_category_url, 20);
  console.info(`[pipeline] 쿠팡 크롤링 완료: ${coupangProducts.length}개`);

  // 3단계: 각 상품 처리
  const candidates: Array<AgentResultInsert & { _marginRate: number }> = [];

  for (const product of coupangProducts) {
    try {
      // 최근 30일 중복 여부 확인
      const isDup = await isDuplicateProduct(pool, product.productId);
      if (isDup) {
        console.info(`[pipeline] 중복 스킵: ${product.productId}`);
        continue;
      }

      // 도매꾹 매칭
      const domeggookMatch = await matchOnDomeggook(
        product.name,
        product.imageUrl,
      );

      // 도매꾹 마진율 계산 (미매칭이면 0으로 취급)
      let domeggookMarginRate: number | null = null;
      if (domeggookMatch) {
        // calcMarginRate 반환값은 이미 퍼센트 (예: 35.5 = 35.5%)
        domeggookMarginRate = calcMarginRate(
          domeggookMatch.price,
          product.price,
          null,
        );
      }

      // 30% 미만 마진 상품 제외
      if (domeggookMarginRate === null || domeggookMarginRate < MIN_MARGIN_RATE_PCT) {
        console.info(
          `[pipeline] 마진 미달 스킵: ${product.name} (${domeggookMarginRate?.toFixed(1) ?? 'null'}%)`
        );
        continue;
      }

      // 1688 매칭
      const chinaMatch = await matchOn1688(product.name, product.imageUrl, product.price);

      const resultRow: AgentResultInsert & { _marginRate: number } = {
        category_id: category.id,
        coupang_product_id: product.productId,
        coupang_product_name: product.name,
        coupang_rank: product.rank,
        coupang_price: product.price,
        coupang_image_url: product.imageUrl,
        coupang_url: product.productUrl,
        domeggook_product_name: domeggookMatch?.productName ?? null,
        domeggook_price: domeggookMatch?.price ?? null,
        domeggook_url: domeggookMatch?.url ?? null,
        domeggook_image_url: domeggookMatch?.imageUrl ?? null,
        domeggook_similarity: domeggookMatch?.similarity ?? null,
        china_product_name: chinaMatch?.productName ?? null,
        china_price_krw: chinaMatch?.priceKrw ?? null,
        china_url: chinaMatch?.url ?? null,
        china_image_url: chinaMatch?.imageUrl ?? null,
        domeggook_margin_rate: domeggookMarginRate,
        china_margin_rate: chinaMatch ? chinaMatch.marginRate * 100 : null,
        _marginRate: domeggookMarginRate,
      };

      candidates.push(resultRow);
      console.info(`[pipeline] 후보 추가: ${product.name} (마진 ${domeggookMarginRate.toFixed(1)}%)`);
    } catch (err) {
      // 개별 상품 실패는 로그 후 계속 진행
      console.error(
        `[pipeline] 상품 처리 오류 (${product.productId}):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // 4단계: 마진율 내림차순으로 상위 5개 선별
  const top = candidates
    .sort((a, b) => b._marginRate - a._marginRate)
    .slice(0, TOP_N)
    .map(({ _marginRate: _, ...row }) => row);

  // 5단계: DB 저장
  await saveAgentResults(pool, top);
  console.info(`[pipeline] DB 저장 완료: ${top.length}개`);

  // 6단계: 카테고리 crawled_at 갱신
  await updateCategoryLastCrawled(pool, category.id);

  return {
    categoryName: category.name,
    crawledCount: coupangProducts.length,
    savedCount: top.length,
  };
}
