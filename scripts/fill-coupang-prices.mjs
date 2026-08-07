/**
 * scripts/fill-coupang-prices.mjs
 * 도매꾹 소싱 후보의 쿠팡 실판매가를 파트너스 오픈API로 수집해서 Render DB에 저장
 *
 * 왜 필요한가:
 *   sourcing_items.coupang_lowest_price 가 45만 건 전량 비어 있어 마진 판정이 불가능하다.
 *   네이버 쇼핑 API로 대체 시도했으나 쿠팡 실판가의 2~3배로 나와 판정이 뒤집혔다
 *   (예: 접이식 쓰레기통 — 네이버 25분위 15,160원 vs 쿠팡 실판가 5,490원).
 *
 * 사전 준비:
 *   .env.local 에 파트너스 오픈API 키 추가
 *     COUPANG_PARTNERS_ACCESS_KEY=...
 *     COUPANG_PARTNERS_SECRET_KEY=...
 *   ※ Wing 오픈API 키(COUPANG_ACCESS_KEY)와 다른 키다. 파트너스 계정에서 별도 발급한다.
 *
 * 사용법:
 *   node scripts/fill-coupang-prices.mjs                  # 기본 50건
 *   node scripts/fill-coupang-prices.mjs 200              # 200건
 *   node scripts/fill-coupang-prices.mjs 50 --dry         # DB 저장 없이 출력만
 *   node scripts/fill-coupang-prices.mjs 50 --recheck     # 이미 수집된 것도 다시
 */

import pg from 'pg';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 로켓그로스 손익 상수 ─────────────────────────────────────────────────────
// 20-wiki/outputs/1688 진입 카테고리 필터 2026-07-28 의 확정 기준
const COMMISSION_RATE = 0.108; // 쿠팡 판매수수료
const LOGISTICS_FEE = 1725; // 로켓그로스 극소형 물류비
const TARGET_MARGIN_RATE = 0.3; // 목표 마진율
const MARGIN_TO_LOGISTICS = 1.5; // 개당 마진 ≥ 물류비 1.5배

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
// 도매꾹 상품명은 키워드 나열형이라 앞 N단어만 자르면 상품 정체를 놓친다.
// (예: "접이식 쓰레기통 걸이형휴지통 …" → "캠핑 쓰레기통"으로 검색되어 대형 트래쉬박스를 잡았다)
// 그래서 앞구간·중간구간 두 개를 만들어 both 검색하고 결과를 합친다.
function buildQueries(title) {
  let q = title
    .replace(/\[[^\]]*\]/g, ' ') // [판매자태그]
    .replace(/\([^)]*\)/g, ' ') // (부가설명)
    .replace(/[A-Z]{2,}[-_]?\d{3,}/g, ' ') // 모델코드 GTF58047
    .replace(/[/\\+&_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const words = q.split(/\s+/).filter((w) => w.length > 1 && !/^\d+$/.test(w));
  if (words.length === 0) return [title.split(/\s+/).slice(0, 3).join(' ')];

  const queries = [words.slice(0, 4).join(' ')];
  if (words.length >= 6) queries.push(words.slice(2, 6).join(' '));
  return queries;
}

// ── 손익분기 판매가 ──────────────────────────────────────────────────────────
// 두 조건을 모두 만족하는 최소 판매가를 구한다.
//   ① 마진율 ≥ 30%          → P ≥ (원가 + 물류비) / (1 - 수수료 - 목표마진율)
//   ② 개당 마진 ≥ 물류비×1.5 → P ≥ (원가 + 물류비 + 물류비×1.5) / (1 - 수수료)
function breakEvenPrice(cost) {
  const byRate = (cost + LOGISTICS_FEE) / (1 - COMMISSION_RATE - TARGET_MARGIN_RATE);
  const byAmount =
    (cost + LOGISTICS_FEE + LOGISTICS_FEE * MARGIN_TO_LOGISTICS) / (1 - COMMISSION_RATE);
  return Math.ceil(Math.max(byRate, byAmount));
}

function marginOf(sellingPrice, cost) {
  return sellingPrice * (1 - COMMISSION_RATE) - LOGISTICS_FEE - cost;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
async function main() {
  const env = loadEnv();
  const accessKey = env.COUPANG_PARTNERS_ACCESS_KEY;
  const secretKey = env.COUPANG_PARTNERS_SECRET_KEY;

  if (!accessKey || !secretKey) {
    console.error(
      '❌ .env.local 에 COUPANG_PARTNERS_ACCESS_KEY / COUPANG_PARTNERS_SECRET_KEY 가 없습니다.\n' +
        '   쿠팡 파트너스 → 오픈API 메뉴에서 발급하세요. Wing 오픈API 키와는 다른 키입니다.',
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const limit = parseInt(args.find((a) => /^\d+$/.test(a)) ?? '50', 10);
  const dryRun = args.includes('--dry');
  const recheck = args.includes('--recheck');

  const pool = new pg.Pool({
    connectionString: env.SOURCING_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const { rows } = await pool.query(
    `SELECT item_no, title, price_dome, moq
       FROM sourcing_items
      WHERE legal_status = 'safe'
        AND price_dome BETWEEN 2000 AND 9000
        AND moq <= 3
        ${recheck ? '' : 'AND coupang_lowest_price IS NULL'}
      ORDER BY updated_at DESC
      LIMIT $1`,
    [limit],
  );

  console.log(`대상 ${rows.length}건 (dry-run: ${dryRun})\n`);
  console.log(
    ['판정', '마진율', '마진', '도매가', '손익분기', '쿠팡최저', '로켓', '상품'].join('\t'),
  );

  let pass = 0;
  let fail = 0;
  let noData = 0;

  for (const row of rows) {
    const cost = row.price_dome;
    const be = breakEvenPrice(cost);

    let products = [];
    for (const q of buildQueries(row.title)) {
      try {
        products.push(...(await searchCoupang(q, accessKey, secretKey)));
      } catch (err) {
        console.error(`  ⚠️ ${row.item_no} 검색 실패: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 200)); // 호출 간격
    }

    const priced = products
      .map((p) => ({ price: Number(p.productPrice), rocket: !!p.isRocket }))
      .filter((p) => Number.isFinite(p.price) && p.price >= 1000)
      .sort((a, b) => a.price - b.price);

    if (priced.length < 3) {
      noData++;
      console.log(
        ['⚠️', '-', '-', cost, be, '표본부족', '-', row.title.slice(0, 34)].join('\t'),
      );
      continue;
    }

    // 진입 기준가는 최저가가 아니라 하위 25% — 최저가는 스펙이 다른 상품인 경우가 많다
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
        row.title.slice(0, 34),
      ].join('\t'),
    );

    if (!dryRun) {
      await pool.query(
        `UPDATE sourcing_items
            SET coupang_lowest_price = $1,
                has_rocket           = $2,
                market_updated_at    = now()
          WHERE item_no = $3`,
        [p25, rocketRate >= 0.5, row.item_no],
      );
    }
  }

  console.log(`\n통과 ${pass} / 탈락 ${fail} / 표본부족 ${noData}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
