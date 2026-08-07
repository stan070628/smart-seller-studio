/**
 * scripts/check-naver-exposure.mjs
 * 네이버 스마트스토어 상품의 노출 상태를 전수 점검한다.
 *
 * 왜 필요한가:
 *   판매상태(statusType)와 노출상태는 별개 필드다. 판매중(SALE)이면서 손님에게
 *   보이지 않는 조합이 실제로 존재했고(2026-08-07 실측 4건), 꺼져도 알림이 없다.
 *
 * 노출은 2층 구조다:
 *   channelProductDisplayStatusType = SUSPENSION → 스마트스토어 안에서도 안 보인다 (유입 0)
 *   naverShoppingRegistration       = false      → 네이버쇼핑 검색·가격비교에서 빠진다
 *
 * 한계:
 *   두 필드는 판매자 설정값이라 네이버가 건 강제 비노출은 반영되지 않는다.
 *   즉 이 스크립트는 "판매자 설정 오류"를 잡지 "플랫폼 제재"를 잡지 못한다.
 *   구분하려면 fix-naver-exposure.mjs로 ON 전송을 시도해본다 — 반영되면 판매자
 *   설정, 거부되거나 되돌아가면 플랫폼 조치다.
 *
 * 사용법:
 *   node scripts/check-naver-exposure.mjs           # 이상 항목만
 *   node scripts/check-naver-exposure.mjs --all     # 정상 항목까지 전부
 */

import bcrypt from 'bcryptjs';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_HOST = 'https://api.commerce.naver.com';
const SHOW_ALL = process.argv.includes('--all');

// ── .env.local 파싱 ──────────────────────────────────────────────────────────
// 주의: NAVER_COMMERCE_CLIENT_SECRET은 bcrypt salt($2a$...)라서 셸 이스케이프(\$)가
//       붙은 채 저장돼 있다. 되돌리지 않으면 "Invalid salt version"으로 죽는다.
function loadEnv() {
  const env = {};
  for (const line of readFileSync(resolve(__dirname, '../.env.local'), 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/\\\$/g, '$');
  }
  return env;
}

// ── 커머스API ────────────────────────────────────────────────────────────────
async function getToken(env) {
  const timestamp = Date.now();
  const sign = Buffer.from(
    bcrypt.hashSync(`${env.NAVER_COMMERCE_CLIENT_ID}_${timestamp}`, env.NAVER_COMMERCE_CLIENT_SECRET),
  ).toString('base64');

  const res = await fetch(`${API_HOST}/external/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.NAVER_COMMERCE_CLIENT_ID,
      timestamp: String(timestamp),
      client_secret_sign: sign,
      grant_type: 'client_credentials',
      type: 'SELF',
    }).toString(),
  });
  if (!res.ok) throw new Error(`토큰 발급 실패 ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

/** 429가 잦으므로 지수 백오프로 재시도한다. */
async function request(token, method, path, body, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(API_HOST + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (res.ok) return text ? JSON.parse(text) : {};
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
      continue;
    }
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  throw new Error(`${method} ${path} → 429 재시도 소진`);
}

// ── 본체 ─────────────────────────────────────────────────────────────────────
const env = loadEnv();
if (!env.NAVER_COMMERCE_CLIENT_ID || !env.NAVER_COMMERCE_CLIENT_SECRET) {
  console.error('✗ .env.local에 NAVER_COMMERCE_CLIENT_ID / NAVER_COMMERCE_CLIENT_SECRET이 없습니다.');
  process.exit(1);
}
const token = await getToken(env);

const all = [];
for (let page = 1; page <= 20; page++) {
  const r = await request(token, 'POST', '/external/v1/products/search', { page, size: 100 });
  for (const c of r.contents ?? []) {
    for (const cp of c.channelProducts ?? []) all.push({ origin: c.originProductNo, ...cp });
  }
  if (page >= (r.totalPages ?? 1)) break;
}

// 판매중지 상품은 노출도 원래 꺼져 있어 판별 대상이 아니다.
const live = all.filter((p) => ['SALE', 'OUTOFSTOCK'].includes(p.statusType));
console.log(`\n전체 ${all.length}건 · 판매중/품절 ${live.length}건 — 상세 조회 중...\n`);

const rows = [];
for (const p of live) {
  const d = await request(token, 'GET', `/external/v2/products/channel-products/${p.channelProductNo}`);
  const s = d.smartstoreChannelProduct ?? {};
  rows.push({
    ch: p.channelProductNo,
    origin: p.origin,
    name: p.name ?? '',
    status: p.statusType,
    stock: p.stockQuantity,
    price: p.salePrice,
    reg: s.naverShoppingRegistration,
    disp: s.channelProductDisplayStatusType,
  });
  await new Promise((r) => setTimeout(r, 1200)); // 레이트리밋 여유
}

const blocked = rows.filter((r) => r.reg !== true || r.disp !== 'ON');

console.log('='.repeat(92));
console.log(`🔴 노출되지 않는 상품: ${blocked.length}건 / ${rows.length}건`);
console.log('='.repeat(92));

if (!blocked.length) {
  console.log('  없음 — 판매중·품절 상품이 모두 정상 노출 중입니다.\n');
} else {
  for (const r of blocked) {
    const why = [];
    if (r.disp !== 'ON') why.push(`전시 ${r.disp} (스토어에서도 안 보임)`);
    if (r.reg !== true) why.push('쇼핑등록 N (검색에서 빠짐)');
    console.log(
      `\n  ch=${r.ch}  origin=${r.origin}\n` +
        `     ${r.name}\n` +
        `     ${r.status} · 재고 ${r.stock} · ${Number(r.price).toLocaleString()}원\n` +
        `     🔴 ${why.join(' / ')}\n` +
        `     복구: node scripts/fix-naver-exposure.mjs ${r.ch} --apply`,
    );
  }
  console.log('\n  ※ 의도적으로 내린 상품이면 그대로 두세요. 판매 의사가 있는 것만 복구합니다.\n');
}

if (SHOW_ALL) {
  console.log('─'.repeat(92));
  console.log(`✅ 정상 노출 ${rows.length - blocked.length}건`);
  for (const r of rows.filter((x) => x.reg === true && x.disp === 'ON')) {
    console.log(`     ${r.ch}  ${r.status.padEnd(11)} ${r.name.slice(0, 46)}`);
  }
}
