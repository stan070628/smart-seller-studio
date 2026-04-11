/**
 * POST /api/sourcing/costco/naver-prices
 * 활성 코스트코 상품들의 시장가를 네이버 쇼핑 API로 일괄 수집
 *
 * Vercel Cron (vercel.json):
 *   { "path": "/api/sourcing/costco/naver-prices", "schedule": "0 22 * * *" }
 *   → KST 07:00 매일 실행 (UTC 22:00)
 *
 * 인증:
 *   - Authorization: Bearer {CRON_SECRET} 헤더 확인
 *   - CRON_SECRET 미설정 시 인증 생략 (개발 편의)
 *
 * 네이버 쇼핑 API 한도: 하루 25,000회 → limit 파라미터로 호출 수 제어
 *
 * 실행 시간 설계:
 *   - maxDuration: 300초 (Vercel Pro 최대값)
 *   - 함수 내부에서 경과 시간을 추적, 남은 시간이 안전 마진(30초) 미만이면
 *     루프를 조기 종료하고 부분 결과를 반환 → 타임아웃 강제 종료 방지
 *   - 네이버 API 타임아웃: 8초/건 (15초 원본 대비 보수적으로 단축)
 *   - Rate limit 딜레이: 200ms/건
 *   - 안전 처리 용량: limit 기본 50건, 최대 100건
 *     (평균 1초/건 기준 50건 → 약 60초, 최악 8초/건 기준 50건 → 약 410초를
 *      조기 종료 로직으로 방어)
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSourcingPool } from '@/lib/sourcing/db';
import { searchNaverLowestPrice, searchNaverUnitPrice } from '@/lib/sourcing/naver-shopping';
import { recalculateSourcingScores } from '@/lib/sourcing/costco-scorer';
import type { UnitType, ParsedUnit } from '@/lib/sourcing/unit-parser';

// ─────────────────────────────────────────────────────────────────────────────
// Vercel 함수 실행 시간 설정 (초) — Pro plan 최대값
// ─────────────────────────────────────────────────────────────────────────────
export const maxDuration = 300;

// ─────────────────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────────────────

/** 상품 간 API 호출 딜레이 (ms) — Rate Limiting 방지 */
const NAVER_CALL_DELAY_MS = 200;

/** 시장가 갱신 주기 (일) — 이 기간보다 오래된 데이터만 재수집 */
const MARKET_PRICE_REFRESH_DAYS = 7;

/**
 * 함수 종료 전 안전 마진 (ms)
 * 남은 실행 시간이 이 값 미만이면 루프를 조기 종료한다.
 * 소싱 스코어 재계산 + 응답 전송 시간을 여유 있게 확보.
 */
const DEADLINE_SAFETY_MARGIN_MS = 30_000;

// ─────────────────────────────────────────────────────────────────────────────
// 입력 스키마
// ─────────────────────────────────────────────────────────────────────────────

const bodySchema = z.object({
  /**
   * 이번 실행에서 처리할 최대 상품 수 (기본 50, 최대 100)
   * 네이버 API 응답이 느릴 때 maxDuration(300s) 초과를 방지하기 위해
   * 내부 deadline 추적으로 추가 방어함
   */
  limit: z.number().int().positive().max(100).default(50),
});

// ─────────────────────────────────────────────────────────────────────────────
// DB 행 타입
// ─────────────────────────────────────────────────────────────────────────────

