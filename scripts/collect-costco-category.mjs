/**
 * scripts/collect-costco-category.mjs
 * 특정 OCC 카테고리 코드의 코스트코 상품을 수집해서 Render DB에 저장
 *
 * 사용법:
 *   node scripts/collect-costco-category.mjs cos_8.3.8
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
    env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  return env;
}

// ── OCC API 호출 ─────────────────────────────────────────────────────────────
async function fetchSubcategory(occCode, page = 0) {
  const params = new URLSearchParams({
    fields: 'FULL',
    query: `:relevance:category:${occCode}`,
    pageSize: '48',
    currentPage: String(page),
    lang: 'ko',
    curr: 'KRW',
  });

  const url = `https://www.costco.co.kr/rest/v2/korea/products/search?${params}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`OCC ${res.status}`);
  return res.json();
}

// ── DB upsert ────────────────────────────────────────────────────────────────
async function upsertProduct(pool, product, categoryName) {
  const imageUrl = (() => {
    const imgs = product.images ?? [];
    const img = imgs.find(i => i.imageType === 'PRIMARY' && i.format === 'product')
      ?? imgs.find(i => i.imageType === 'PRIMARY')
      ?? imgs[0];
    const u = img?.url;
    if (!u) return null;
    return u.startsWith('http') ? u : `https://www.costco.co.kr${u}`;
  })();

  const productUrl = product.url
    ? (product.url.startsWith('http') ? product.url : `https://www.costco.co.kr${product.url}`)
    : `https://www.costco.co.kr/p/${product.code}`;

  const price = product.price?.value ?? 0;
  const stockStatus = product.stock?.stockLevelStatus === 'outOfStock' ? 'outOfStock'
    : product.stock?.stockLevelStatus === 'lowStock' ? 'lowStock' : 'inStock';

  await pool.query(
    `INSERT INTO public.costco_products
       (product_code, title, category_name, category_code, price, original_price,
        image_url, product_url, brand, average_rating, review_count, stock_status,
        first_price, lowest_price, is_active, collected_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$5,$5,true,now())
     ON CONFLICT (product_code) DO UPDATE SET
       title          = EXCLUDED.title,
       category_name  = EXCLUDED.category_name,
       category_code  = EXCLUDED.category_code,
       price          = EXCLUDED.price,
       original_price = EXCLUDED.original_price,
       image_url      = EXCLUDED.image_url,
       product_url    = EXCLUDED.product_url,
       brand          = EXCLUDED.brand,
       average_rating = EXCLUDED.average_rating,
       review_count   = EXCLUDED.review_count,
       stock_status   = EXCLUDED.stock_status,
       first_price    = COALESCE(costco_products.first_price, EXCLUDED.price),
       lowest_price   = LEAST(COALESCE(costco_products.lowest_price, EXCLUDED.price), EXCLUDED.price),
       is_active      = true,
       collected_at   = now(),
       updated_at     = now()`,
    [
      product.code, product.name, categoryName, 'cos_8.3.8',
      price,
      (product.listPrice?.value > price ? product.listPrice.value : null),
      imageUrl, productUrl, product.manufacturer ?? null,
      product.averageRating ?? null, product.numberOfReviews ?? 0, stockStatus,
    ],
  );
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  const occCode = process.argv[2];
  if (!occCode) {
    console.error('사용법: node scripts/collect-costco-category.mjs <OCC_CODE>');
    console.error('예시:   node scripts/collect-costco-category.mjs cos_8.3.8');
    process.exit(1);
  }

  // OCC 코드 → 카테고리명 매핑 (하드코딩 최소화)
  const CATEGORY_MAP = {
    'cos_8.3.8': '건강·뷰티',
    'cos_8.3.7': '건강·뷰티',
    'cos_8.1.4': '건강·뷰티',
    'cos_8.3.4': '건강·뷰티',
    'cos_8.3.9': '건강·뷰티',
    'cos_10.10.6': '식품', 'cos_10.3.3': '식품',
  };
  const categoryName = CATEGORY_MAP[occCode] ?? occCode;

  const env = loadEnv();
  const pool = new pg.Pool({
    connectionString: env.SOURCING_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  console.log(`\n[${occCode}] ${categoryName} 수집 시작\n`);

  let total = 0;
  let page = 0;

  while (true) {
    const data = await fetchSubcategory(occCode, page);
    const products = (data.products ?? []).filter(p => p.code && p.name && (p.price?.value ?? 0) > 0);

    console.log(`  페이지 ${page + 1}: ${products.length}개`);

    for (const product of products) {
      await upsertProduct(pool, product, categoryName);
      total++;
    }

    const pag = data.pagination ?? {};
    if (!products.length || pag.currentPage >= pag.totalPages - 1) break;

    page++;
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n완료: ${total}개 상품 저장\n`);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
