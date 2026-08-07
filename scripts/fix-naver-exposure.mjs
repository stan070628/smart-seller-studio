/**
 * scripts/fix-naver-exposure.mjs
 * 노출이 꺼진 네이버 상품을 판매 노출 상태로 되돌린다.
 *
 *   channelProductDisplayStatusType: SUSPENSION → ON
 *   naverShoppingRegistration:       false      → true
 *   originProduct.statusType:        → SALE (네이버는 PUT마다 판매상태를 되돌리므로 매번 명시)
 *
 * 판별 용도로도 쓴다:
 *   반영되면 판매자 설정 오류였고, 거부되거나 값이 되돌아오면 플랫폼 조치다.
 *   커머스API 조회만으로는 이 둘이 구분되지 않는다(두 필드 모두 판매자 설정값).
 *
 * 🔴 주의: 네이버는 부분 수정을 받지 않는다. 조회 응답 전체를 되돌려보내므로
 *          상품이 통째로 재등록된다. payload가 잘못되면 이미지·상세·고시정보가
 *          함께 망가지므로, 이 스크립트는 전송 전 원본을 반드시 백업한다.
 *
 * 사용법:
 *   node scripts/fix-naver-exposure.mjs <channelProductNo>            # dry-run (기본)
 *   node scripts/fix-naver-exposure.mjs <channelProductNo> --apply    # 실제 전송
 *
 * 대상은 check-naver-exposure.mjs로 먼저 찾는다.
 */

import bcrypt from 'bcryptjs';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_HOST = 'https://api.commerce.naver.com';
const BACKUP_DIR = join(tmpdir(), 'naver-exposure-backup');

const CHANNEL_NO = Number(process.argv[2]);
const APPLY = process.argv.includes('--apply');

if (!CHANNEL_NO) {
  console.error('사용법: node scripts/fix-naver-exposure.mjs <channelProductNo> [--apply]');
  process.exit(1);
}

// ── .env.local 파싱 ──────────────────────────────────────────────────────────
// 주의: NAVER_COMMERCE_CLIENT_SECRET은 bcrypt salt($2a$...)라 셸 이스케이프(\$)가
//       붙어 저장돼 있다. 되돌리지 않으면 "Invalid salt version"으로 죽는다.
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
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  throw new Error(`${method} ${path} → 429 재시도 소진`);
}

/** channelProductNo로 originProductNo를 찾는다. 수정 PUT은 origin 기준이다. */
async function findOriginProductNo(token, channelNo) {
  for (let page = 1; page <= 20; page++) {
    const r = await request(token, 'POST', '/external/v1/products/search', { page, size: 100 });
    for (const c of r.contents ?? []) {
      if ((c.channelProducts ?? []).some((cp) => cp.channelProductNo === channelNo)) {
        return c.originProductNo;
      }
    }
    if (page >= (r.totalPages ?? 1)) break;
  }
  return null;
}

// ── 본체 ─────────────────────────────────────────────────────────────────────
const env = loadEnv();
const token = await getToken(env);

const before = await request(token, 'GET', `/external/v2/products/channel-products/${CHANNEL_NO}`);
const s = before.smartstoreChannelProduct ?? {};

console.log(`\n■ ${CHANNEL_NO} — ${before.originProduct?.name ?? '?'}`);
console.log(
  `  현재: statusType=${before.originProduct?.statusType}  ` +
    `쇼핑등록=${s.naverShoppingRegistration}  노출=${s.channelProductDisplayStatusType}`,
);

// 조회 응답을 그대로 되돌려보내되 필요한 필드만 교정한다.
const payload = JSON.parse(JSON.stringify(before));
const changes = [];
if (payload.smartstoreChannelProduct.channelProductDisplayStatusType !== 'ON') {
  changes.push(`노출 ${payload.smartstoreChannelProduct.channelProductDisplayStatusType} → ON`);
  payload.smartstoreChannelProduct.channelProductDisplayStatusType = 'ON';
}
if (payload.smartstoreChannelProduct.naverShoppingRegistration !== true) {
  changes.push(`쇼핑등록 ${payload.smartstoreChannelProduct.naverShoppingRegistration} → true`);
  payload.smartstoreChannelProduct.naverShoppingRegistration = true;
}
// 판매상태는 건드리지 않는다 — 이 스크립트의 목적은 노출 복구다.
// 다만 네이버는 PUT마다 판매상태를 SALE로 되돌리므로(등록 시 실측), 원래 값을
// 명시적으로 다시 넣어 품절/판매중지 상품이 조용히 판매중이 되는 것을 막는다.
payload.originProduct.statusType = before.originProduct.statusType;

