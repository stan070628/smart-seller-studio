/**
 * 쿠팡 주문/매출 0원 이슈 디버깅용 스크립트
 *
 * 실행: node scripts/debug-coupang-orders.mjs
 *
 * 다음 3가지를 호출해 raw 응답을 출력:
 *   1) ordersheets (status=ACCEPT)
 *   2) ordersheets (status=FINAL_DELIVERY)
 *   3) revenue-history (정산)
 */

import crypto from 'crypto';
import * as path from 'path';
import * as url from 'url';
import * as fs from 'fs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

// ─── env 로드 ──────────────────────────────────────────────────
const envPath = path.join(projectRoot, '.env.local');
if (!fs.existsSync(envPath)) {
  console.error('.env.local not found');
  process.exit(1);
}
const envVars = {};
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) envVars[m[1].trim()] = m[2].trim();
}

const ACCESS_KEY = envVars.COUPANG_ACCESS_KEY;
const SECRET_KEY = envVars.COUPANG_SECRET_KEY;
const VENDOR_ID = envVars.COUPANG_VENDOR_ID;
if (!ACCESS_KEY || !SECRET_KEY || !VENDOR_ID) {
  console.error('COUPANG env missing');
  process.exit(1);
}

const HOST = 'https://api-gateway.coupang.com';

// ─── HMAC 서명 (coupang-client.ts와 동일 로직) ────────────────
function generateAuth(method, urlWithQuery) {
  const [pathOnly, ...qParts] = urlWithQuery.split('?');
  const query = qParts.join('?') || '';

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const datetime =
    String(now.getUTCFullYear()).slice(2) +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    'T' +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds()) +
    'Z';

  const message = datetime + method.toUpperCase() + pathOnly + query;
  const signature = crypto.createHmac('sha256', SECRET_KEY).update(message).digest('hex');

  return `CEA algorithm=HmacSHA256, access-key=${ACCESS_KEY}, signed-date=${datetime}, signature=${signature}`;
}

async function call(label, urlPath) {
  const auth = generateAuth('GET', urlPath);
  console.log(`\n========== ${label} ==========`);
  console.log('GET', urlPath);
  const t0 = Date.now();
  const res = await fetch(HOST + urlPath, {
    method: 'GET',
    headers: {
      Authorization: auth,
      'X-Requested-By': ACCESS_KEY,
      'Content-Type': 'application/json;charset=UTF-8',
    },
  });
  const elapsed = Date.now() - t0;
  const text = await res.text();
  console.log(`status=${res.status} elapsed=${elapsed}ms`);

  let json;
  try { json = JSON.parse(text); } catch { console.log('non-JSON:', text.slice(0, 500)); return; }

  console.log('code:', json.code, 'message:', json.message);
  const data = json.data;
  if (Array.isArray(data)) {
    console.log(`data.length = ${data.length}`);
    if (data.length > 0) {
      const first = data[0];
      console.log('첫 항목 keys:', Object.keys(first));
      // 주문이라면 orderItems 구조 확인
      if (first.orderItems) {
        console.log('orderItems.length =', first.orderItems.length);
        if (first.orderItems[0]) {
          const it = first.orderItems[0];
          console.log('첫 orderItem keys:', Object.keys(it));
          console.log('첫 orderItem 샘플:', {
            sellerProductName: it.sellerProductName,
            shippingCount: it.shippingCount,
            salesPrice: it.salesPrice,
            orderPrice: it.orderPrice,
            discountPrice: it.discountPrice,
            cancelCount: it.cancelCount,
          });
        }
      }
      // 정산이면 saleAmount 등 확인
      if ('saleAmount' in first || 'amount' in first || 'totalAmount' in first) {
        console.log('정산 첫 항목:', first);
      }
      // 정산 응답: items 안 금액 필드 노출
      if ('items' in first && Array.isArray(first.items)) {
        console.log('정산 첫 항목 items.length =', first.items.length);
        if (first.items[0]) {
          console.log('정산 items[0] keys:', Object.keys(first.items[0]));
          console.log('정산 items[0] 전체:', JSON.stringify(first.items[0], null, 2));
        }
        console.log('정산 첫 항목 전체 (items 제외):', JSON.stringify({ ...first, items: '[...]' }, null, 2));
      }
    } else {
      console.log('빈 배열 — 해당 기간/상태에 데이터 없음');
    }
  } else if (data) {
    console.log('data (object):', JSON.stringify(data).slice(0, 500));
  } else {
    console.log('data 없음. nextToken:', json.nextToken);
  }
  if (json.nextToken) console.log('nextToken 있음 (다음 페이지 존재)');
}

// ─── 기간 계산: 오늘부터 30일 전 ─────────────────────────────────
function toDateStr(d) {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
const today = new Date();
const to = toDateStr(today);
const fromDate = new Date(today); fromDate.setDate(fromDate.getDate() - 29);
const from = toDateStr(fromDate);

console.log(`기간: ${from} ~ ${to}  (vendorId=${VENDOR_ID})`);

const STATUSES = ['ACCEPT', 'INSTRUCT', 'DEPARTURE', 'DELIVERING', 'FINAL_DELIVERY'];

(async () => {
  for (const s of STATUSES) {
    const urlPath =
      `/v2/providers/openapi/apis/api/v4/vendors/${VENDOR_ID}/ordersheets` +
      `?createdAtFrom=${from}&createdAtTo=${to}&status=${s}&maxPerPage=10`;
    await call(`ordersheets status=${s}`, urlPath);
    await new Promise((r) => setTimeout(r, 250));
  }

  // 가설 검증: token=빈문자열 + recognitionDateTo = 어제
  const yesterdayDate = new Date(today); yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = toDateStr(yesterdayDate);
  const revUrl =
    `/v2/providers/openapi/apis/api/v1/revenue-history` +
    `?vendorId=${VENDOR_ID}&recognitionDateFrom=${from}&recognitionDateTo=${yesterday}&maxPerPage=10&token=`;
  await call(`revenue-history (token=빈문자열, dateTo=${yesterday})`, revUrl);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
