/**
 * 스토리지 참조 스캔 — 판매 채널에 등록된 상품이 참조 중인 Supabase 파일 목록을 만든다.
 *
 * 왜 필요한가:
 *   2026-08-02 고아 파일 정리(2,798개/1.4GB)에서 **판매 중인 상품의 상세 이미지가 함께 삭제**됐다.
 *   당시 참조 수집은 DB 테이블만 훑었는데, 상세페이지 이미지는 DB가 아니라
 *   **채널에 등록된 상품의 상세 HTML 본문(<img src>)** 안에 박혀 있다.
 *   DB에서 보면 아무도 안 쓰는 파일로 보이지만, 지우면 상품 페이지가 깨진다.
 *
 * 사용:
 *   node scripts/storage-reference-scan.mjs            # 참조 목록 생성 + 생존 점검
 *   node scripts/storage-reference-scan.mjs --quiet    # 요약만
 *
 * 출력: /tmp/storage-refs.json  — 다음 정리 때 **삭제 금지 목록**으로 쓴다.
 */
import fs from 'node:fs';
import bcrypt from 'bcryptjs';

const QUIET = process.argv.includes('--quiet');
const env = {};
for (const l of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim().replace(/\\\$/g, '$');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 네이버 커머스 토큰 ─────────────────────────────────
const ts = Date.now();
const sign = Buffer.from(bcrypt.hashSync(env.NAVER_COMMERCE_CLIENT_ID + '_' + ts, env.NAVER_COMMERCE_CLIENT_SECRET)).toString('base64');
const tr = await fetch('https://api.commerce.naver.com/external/v1/oauth2/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: env.NAVER_COMMERCE_CLIENT_ID, timestamp: String(ts), client_secret_sign: sign, grant_type: 'client_credentials', type: 'SELF' }),
});
const TOKEN = (await tr.json()).access_token;
if (!TOKEN) { console.error('네이버 토큰 발급 실패'); process.exit(1); }
const H = 'https://api.commerce.naver.com';
const nh = { Authorization: 'Bearer ' + TOKEN };

// ── 전 상품 상세 HTML에서 Supabase URL 수집 ─────────────
const sr = await fetch(`${H}/external/v1/products/search`, {
  method: 'POST', headers: { ...nh, 'Content-Type': 'application/json' },
  body: JSON.stringify({ page: 1, size: 100, orderType: 'NO', productStatusTypes: ['SALE', 'OUTOFSTOCK', 'SUSPENSION', 'WAIT'] }),
});
const products = (await sr.json()).contents || [];
if (!QUIET) console.log(`네이버 상품 ${products.length}건에서 참조 수집`);

const refs = new Map();   // url → [{productNo, name, status}]
for (const it of products) {
  const no = it.originProductNo;
  const cp = (it.channelProducts || [])[0] || {};
  let r, tries = 0;
  while (tries < 5) { r = await fetch(`${H}/external/v2/products/origin-products/${no}`, { headers: nh }); if (r.status !== 429) break; tries++; await sleep(1500 * tries); }
  if (r.status !== 200) { console.log(`  ${no} 조회실패 ${r.status}`); continue; }
  const html = (await r.json()).originProduct?.detailContent || '';
  for (const m of html.matchAll(/https:\/\/[a-z0-9]+\.supabase\.co\/storage\/[^"'\s)]+/g)) {
    const u = m[0];
    if (!refs.has(u)) refs.set(u, []);
    refs.get(u).push({ productNo: no, name: (cp.name || '').slice(0, 30), status: cp.statusType });
  }
  await sleep(700);
}

// ── 생존 점검 ──────────────────────────────────────────
const dead = [];
for (const u of refs.keys()) {
  const hr = await fetch(u, { headers: { Range: 'bytes=0-0' } });
  if (hr.status >= 400) dead.push(u);
}

// storage_path 형태로도 남긴다 (정리 스크립트가 쓰기 좋게)
const toPath = u => decodeURIComponent(u.split('/object/public/')[1]?.split('/').slice(1).join('/') || '');
const out = {
  scannedAt: new Date().toISOString(),
  productCount: products.length,
  referencedUrls: [...refs.keys()],
  referencedPaths: [...refs.keys()].map(toPath).filter(Boolean),
  deadUrls: dead,
  byUrl: Object.fromEntries(refs),
};
fs.writeFileSync('/tmp/storage-refs.json', JSON.stringify(out, null, 1));

console.log(`\n참조 중인 파일 ${refs.size}개 · 깨진 것 ${dead.length}개`);
if (dead.length) {
  console.log('\n🔴 깨진 참조:');
  for (const u of dead) for (const p of refs.get(u)) console.log(`  ${p.productNo} [${p.status}] ${p.name} — ${u.split('/').pop()}`);
}
console.log('\n→ /tmp/storage-refs.json 의 referencedPaths 는 정리 시 삭제 금지 목록이다');
