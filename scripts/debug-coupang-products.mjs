/**
 * 쿠팡 등록 상품 status 매핑 디버그.
 * 여러 status로 호출해서 어디에 15건이 있는지 확인.
 */
import crypto from 'crypto';
import * as path from 'path';
import * as url from 'url';
import * as fs from 'fs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const envVars = {};
for (const line of fs.readFileSync(path.join(projectRoot, '.env.local'), 'utf8').split('\n')) {
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

async function callList(status) {
  const urlPath =
    `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products` +
    `?vendorId=${VENDOR_ID}&nextToken=&maxPerPage=100&status=${status}`;
  const auth = generateAuth('GET', urlPath);
  const res = await fetch(HOST + urlPath, {
    method: 'GET',
    headers: { Authorization: auth, 'X-Requested-By': ACCESS_KEY, 'Content-Type': 'application/json;charset=UTF-8' },
  });
  const json = await res.json();
  return json;
}

// 쿠팡 seller-products status 후보들. 실제 enum은 문서로 확정 필요하지만 흔히 보이는 것 위주.
const STATUSES = [
  'APPROVED',
  'PARTIAL_APPROVED',
  'CONDITIONAL_APPROVED',
  'CONDITIONAL_APPROVAL',
  'DENIED',
  'REJECT',
  'WAIT_APPROVAL',
  'SAVED',
  'TEMP_SAVE',
  'INACTIVE',
  'AUTO_REJECT',
  'PAUSE',
  'DELETED',
];

(async () => {
  for (const s of STATUSES) {
    try {
      const json = await callList(s);
      const len = Array.isArray(json.data) ? json.data.length : '?';
      const sampleStatus = json.data?.[0]?.statusName ?? json.data?.[0]?.status ?? null;
      console.log(`status=${s.padEnd(22)} → code=${json.code ?? json.statusCode}  len=${len}  sampleStatusName=${sampleStatus ?? '-'}  msg=${(json.message || '').slice(0, 80)}`);
    } catch (e) {
      console.log(`status=${s.padEnd(22)} → ERROR ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // status 인자 없이 호출 시도
  try {
    const urlPath = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products?vendorId=${VENDOR_ID}&nextToken=&maxPerPage=100`;
    const auth = generateAuth('GET', urlPath);
    const res = await fetch(HOST + urlPath, { method: 'GET', headers: { Authorization: auth, 'X-Requested-By': ACCESS_KEY, 'Content-Type': 'application/json;charset=UTF-8' } });
    const json = await res.json();
    console.log('\n[status 인자 없이] code=', json.code, ' len=', Array.isArray(json.data) ? json.data.length : '?', '  msg=', (json.message || '').slice(0, 100));
    if (Array.isArray(json.data) && json.data.length > 0) {
      const counts = {};
      for (const it of json.data) {
        const k = it.statusName || it.status || 'NULL';
        counts[k] = (counts[k] || 0) + 1;
      }
      console.log('  status 분포:', counts);
      console.log('  첫 항목 keys:', Object.keys(json.data[0]));
    }
  } catch (e) {
    console.log('[status 인자 없이] ERROR', e.message);
  }
})();
