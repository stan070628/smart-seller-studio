/**
 * scripts/fix-costco-unit-prices.ts
 * 코스트코 상품 중 이상치 market_unit_price를 초기화하고
 * 수정된 parseProductUnit 로직으로 재수집
 *
 * 사용법:
 *   npx tsx scripts/fix-costco-unit-prices.ts         # 기본 50건
 *   npx tsx scripts/fix-costco-unit-prices.ts 100     # 최대 100건
 *   npx tsx scripts/fix-costco-unit-prices.ts reset   # 이상치 초기화만
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseProductUnit } from '../src/lib/sourcing/unit-parser';
import { normalizeForUnitSearch } from '../src/lib/sourcing/naver-shopping';
import type { ParsedUnit } from '../src/lib/sourcing/unit-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── env 로드 ─────────────────────────────────────────────────────────────────
function loadEnv(): Record<string, string> {
  const envPath = resolve(__dirname, '../.env.local');
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  const env: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  return env;
}

// ── Naver API 단위가격 검색 ───────────────────────────────────────────────────
interface NaverItem {
  title: string;
  lprice: string;
  mallName: string;
}

interface NaverUnitResult {
  totalPrice: number;
  unitPrice: number;
  unitPriceLabel: string;
  naverTitle: string;
}

async function searchNaverUnitPrice(
  query: string,
  costcoUnit: ParsedUnit,
  costcoUnitPrice: number | undefined,
  clientId: string,
  clientSecret: string,
): Promise<NaverUnitResult | null> {
  const normalizedQuery = normalizeForUnitSearch(query);
  const url = new URL('https://openapi.naver.com/v1/search/shop.json');
  url.searchParams.set('query', normalizedQuery);
  url.searchParams.set('display', '20');
  url.searchParams.set('sort', 'sim');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const data = await res.json() as { items: NaverItem[] };
    if (!data.items?.length) return null;

    let bestUnitPrice = Infinity;
    let bestResult: NaverUnitResult | null = null;

    for (const item of data.items) {
      const totalPrice = parseInt(item.lprice, 10);
      if (isNaN(totalPrice) || totalPrice <= 0) continue;

      const cleanTitle = item.title.replace(/<[^>]+>/g, '');
      const parseResult = parseProductUnit(cleanTitle);
      if (!parseResult.success) continue;
      if (parseResult.parsed.unitType !== costcoUnit.unitType) continue;

      const { totalQuantity, unitPriceDivisor, unitPriceLabel } = parseResult.parsed;
      if (totalQuantity <= 0) continue;

      const itemUnitPrice = Math.round((totalPrice / totalQuantity) * unitPriceDivisor * 100) / 100;

      // 이상치 필터: 코스트코 단가 대비 0.3x ~ 30x 범위 밖 제외
      if (costcoUnitPrice && costcoUnitPrice > 0) {
        const ratio = itemUnitPrice / costcoUnitPrice;
        if (ratio < 0.3 || ratio > 30) continue;
      }

      if (itemUnitPrice < bestUnitPrice) {
        bestUnitPrice = itemUnitPrice;
        bestResult = {
          totalPrice,
          unitPrice: itemUnitPrice,
          unitPriceLabel,
          naverTitle: cleanTitle,
        };
      }
    }

    if (bestResult) {
      console.log(`    "${normalizedQuery}" → ${bestResult.unitPrice.toLocaleString()}원/${bestResult.unitPriceLabel}`);
    } else {
      console.log(`    "${normalizedQuery}" → 매칭 없음`);
    }

    return bestResult;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.log(`    타임아웃: "${normalizedQuery}"`);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  const env = loadEnv();
  const clientId = env.NAVER_CLIENT_ID;
  const clientSecret = env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET 없음');
    process.exit(1);
  }

  const arg = process.argv[2] ?? '50';
  const resetOnly = arg === 'reset';
  const limit = resetOnly ? 999 : parseInt(arg, 10);

  const pool = new pg.Pool({
    connectionString: env.SOURCING_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  // ── Step 1: 이상치 초기화 ─────────────────────────────────────────────────
  // market_unit_price / unit_price > 30 이거나 < 0.3인 경우를 이상치로 판단
  const resetResult = await pool.query<{ product_code: string; title: string }>(
    `UPDATE public.costco_products
     SET market_unit_price       = NULL,
         market_unit_title       = NULL,
         market_price_updated_at = NULL,
         updated_at              = now()
     WHERE is_active = true
       AND market_unit_price IS NOT NULL
       AND unit_price IS NOT NULL
       AND unit_price > 0
       AND (
         market_unit_price / unit_price > 30
         OR market_unit_price / unit_price < 0.3
       )
     RETURNING product_code, title`,
  );

  console.log(`\n이상치 초기화: ${resetResult.rowCount}건`);
  for (const r of resetResult.rows) {
    console.log(`  - ${r.title} (${r.product_code})`);
  }

  if (resetOnly) {
    console.log('\n초기화만 완료. 재수집은 Cron 또는 재실행으로 진행.\n');
    await pool.end();
    return;
  }

  // ── Step 2: 재수집 대상 조회 ─────────────────────────────────────────────
  // 초기화된 상품 + 기존 미수집 상품
  const { rows: products } = await pool.query<{
    id: string;
    product_code: string;
    title: string;
    unit_type: string | null;
    total_quantity: string | null;
    base_unit: string | null;
    unit_price_label: string | null;
    unit_price: string | null;
    unit_price_divisor: number | null;
  }>(
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
       AND unit_type IS NOT NULL
       AND unit_price IS NOT NULL
       AND (
         market_unit_price IS NULL
         OR market_price_updated_at IS NULL
         OR market_price_updated_at < NOW() - INTERVAL '7 days'
       )
     ORDER BY market_price_updated_at ASC NULLS FIRST
     LIMIT $1`,
    [limit],
  );

  console.log(`\n재수집 대상: ${products.length}건\n`);

  let updated = 0, failed = 0, skipped = 0;

  for (const product of products) {
    const seq = updated + failed + skipped + 1;
    console.log(`[${seq}/${products.length}] ${product.title}`);

    if (
      !product.unit_type ||
      !product.total_quantity ||
      !product.unit_price_label ||
      product.unit_price_divisor === null
    ) {
      console.log('  → 단위 정보 없음, 스킵');
      skipped++;
      await delay(200);
      continue;
    }

    const costcoUnit: ParsedUnit = {
      unitType: product.unit_type as 'weight' | 'volume' | 'count',
      totalQuantity: parseFloat(product.total_quantity),
      baseUnit: product.base_unit ?? (product.unit_type === 'weight' ? 'g' : product.unit_type === 'volume' ? 'ml' : '개'),
      unitPriceDivisor: product.unit_price_divisor,
      unitPriceLabel: product.unit_price_label,
    };

    const costcoUnitPrice = product.unit_price ? parseFloat(product.unit_price) : undefined;

    try {
      const result = await searchNaverUnitPrice(
        product.title,
        costcoUnit,
        costcoUnitPrice,
        clientId,
        clientSecret,
      );

      if (result === null) {
        skipped++;
        await delay(200);
        continue;
      }

      // 이력 테이블
      await pool.query(
        `INSERT INTO public.costco_market_prices
           (product_id, product_code, market_price, source, logged_at)
         VALUES ($1, $2, $3, 'naver_api', CURRENT_DATE)
         ON CONFLICT (product_code, logged_at, source)
         DO UPDATE SET market_price = EXCLUDED.market_price`,
        [product.id, product.product_code, result.totalPrice],
      );

      // 마스터 업데이트
      await pool.query(
        `UPDATE public.costco_products
         SET market_lowest_price     = $1,
             market_price_source     = 'naver_api',
             market_price_updated_at = now(),
             market_unit_price       = $3,
             market_unit_title       = $4,
             updated_at              = now()
         WHERE product_code = $2`,
        [result.totalPrice, product.product_code, result.unitPrice, result.naverTitle],
      );

      updated++;
    } catch (err) {
      console.error('  DB 저장 실패:', (err as Error).message);
      failed++;
    }

    await delay(200);
  }

  console.log(`\n완료: 업데이트=${updated}, 스킵=${skipped}, 실패=${failed}\n`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
