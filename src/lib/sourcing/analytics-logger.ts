/**
 * analytics-logger.ts
 * 4계층 데이터 추적 시스템 — Layer 1·2 로깅
 *
 * 설계 원칙:
 *   1. fire-and-forget: 로깅 실패가 비즈니스 로직을 중단시키지 않음
 *   2. 일일 중복 방지: ON CONFLICT (channel, product_id, date) 로 같은 날 같은 상품은 upsert
 *   3. 배치 INSERT: 개별 INSERT 대신 다중 VALUES로 네트워크 왕복 최소화
 *   4. 서버 전용: API Route 레벨에서만 사용 (클라이언트 호출 금지)
 */

import { getSourcingPool } from '@/lib/sourcing/db';
import { getGrade } from '@/lib/sourcing/shared/grade';

// ─────────────────────────────────────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────────────────────────────────────

export interface DiscoveryLogEntry {
  channelSource: 'costco' | 'domeggook';
  productId: string;
  productName: string;
  category: string | null;
  scoreTotal: number | null;
  scoreBreakdown: Record<string, number> | null;
  grade: string | null;
  recommendedPriceNaver: number | null;
  recommendedPriceCoupang: number | null;
  maleScore: number | null;
  maleTier: string | null;
  seasonBonus: number | null;
  seasonLabels: string[];
  needsReview: boolean;
  blockedReason: string | null;
}

export interface RegistrationEntry {
  discoveryLogId: number | null;
  platform: 'naver' | 'coupang';
  platformProductId: string | null;
  productName: string;
  categoryPath: string | null;
  actualListedPrice: number;
  actualBundleStrategy: string | null;
  titleUsed: string;
  keywordsUsed: string[];
  thumbnailUrl: string | null;
  systemRecommendedPrice: number | null;
  wholesaleCost: number | null;
  shippingCostEstimate: number | null;
}

