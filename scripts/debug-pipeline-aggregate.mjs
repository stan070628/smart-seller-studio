/**
 * 파이프라인 집계 통째 재현 — 실제 쿠팡 응답을 우리 매핑/집계 로직으로 통과시켜
 * stage별 count/amount가 어떻게 나오는지 출력.
 *
 * 실행: node scripts/debug-pipeline-aggregate.mjs
 */
import crypto from 'crypto';
import * as path from 'path';
import * as url from 'url';
import * as fs from 'fs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const envPath = path.join(projectRoot, '.env.local');
const envVars = {};
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) envVars[m[1].trim()] = m[2].trim();
}
const ACCESS_KEY = envVars.COUPANG_ACCESS_KEY;
const SECRET_KEY = envVars.COUPANG_SECRET_KEY;
const VENDOR_ID = envVars.COUPANG_VENDOR_ID;
const HOST = 'https://api-gateway.coupang.com';

function generateAuth(method, urlWithQuery) {
  const [pathOnly, ...qParts] = urlWithQuery.split('?');
  const query = qParts.join('?') || '';
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const datetime =
    String(now.getUTCFullYear()).slice(2) +
    pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + 'T' +
    pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';
  const signature = crypto.createHmac('sha256', SECRET_KEY).update(datetime + method.toUpperCase() + pathOnly + query).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${ACCESS_KEY}, signed-date=${datetime}, signature=${signature}`;
}

async function getOrders({ from, to, status, nextToken }) {
  const parts = [
    `createdAtFrom=${from}`,
    `createdAtTo=${to}`,
    `status=${status}`,
    `maxPerPage=50`,
  ];
  if (nextToken) parts.push(`nextToken=${nextToken}`);
  const urlPath = `/v2/providers/openapi/apis/api/v4/vendors/${VENDOR_ID}/ordersheets?${parts.join('&')}`;
  const auth = generateAuth('GET', urlPath);
  const res = await fetch(HOST + urlPath, {
    method: 'GET',
    headers: { Authorization: auth, 'X-Requested-By': ACCESS_KEY, 'Content-Type': 'application/json;charset=UTF-8' },
  });
  const json = await res.json();
  return { items: json.data ?? [], nextToken: json.nextToken ?? null };
}

// settlement-clients.ts와 동일한 KST 로직
function toKstDate(d) {
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}
const today = new Date();
const to = toKstDate(today);
const fromDate = new Date(today); fromDate.setDate(fromDate.getDate() - 29);
const from = toKstDate(fromDate);

console.log(`기간: ${from} ~ ${to}\n`);

const COUPANG_NEW_ORDER = new Set(['ACCEPT', 'INSTRUCT']);
const COUPANG_DELIVERING = new Set(['DEPARTURE', 'DELIVERING']);
const STATUSES = ['ACCEPT', 'INSTRUCT', 'DEPARTURE', 'DELIVERING', 'FINAL_DELIVERY'];

(async () => {
  const allRows = [];
  for (const s of STATUSES) {
    let nextToken = '';
    let pageCount = 0;
    let statusCount = 0;
    do {
      const result = await getOrders({ from, to, status: s, nextToken: nextToken || undefined });
      pageCount += 1;
      for (const o of result.items) {
        const totalAmount = Array.isArray(o.orderItems)
          ? o.orderItems.reduce((sum, it) => sum + (Number(it.orderPrice) || 0), 0)
          : 0;
        allRows.push({ orderId: o.orderId, status: o.status, totalAmount });
        statusCount += 1;
      }
      nextToken = result.nextToken ?? '';
      if (pageCount >= 20) break;
    } while (nextToken);
    console.log(`${s}: ${statusCount}건, 페이지 ${pageCount}`);
  }

  const stages = { 주문: { c: 0, a: 0 }, 배송중: { c: 0, a: 0 }, 배송완료: { c: 0, a: 0 }, 구매확정: { c: 0, a: 0 } };
  for (const r of allRows) {
    if (COUPANG_NEW_ORDER.has(r.status)) { stages.주문.c++; stages.주문.a += r.totalAmount; }
    else if (COUPANG_DELIVERING.has(r.status)) { stages.배송중.c++; stages.배송중.a += r.totalAmount; }
    else if (r.status === 'FINAL_DELIVERY') { stages.배송완료.c++; stages.배송완료.a += r.totalAmount; }
  }

  console.log('\n전체 row 수:', allRows.length);
  console.log('row 상태값 분포:', allRows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {}));
  console.log('row totalAmount 분포 (0인 것):', allRows.filter((r) => r.totalAmount === 0).length, '/ 전체', allRows.length);
  console.log('첫 row 샘플:', allRows[0]);
  console.log('\n=== 집계 결과 ===');
  console.log('주문   :', stages.주문);
  console.log('배송중 :', stages.배송중);
  console.log('배송완료:', stages.배송완료);
  console.log('구매확정:', stages.구매확정);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
