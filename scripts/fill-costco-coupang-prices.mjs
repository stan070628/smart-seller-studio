/**
 * scripts/fill-costco-coupang-prices.mjs
 * 코스트코 소싱 후보의 쿠팡 실판매가를 파트너스 오픈API로 수집해 DB에 저장
 *
 * 왜 필요한가:
 *   costco_products 4,378건의 시세 출처가 전량 naver_api이고 coupang_api는 0건이다.
 *   그런데 네이버 시세는 쿠팡 실판가의 2~3배로 나와 판정이 뒤집힌 전례가 있다
 *   (scripts/fill-coupang-prices.mjs 주석 참조 — 접이식 쓰레기통 네이버 15,160원 vs 쿠팡 5,490원).
 *   실제로 2026-08-09 기준 시세 보유 3,164건 중 795건(25%)이
 *   market_lowest_price < price * 0.3 으로, 매칭이 깨진 것이 눈에 보인다.
 *
 *   실사례: 불스원 2in1 초극세사 먼지털이개(676106)
 *     - 코스트코 11,990원 / 네이버 매칭 1,470원(오류) / 쿠팡 실판가 동급 세트 12,400원
 *     - 어느 쪽이든 마진은 안 나오지만, 근거가 틀린 판정은 반대 방향으로도 틀린다.
 *
 * 사전 준비:
 *   .env.local 에 파트너스 오픈API 키 추가 (Wing 오픈API 키와 다른 키다)
 *     COUPANG_PARTNERS_ACCESS_KEY=...
 *     COUPANG_PARTNERS_SECRET_KEY=...
 *
 * 사용법:
 *   node scripts/fill-costco-coupang-prices.mjs                 # 기본 50건
 *   node scripts/fill-costco-coupang-prices.mjs 200             # 200건
 *   node scripts/fill-costco-coupang-prices.mjs 50 --dry        # DB 저장 없이 출력만
 *   node scripts/fill-costco-coupang-prices.mjs 50 --recheck    # 이미 쿠팡 시세가 있는 것도 다시
 *   node scripts/fill-costco-coupang-prices.mjs --code 676106   # 특정 상품만
 */

import pg from 'pg';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 판매자배송 손익 상수 ─────────────────────────────────────────────────────
// 코스트코 품목은 도매꾹 소품과 달리 부피가 커서 로켓그로스 극소형 물류비(1,725원)를
// 그대로 쓰면 안 된다. 판매자배송 택배비를 기본으로 둔다.
const COMMISSION_RATE = 0.108; // 쿠팡 판매수수료
const PARCEL_FEE = 3500; // 판매자배송 택배비 (장척·중형 기준)
const TARGET_MARGIN_RATE = 0.2; // 목표 마진율 (사입이 아니라 매장 매입이라 회전이 느리다)

// ── .env.local 파싱 ──────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(__dirname, '../.env.local');
  const env = {};
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

// ── 파트너스 오픈API HMAC 서명 ───────────────────────────────────────────────
function signedHeaders(method, path, query, accessKey, secretKey) {
  const datetime =
    new Date().toISOString().slice(2, 19).replace(/[-:]/g, '') + 'Z';
  const message = datetime + method + path + query;
  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(message)
    .digest('hex');

  return {
    Authorization: `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`,
    'Content-Type': 'application/json;charset=UTF-8',
  };
}

const PARTNERS_PATH =
  '/v2/providers/affiliate_open_api/apis/openapi/v1/products/search';

