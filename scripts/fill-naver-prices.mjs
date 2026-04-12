/**
 * scripts/fill-naver-prices.mjs
 * 코스트코 상품 시장 최저가를 네이버 쇼핑 API로 수집해서 Render DB에 저장
 *
 * 사용법:
 *   node scripts/fill-naver-prices.mjs          # 기본 50건
 *   node scripts/fill-naver-prices.mjs 100       # 100건
 */

import pg from 'pg';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── .env.local 파싱 ──────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(__dirname, '../.env.local');
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    env[key] = val;
  }
  return env;
}

// ── 검색어 정규화 (naver-shopping.ts 동일 로직) ──────────────────────────────
function normalizeProductQuery(title) {
  let q = title.trim();
  q = q.replace(/\([^)]*\)/g, '').trim();
  q = q.replace(/\[[^\]]*\]/g, '').trim();

  const UNIT = '(개|팩|박스|세트|입|묶음|통|병|캔|포|매|롤|장|켤레|구|조각|피스|piece|pk|ct)';
  q = q.replace(new RegExp(`[xX×]\\s*\\d+\\s*[xX×]\\s*\\d+`, 'gi'), '');
  q = q.replace(new RegExp(`[xX×]\\s*\\d+\\s*${UNIT}?`, 'gi'), '');
  q = q.replace(new RegExp(`\\d+\\s*${UNIT}`, 'gi'), '');

  const VOL = '(ml|ML|mL|l|L|kg|KG|g|G|mg|MG|oz|fl\\.?oz)';
  q = q.replace(new RegExp(`\\d+(\\.\\d+)?\\s*${VOL}(\\s*[+&]\\s*\\d+(\\.\\d+)?\\s*${VOL})*`, 'gi'), '');
  q = q.replace(/[/\\+&_]+/g, ' ');
  q = q.replace(/\s{2,}/g, ' ').trim();
  q = q.replace(/\s+\d+\s*$/g, '').trim();

  const words = q.split(/\s+/).filter(Boolean);
  if (words.length === 0) return title.split(/\s+/).slice(0, 3).join(' ');
  return words.slice(0, 4).join(' ');
}

// ── 네이버 쇼핑 API 호출 ─────────────────────────────────────────────────────
async function searchNaverLowestPrice(query, clientId, clientSecret) {
  const normalizedQuery = normalizeProductQuery(query);

  const url = new URL('https://openapi.naver.com/v1/search/shop.json');
  url.searchParams.set('query', normalizedQuery);
  url.searchParams.set('display', '5');
  url.searchParams.set('sort', 'asc');

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

    if (!res.ok) {
      console.error(`  [Naver] API 오류 (${res.status}): "${normalizedQuery}"`);
      return null;
    }

    const data = await res.json();
    if (!data.items || data.items.length === 0) return null;

    const lprice = data.items[0].lprice;
    if (!lprice || lprice === '0') return null;
    const parsed = parseInt(lprice, 10);
    if (isNaN(parsed) || parsed <= 0) return null;

    console.log(`  "${normalizedQuery}" → ${parsed.toLocaleString()}원 (${data.items[0].mallName})`);
    return parsed;
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error(`  [Naver] 타임아웃: "${normalizedQuery}"`);
    } else {
      console.error(`  [Naver] 실패: "${normalizedQuery}"`, err.message);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── 딜레이 ───────────────────────────────────────────────────────────────────
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  const limit = parseInt(process.argv[2] ?? '50', 10);
  console.log(`\n코스트코 시장가 수집 시작 (최대 ${limit}건)\n`);

  const pool = new pg.Pool({ connectionString: env.SOURCING_DATABASE_URL, ssl: { rejectUnauthorized: false } });

  // 7일 이상 갱신 안 된 or 미수집 상품 조회
  const { rows: products } = await pool.query(
    `SELECT id, product_code, title
     FROM public.costco_products
     WHERE is_active = true
       AND (
         market_price_source IS DISTINCT FROM 'naver_api'
         OR market_price_updated_at IS NULL
         OR market_price_updated_at < NOW() - INTERVAL '7 days'
       )
     ORDER BY market_price_updated_at ASC NULLS FIRST
     LIMIT $1`,
    [limit],
  );

  console.log(`대상 상품: ${products.length}건\n`);

  let updated = 0, failed = 0, skipped = 0;

  for (const product of products) {
    console.log(`[${updated + failed + skipped + 1}/${products.length}] ${product.title}`);
    const price = await searchNaverLowestPrice(product.title, clientId, clientSecret);

    if (price === null) {
      skipped++;
      await delay(200);
      continue;
    }

    try {
      // 이력 저장
      await pool.query(
        `INSERT INTO public.costco_market_prices
           (product_id, product_code, market_price, source, logged_at)
         VALUES ($1, $2, $3, 'naver_api', CURRENT_DATE)
         ON CONFLICT (product_code, logged_at, source)
         DO UPDATE SET market_price = EXCLUDED.market_price`,
        [product.id, product.product_code, price],
      );

      // 마스터 업데이트
      await pool.query(
        `UPDATE public.costco_products
         SET market_lowest_price     = $1,
             market_price_source     = 'naver_api',
             market_price_updated_at = now(),
             updated_at              = now()
         WHERE product_code = $2`,
        [price, product.product_code],
      );

      updated++;
    } catch (err) {
      console.error(`  DB 저장 실패:`, err.message);
      failed++;
    }

    await delay(200);
  }

  console.log(`\n완료: 업데이트=${updated}, 스킵=${skipped}, 실패=${failed}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