/** CSV 임포트 결과 (Phase 4-D 구현 예정) */
export interface ImportResult {
  batchId: string;
  totalRows: number;
  insertedRows: number;
  duplicateRows: number;
  errorRows: number;
  errors: Array<{ row: number; message: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 인메모리 당일 중복 방지 (같은 serverless 인스턴스 내에서 반복 호출 억제)
// 참고: serverless 인스턴스마다 독립이므로 DB 레벨 ON CONFLICT가 최종 보루
// ─────────────────────────────────────────────────────────────────────────────

const _memCache = new Map<string, string>(); // key → date

function _shouldLog(channelSource: string, productId: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const key = `${channelSource}:${productId}`;
  const cached = _memCache.get(key);
  if (cached === today) return false;
  _memCache.set(key, today);
  // 캐시가 50,000건 초과하면 클리어 (메모리 보호)
  if (_memCache.size > 50_000) _memCache.clear();
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1: Discovery 배치 upsert
// ─────────────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 100;
const INSERT_COLS = 15; // 아래 INSERT 컬럼 수와 일치해야 함

/**
 * 스캔 결과를 discovery_logs에 배치 upsert
 * 같은 날 같은 (channel, product_id)는 스코어만 갱신 (사용자 액션 보존)
 *
 * @returns 처리된 항목 수 (실패 시 0, 예외 전파 없음)
 */
export async function logDiscoveryBatch(
  entries: DiscoveryLogEntry[],
): Promise<number> {
  if (entries.length === 0) return 0;

  // 인메모리 필터로 반복 호출 억제
  const toLog = entries.filter((e) => _shouldLog(e.channelSource, e.productId));
  if (toLog.length === 0) return 0;

  const pool = getSourcingPool();
  let totalUpserted = 0;

  try {
    for (let i = 0; i < toLog.length; i += BATCH_SIZE) {
      const batch = toLog.slice(i, i + BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders: string[] = [];

      batch.forEach((e, idx) => {
        const o = idx * INSERT_COLS; // offset
        // grade가 없으면 scoreTotal에서 계산
        const grade =
          e.grade ??
          (e.scoreTotal != null ? getGrade(e.scoreTotal).grade : null);

        placeholders.push(
          `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, ` +
          `$${o + 6}, $${o + 7}::jsonb, $${o + 8}, $${o + 9}, $${o + 10}, ` +
          `$${o + 11}, $${o + 12}, $${o + 13}, $${o + 14}, $${o + 15})`,
        );

        values.push(
          e.channelSource,                            // $1  channel_source
          e.productId,                                // $2  product_id
          e.productName,                              // $3  product_name
          e.category,                                 // $4  category
          e.scoreTotal,                               // $5  score_total
          grade,                                      // $6  grade
          e.scoreBreakdown ? JSON.stringify(e.scoreBreakdown) : null, // $7 score_breakdown
          e.recommendedPriceNaver,                    // $8  recommended_price_naver
          e.recommendedPriceCoupang,                  // $9  recommended_price_coupang
          e.maleScore,                                // $10 male_score
          e.maleTier,                                 // $11 male_tier
          e.seasonBonus,                              // $12 season_bonus
          e.seasonLabels.length > 0 ? e.seasonLabels : null, // $13 season_labels (TEXT[])
          e.needsReview,                              // $14 needs_review
          e.blockedReason,                            // $15 blocked_reason
        );
      });

      await pool.query(
        `INSERT INTO public.discovery_logs (
          channel_source, product_id, product_name, category,
          score_total, grade, score_breakdown,
          recommended_price_naver, recommended_price_coupang,
          male_score, male_tier, season_bonus, season_labels,
          needs_review, blocked_reason
        )
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (channel_source, product_id, (scanned_at::date))
        DO UPDATE SET
          score_total               = EXCLUDED.score_total,
          grade                     = EXCLUDED.grade,
          score_breakdown           = EXCLUDED.score_breakdown,
          recommended_price_naver   = EXCLUDED.recommended_price_naver,
          recommended_price_coupang = EXCLUDED.recommended_price_coupang,
          male_score                = EXCLUDED.male_score,
          male_tier                 = EXCLUDED.male_tier,
          season_bonus              = EXCLUDED.season_bonus,
          season_labels             = EXCLUDED.season_labels,
          needs_review              = EXCLUDED.needs_review,
          blocked_reason            = EXCLUDED.blocked_reason
          -- operator_action / action_at / action_note 는 보존 (갱신 안 함)`,
        values,
      );

      totalUpserted += batch.length;
    }
  } catch (err) {
    // fire-and-forget: 로깅 실패는 콘솔에만 기록, 호출자로 전파 안 함
    console.error('[analytics-logger] logDiscoveryBatch 실패:', err);
    return 0;
  }

  return totalUpserted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1: 사용자 액션 기록
// ─────────────────────────────────────────────────────────────────────────────

/**
 * discovery_log에 사용자 의사결정을 기록
 * Phase 4-B [등록완료] / [스킵] / [북마크] 버튼에서 호출
 */
export async function updateDiscoveryAction(
  discoveryLogId: number,
  action: 'registered' | 'skipped' | 'bookmarked',
  note?: string,
): Promise<void> {
  const pool = getSourcingPool();
  try {
    await pool.query(
      `UPDATE public.discovery_logs
       SET operator_action = $1,
           action_at       = NOW(),
           action_note     = $2
       WHERE id = $3`,
      [action, note ?? null, discoveryLogId],
    );
  } catch (err) {
    console.error('[analytics-logger] updateDiscoveryAction 실패:', err);
  }
}

/**
 * 상품 ID + 채널로 오늘의 discovery_log id를 역조회
 * (Phase 4-B 등록 모달에서 discovery_log_id를 찾을 때 사용)
 */
export async function findTodayDiscoveryLogId(
  channelSource: 'costco' | 'domeggook',
  productId: string,
): Promise<number | null> {
  const pool = getSourcingPool();
  try {
    const result = await pool.query<{ id: number }>(
      `SELECT id
       FROM public.discovery_logs
       WHERE channel_source = $1
         AND product_id     = $2
         AND scanned_at::date = CURRENT_DATE
       ORDER BY scanned_at DESC
       LIMIT 1`,
      [channelSource, productId],
    );
    return result.rows[0]?.id ?? null;
  } catch (err) {
    console.error('[analytics-logger] findTodayDiscoveryLogId 실패:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2: Registration 기록
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 상품 등록 시 registrations에 기록 + discovery_log에 액션 업데이트
 * @returns 생성된 registration.id (실패 시 null)
 */
export async function logRegistration(
  entry: RegistrationEntry,
): Promise<number | null> {
  const pool = getSourcingPool();
  try {
    const deviation =
      entry.systemRecommendedPrice && entry.systemRecommendedPrice > 0
        ? (entry.actualListedPrice - entry.systemRecommendedPrice) /
          entry.systemRecommendedPrice
        : null;

    const result = await pool.query<{ id: number }>(
      `INSERT INTO public.registrations (
        discovery_log_id, platform, platform_product_id,
        product_name, category_path,
        actual_listed_price, actual_bundle_strategy,
        title_used, keywords_used, thumbnail_url,
        system_recommended_price, price_deviation,
        wholesale_cost, shipping_cost_estimate
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
      )
      RETURNING id`,
      [
        entry.discoveryLogId,
        entry.platform,
        entry.platformProductId,
        entry.productName,
        entry.categoryPath,
        entry.actualListedPrice,
        entry.actualBundleStrategy,
        entry.titleUsed,
        entry.keywordsUsed.length > 0 ? entry.keywordsUsed : null,
        entry.thumbnailUrl,
        entry.systemRecommendedPrice,
        deviation,
        entry.wholesaleCost,
        entry.shippingCostEstimate,
      ],
    );

    const registrationId = result.rows[0]?.id ?? null;

    // discovery_log에 등록 완료 액션 기록
    if (entry.discoveryLogId) {
      void updateDiscoveryAction(entry.discoveryLogId, 'registered');
    }

    return registrationId;
  } catch (err) {
    console.error('[analytics-logger] logRegistration 실패:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 3·4: CSV 임포트 인터페이스 (Phase 4-D 구현 예정)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CSV 파서가 반환해야 하는 표준 구조
 * 실제 파서 구현은 정산 CSV 파일 수령 후 Phase 4-D에서 진행
 */
export interface SalesEventCSVRow {
  platformOrderId: string;
  soldAt: string;           // ISO 8601
  platform: 'naver' | 'coupang';
  productName: string;      // registrations 매칭용
  quantity: number;
  unitPrice: number;
  grossRevenue: number;
  buyerRegion?: string;
}

export interface SettlementCSVRow {
  platformOrderId: string;  // sales_events 매칭용
  settledAt: string;
  channelFee: number;
  wholesaleCost: number;
  shippingCost: number;
  adCost?: number;
  promoDiscount?: number;
  isReturned?: boolean;
  returnReason?: string;
  returnCost?: number;
}