async function searchCoupang(keyword, accessKey, secretKey) {
  const query = `keyword=${encodeURIComponent(keyword)}&limit=30`;
  const headers = signedHeaders('GET', PARTNERS_PATH, query, accessKey, secretKey);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(
      `https://api-gateway.coupang.com${PARTNERS_PATH}?${query}`,
      { headers, signal: controller.signal },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status} — ${body.slice(0, 160)}`);
    }
    const json = await res.json();
    return json?.data?.productData ?? [];
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── 검색어 생성 ──────────────────────────────────────────────────────────────
// 코스트코 상품명은 도매꾹의 키워드 나열형과 달리 "브랜드 + 제품명 + 규격" 꼴이다.
//   예: "불스원2 in 1 초극세사 먼지털이개", "커클랜드 시그니춰 아몬드 1.36kg"
// 브랜드를 붙인 검색과 뗀 검색을 둘 다 돌린다.
// 브랜드만 붙이면 그 브랜드 정품만 잡혀 "쿠팡 내 동급 대체품" 시세를 놓치고,
// 브랜드를 떼면 카테고리 평균이 잡힌다. 진입 판단에는 둘 다 필요하다.
function buildQueries(title, brand) {
  const cleaned = title
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\d+(\.\d+)?\s?(kg|g|ml|l|매|개입|팩|입)/gi, ' ') // 용량·수량 표기
    .replace(/[/\\+&_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const words = cleaned.split(/\s+/).filter((w) => w.length > 1);
  if (words.length === 0) return [title.slice(0, 20)];

  const queries = new Set();
  queries.add(words.slice(0, 4).join(' '));

  // 브랜드를 뗀 일반명 검색 — 동급 대체품 시세를 잡기 위해
  if (brand) {
    const b = brand.trim().toLowerCase();
    const noBrand = words.filter((w) => !w.toLowerCase().includes(b) && !b.includes(w.toLowerCase()));
    if (noBrand.length >= 2) queries.add(noBrand.slice(0, 4).join(' '));
  }
  return [...queries];
}

// ── 손익분기 판매가 ──────────────────────────────────────────────────────────
// P * (1 - 수수료) - 택배비 - 매입가 >= P * 목표마진율
//   → P >= (매입가 + 택배비) / (1 - 수수료 - 목표마진율)
function breakEvenPrice(cost) {
  return Math.ceil((cost + PARCEL_FEE) / (1 - COMMISSION_RATE - TARGET_MARGIN_RATE));
}

function marginOf(sellingPrice, cost) {
  return sellingPrice * (1 - COMMISSION_RATE) - PARCEL_FEE - cost;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  const env = loadEnv();
  const accessKey = env.COUPANG_PARTNERS_ACCESS_KEY;
  const secretKey = env.COUPANG_PARTNERS_SECRET_KEY;

  if (!accessKey || !secretKey) {
    console.error(
      '❌ .env.local 에 COUPANG_PARTNERS_ACCESS_KEY / COUPANG_PARTNERS_SECRET_KEY 가 없습니다.\n' +
        '   쿠팡 파트너스(partners.coupang.com) → 오픈API 메뉴에서 발급하세요.\n' +
        '   Wing 오픈API 키(COUPANG_ACCESS_KEY)와는 다른 키입니다.',
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const limit = parseInt(args.find((a) => /^\d+$/.test(a)) ?? '50', 10);
  const dryRun = args.includes('--dry');
  const recheck = args.includes('--recheck');
  const codeIdx = args.indexOf('--code');
  const onlyCode = codeIdx !== -1 ? args[codeIdx + 1] : null;

  const pool = new pg.Pool({
    connectionString: env.SOURCING_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const where = onlyCode
    ? `p.product_code = $1`
    : `p.is_active = true
       AND p.price BETWEEN 3000 AND 80000
       ${recheck ? '' : `AND NOT EXISTS (
           SELECT 1 FROM costco_market_prices m
            WHERE m.product_code = p.product_code
              AND m.source = 'coupang_api'
              AND m.logged_at = CURRENT_DATE)`}`;

  const { rows } = await pool.query(
    `SELECT p.id, p.product_code, p.title, p.brand, p.price
       FROM costco_products p
      WHERE ${where}
      ORDER BY p.sourcing_score DESC NULLS LAST
      LIMIT ${onlyCode ? 1 : '$1'}`,
    onlyCode ? [onlyCode] : [limit],
  );

  console.log(`대상 ${rows.length}건 (dry-run: ${dryRun})\n`);
  console.log(
    ['판정', '마진율', '마진', '코스트코', '손익분기', '쿠팡25%', '로켓', '상품'].join('\t'),
  );

  let pass = 0, fail = 0, noData = 0;

  for (const row of rows) {
    const cost = row.price;
    const be = breakEvenPrice(cost);

    const products = [];
    for (const q of buildQueries(row.title, row.brand)) {
      try {
        products.push(...(await searchCoupang(q, accessKey, secretKey)));
      } catch (err) {
        console.error(`  ⚠️ ${row.product_code} 검색 실패: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    const priced = products
      .map((p) => ({ price: Number(p.productPrice), rocket: !!p.isRocket }))
      .filter((p) => Number.isFinite(p.price) && p.price >= 1000)
      .sort((a, b) => a.price - b.price);

    if (priced.length < 3) {
      noData++;
      console.log(['⚠️', '-', '-', cost, be, '표본부족', '-', row.title.slice(0, 30)].join('\t'));
      continue;
    }

    // 기준가는 최저가가 아니라 하위 25% — 최저가는 스펙이 다른 상품인 경우가 많다
    const p25 = priced[Math.floor(priced.length / 4)].price;
    const rocketRate = priced.filter((p) => p.rocket).length / priced.length;
    const margin = marginOf(p25, cost);
    const rate = (margin / p25) * 100;
    const ok = p25 >= be;
    ok ? pass++ : fail++;

    console.log(
      [
        ok ? '✅' : '❌',
        `${rate.toFixed(0)}%`,
        Math.round(margin).toLocaleString(),
        cost.toLocaleString(),
        be.toLocaleString(),
        p25.toLocaleString(),
        `${(rocketRate * 100).toFixed(0)}%`,
        row.title.slice(0, 30),
      ].join('\t'),
    );

    if (!dryRun) {
      // 이력 테이블에 남기고(UNIQUE product_code+logged_at+source),
      // 요약 컬럼도 함께 갱신해 UI/스코어가 쿠팡 기준을 쓰게 한다.
      await pool.query(
        `INSERT INTO costco_market_prices (product_id, product_code, market_price, source, logged_at)
         VALUES ($1, $2, $3, 'coupang_api', CURRENT_DATE)
         ON CONFLICT (product_code, logged_at, source)
         DO UPDATE SET market_price = EXCLUDED.market_price`,
        [row.id, row.product_code, p25],
      );
      await pool.query(
        `UPDATE costco_products
            SET market_lowest_price = $2,
                market_price_source = 'coupang_api',
                market_price_updated_at = now()
          WHERE id = $1`,
        [row.id, p25],
      );
    }
  }

  console.log(`\n✅ 통과 ${pass} · ❌ 탈락 ${fail} · ⚠️ 표본부족 ${noData}`);
  if (dryRun) console.log('(dry-run이라 DB에 저장하지 않았습니다)');

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