if (before.originProduct.statusType === 'SUSPENSION') {
  console.log('  ⚠️ 이 상품은 판매중지 상태입니다. 노출만 켜도 팔리지 않으므로 판매상태를 먼저 확인하세요.');
}

if (!changes.length) {
  console.log('  변경할 것이 없습니다 (이미 정상 노출).\n');
  process.exit(0);
}
console.log(`  변경: ${changes.join(' · ')}`);

if (!APPLY) {
  console.log('\n  [dry-run] 실제로 반영하려면 --apply 를 붙이세요.\n');
  process.exit(0);
}

// 🔴 전송 전 백업 — 상품이 통째로 재등록되므로 되돌릴 근거를 남긴다.
mkdirSync(BACKUP_DIR, { recursive: true });
const backupPath = join(BACKUP_DIR, `${CHANNEL_NO}-before.json`);
writeFileSync(backupPath, JSON.stringify(before, null, 2));
console.log(`  백업: ${backupPath}`);

const originProductNo = await findOriginProductNo(token, CHANNEL_NO);
if (!originProductNo) throw new Error(`originProductNo를 찾지 못했습니다 (channelProductNo=${CHANNEL_NO})`);

console.log(`  PUT /external/v2/products/origin-products/${originProductNo} 전송 중...`);
await request(token, 'PUT', `/external/v2/products/origin-products/${originProductNo}`, payload);

// ── 검증 — 보낸 값과 저장된 값을 대조한다 ────────────────────────────────────
// 네이버는 조용히 값을 고치기도 한다. 실측: 쇼핑등록을 켜자 modelName에서
// 유통업체명("코스트코")이 제거됐다. 성공 응답이 곧 의도대로 저장됐다는 뜻이 아니다.
await new Promise((r) => setTimeout(r, 2000));
const after = await request(token, 'GET', `/external/v2/products/channel-products/${CHANNEL_NO}`);
const a = after.smartstoreChannelProduct ?? {};

console.log(
  `  결과: statusType=${after.originProduct?.statusType}  ` +
    `쇼핑등록=${a.naverShoppingRegistration}  노출=${a.channelProductDisplayStatusType}`,
);

const ok = a.channelProductDisplayStatusType === 'ON' && a.naverShoppingRegistration === true;
console.log(ok ? '  ✅ 정상 반영 — 판매자 설정이었습니다.' : '  🔴 반영되지 않음 — 플랫폼 조치일 가능성이 있습니다.');
if (after.originProduct?.statusType !== before.originProduct?.statusType) {
  console.log(
    `  ⚠️ 판매상태가 바뀌었습니다: ${before.originProduct?.statusType} → ${after.originProduct?.statusType}`,
  );
}

// 의도한 두 필드 외에 네이버가 바꾼 값이 있는지 훑는다.
const diffs = [];
const walk = (x, y, p = '') => {
  for (const k of new Set([...Object.keys(x ?? {}), ...Object.keys(y ?? {})])) {
    const path = p ? `${p}.${k}` : k;
    const xv = x?.[k];
    const yv = y?.[k];
    if (xv && yv && typeof xv === 'object' && typeof yv === 'object') walk(xv, yv, path);
    else if (JSON.stringify(xv) !== JSON.stringify(yv)) diffs.push({ path, from: xv, to: yv });
  }
};
walk(payload, after);
if (diffs.length) {
  console.log('\n  ⚠️ 보낸 값과 저장된 값의 차이:');
  for (const d of diffs) {
    console.log(`     ${d.path}: ${JSON.stringify(d.from)?.slice(0, 60)} → ${JSON.stringify(d.to)?.slice(0, 60)}`);
  }
}
console.log('');