interface ProductRow {
  id: string;
  product_code: string;
  title: string;
  /** 단위 유형 — 있으면 단가 비교, 없으면 총액 fallback */
  unit_type: UnitType | null;
  total_quantity: string | null;   // numeric → pg driver가 string으로 반환
  base_unit: string | null;
  unit_price_label: string | null;
  unit_price_divisor: number | null; // 100 (weight/volume) 또는 1 (count)
  unit_price: string | null;         // numeric → pg driver가 string으로 반환 (100g/100ml/개당 코스트코 단가)
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/** ms 단위 딜레이 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Cron 인증 — CRON_SECRET 미설정 시 통과 (로컬/개발 환경 허용)
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. 요청 body 파싱 및 검증
  const rawBody = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { limit } = parsed.data;

  const pool = getSourcingPool();

  // 3. 수집 대상 상품 조회
  //    단위 파싱 결과(unit_type, total_quantity 등)도 함께 조회
  //    조건: is_active=true AND (market_price_source != 'naver_api' OR 갱신일 7일 초과)
  let products: ProductRow[];
  try {
    const res = await pool.query<ProductRow>(
      `SELECT id, product_code, title,
              unit_type, total_quantity, base_unit, unit_price_label, unit_price,
              CASE unit_type
                WHEN 'weight' THEN 100
                WHEN 'volume' THEN 100
                WHEN 'count'  THEN 1
                ELSE NULL
              END AS unit_price_divisor
       FROM public.costco_products
       WHERE is_active = true
         AND (
           market_price_source IS DISTINCT FROM 'naver_api'
           OR market_price_updated_at IS NULL
           OR market_price_updated_at < NOW() - INTERVAL '${MARKET_PRICE_REFRESH_DAYS} days'
         )
       ORDER BY market_price_updated_at ASC NULLS FIRST
       LIMIT $1`,
      [limit],
    );
    products = res.rows;
  } catch (err) {
    console.error('[costco/naver-prices] 상품 조회 실패:', err);
    return NextResponse.json({ error: 'DB 조회 실패' }, { status: 500 });
  }

  if (products.length === 0) {
    return NextResponse.json({ success: true, updated: 0, failed: 0, skipped: 0 });
  }

  // 4. 상품별 네이버 쇼핑 API 호출 및 저장
  //
  // deadline 추적: maxDuration(300s) 내에서 안전하게 완료하기 위해
  // 매 반복마다 경과 시간을 확인하고, 남은 시간이 안전 마진(30s) 미만이면
  // 루프를 조기 종료한다. 이를 통해 Vercel의 강제 타임아웃을 방지한다.
  const startedAt = Date.now();
  const hardDeadlineMs = maxDuration * 1_000 - DEADLINE_SAFETY_MARGIN_MS; // 270,000ms

  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (const product of products) {
    // 남은 실행 시간이 안전 마진 미만이면 조기 종료
    if (Date.now() - startedAt >= hardDeadlineMs) {
      console.warn(
        `[costco/naver-prices] deadline 도달, 조기 종료 (처리=${updated + failed + skipped}/${products.length})`,
      );
      break;
    }

    try {
      // unit_type이 있으면 단가 기반 검색, 없으면 총액 기반 fallback
      let lowestPrice: number | null = null;
      let marketUnitPrice: number | null = null;
      let marketUnitTitle: string | null = null;

      if (
        product.unit_type &&
        product.total_quantity &&
        product.unit_price_label &&
        product.unit_price_divisor !== null
      ) {
        // ParsedUnit 재구성 (DB 저장값 기반)
        const costcoUnit: ParsedUnit = {
          unitType: product.unit_type,
          totalQuantity: parseFloat(product.total_quantity),
          baseUnit: product.base_unit ?? (product.unit_type === 'weight' ? 'g' : product.unit_type === 'volume' ? 'ml' : '개'),
          unitPriceDivisor: product.unit_price_divisor,
          unitPriceLabel: product.unit_price_label,
        };

        const unitResult = await searchNaverUnitPrice(
          product.title,
          costcoUnit,
          product.unit_price ? parseFloat(product.unit_price) : undefined,
        );

        if (unitResult !== null) {
          lowestPrice = unitResult.totalPrice;
          marketUnitPrice = unitResult.unitPrice;
          marketUnitTitle = unitResult.naverTitle;
        }
      }

      // 단가 검색 실패 또는 unit_type 없는 경우 → 총액 최저가 fallback
      if (lowestPrice === null) {
        lowestPrice = await searchNaverLowestPrice(product.title);
      }

      if (lowestPrice === null) {
        // API 정상 응답이지만 가격 정보 없음 → 건너뜀
        skipped++;
        await delay(NAVER_CALL_DELAY_MS);
        continue;
      }

      // 5. costco_market_prices 이력 테이블 upsert
      await pool.query(
        `INSERT INTO public.costco_market_prices
           (product_id, product_code, market_price, source, logged_at)
         VALUES ($1, $2, $3, 'naver_api', CURRENT_DATE)
         ON CONFLICT (product_code, logged_at, source)
         DO UPDATE SET market_price = EXCLUDED.market_price`,
        [product.id, product.product_code, lowestPrice],
      );

      // 6. costco_products 마스터 업데이트 (단가 컬럼 포함)
      await pool.query(
        `UPDATE public.costco_products
         SET market_lowest_price     = $1,
             market_price_source     = 'naver_api',
             market_price_updated_at = now(),
             market_unit_price       = $3,
             market_unit_title       = $4,
             updated_at              = now()
         WHERE product_code = $2`,
        [lowestPrice, product.product_code, marketUnitPrice, marketUnitTitle],
      );

      updated++;
    } catch (err) {
      // 개별 상품 실패 → 로그 후 계속 진행 (전체 중단 금지)
      console.error(
        `[costco/naver-prices] 상품 처리 실패 (code=${product.product_code}):`,
        err,
      );
      failed++;
    }

    // Rate Limiting: 상품 간 딜레이
    await delay(NAVER_CALL_DELAY_MS);
  }

  // 7. 소싱 스코어 재계산 (업데이트된 상품이 1개 이상일 때만)
  if (updated > 0) {
    try {
      await recalculateSourcingScores(pool);
    } catch (err) {
      // 스코어 재계산 실패는 치명적이지 않으므로 경고만 출력
      console.error('[costco/naver-prices] 소싱 스코어 재계산 실패:', err);
    }
  }

  console.log(
    `[costco/naver-prices] 완료: 대상=${products.length}, 업데이트=${updated}, 실패=${failed}, 스킵=${skipped}`,
  );

  return NextResponse.json({ success: true, updated, failed, skipped });
}
