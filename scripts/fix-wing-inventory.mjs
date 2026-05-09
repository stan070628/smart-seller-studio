/**
 * scripts/fix-wing-inventory.mjs
 * 쿠팡 윙 재고관리 페이지 400 Bad Request 자동 해결 스크립트
 *
 * 실행: node scripts/fix-wing-inventory.mjs
 * 필요: npm install playwright (프로젝트 루트에서)
 *
 * 해결 흐름:
 *  1. 진단  — 현재 쿠키 상태(크기·만료·중복) 분석
 *  2. 복구  — 만료/중복/Akamai bot 쿠키 제거 → 메인 페이지 경유 세션 갱신
 *  3. 검증  — 재고관리 테이블·페이지네이션 렌더링 확인 → 세션 저장
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 경로 설정 ─────────────────────────────────────────────────────────────
const SESSION_FILE = path.resolve(__dirname, '../.gstack/browse-states/wing-session.json');
const SESSION_BACKUP = SESSION_FILE + '.bak';

// ── URL 설정 ──────────────────────────────────────────────────────────────
const WING_HOME = 'https://wing.coupang.com/';
const TARGET_URL = 'https://wing.coupang.com/tenants/rfm-inventory/management/list';
const LOGIN_DOMAIN = 'xauth.coupang.com';

// ── 제거할 쿠키 패턴 ─────────────────────────────────────────────────────
// Akamai bot management: bm_*, _abck, ak_bmsc
// 트래킹: sc_*, cauly_*, _ga*, ads-center-*
// OAuth restart (로그인 완료 후 불필요): KC_RESTART, OAuth_Token_Request_State
const REMOVABLE_PREFIXES = ['bm_', 'ak_', 'sc_', 'cauly_', '_ga', '_abck'];
const REMOVABLE_NAMES = new Set([
  'KC_RESTART',
  'OAuth_Token_Request_State',
  'bigfoot_browser_session_id',
  'web-session-id',
  'ads-center-market',
  'KEYCLOAK_LOCALE',
]);

// ─────────────────────────────────────────────────────────────────────────
// Step 1: 진단
// ─────────────────────────────────────────────────────────────────────────
function diagnose(cookies) {
  const now = Date.now() / 1000;

  const totalSize = cookies.reduce((s, c) => s + (c.name?.length ?? 0) + (c.value?.length ?? 0), 0);

  const expired = cookies.filter(c => c.expires > 0 && c.expires < now);

  const seen = new Map();
  const duplicates = new Set();
  for (const c of cookies) {
    const key = `${c.name}||${c.domain}`;
    if (seen.has(key)) duplicates.add(c.name);
    else seen.set(key, true);
  }

  const coupangCookies = cookies.filter(c => (c.domain ?? '').includes('coupang'));
  const coupangSize = coupangCookies.reduce((s, c) => s + (c.name?.length ?? 0) + (c.value?.length ?? 0), 0);

  return { totalSize, coupangSize, expired, duplicates, coupangCookies };
}

function printDiagnosis({ totalSize, coupangSize, expired, duplicates, coupangCookies }) {
  const HEADER_LIMIT = 8192;
  const ok = totalSize <= HEADER_LIMIT;

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║              Step 1 — 쿠키 진단 결과                ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  총 쿠키 수:      ${coupangCookies.length}개`);
  console.log(`  총 쿠키 크기:    ${totalSize.toLocaleString()} B  (한도: ${HEADER_LIMIT.toLocaleString()} B)  ${ok ? '✅ 정상' : '❌ 한도 초과 — 400 원인'}`);
  console.log(`  쿠팡 도메인:     ${coupangSize.toLocaleString()} B`);
  console.log(`  만료된 쿠키:     ${expired.length}개  ${expired.length > 0 ? `(${expired.map(c => c.name).join(', ')})` : ''}`);
  console.log(`  중복 쿠키:       ${duplicates.size}개  ${duplicates.size > 0 ? `(${[...duplicates].join(', ')})` : ''}`);

  if (!ok) {
    const bigOnes = [...coupangCookies]
      .sort((a, b) => (b.value?.length ?? 0) - (a.value?.length ?? 0))
      .slice(0, 5);
    console.log('\n  [가장 큰 쿠키 Top 5]');
    bigOnes.forEach(c =>
      console.log(`    ${c.name.padEnd(38)} ${(c.value?.length ?? 0)}B`)
    );
  }
  console.log();
}

// ─────────────────────────────────────────────────────────────────────────
// Step 2: 쿠키 정리
// ─────────────────────────────────────────────────────────────────────────
function cleanCookies(cookies) {
  const now = Date.now() / 1000;
  const seen = new Set();

  return cookies.filter(c => {
    const name = c.name ?? '';
    const domain = c.domain ?? '';

    // 만료된 쿠키 제거
    if (c.expires > 0 && c.expires < now) return false;

    // 쿠팡 외 도메인은 유지 (다른 사이트 세션)
    if (!domain.includes('coupang')) return true;

    // 중복 제거 (name + domain 기준, 첫 번째만 유지)
    const key = `${name}||${domain}`;
    if (seen.has(key)) return false;
    seen.add(key);

    // Akamai bot management / 트래킹 prefix 제거
    if (REMOVABLE_PREFIXES.some(p => name.startsWith(p))) return false;

    // 이름 기반 제거
    if (REMOVABLE_NAMES.has(name)) return false;

    return true;
  });
}

function printCleanSummary(before, after) {
  const beforeSize = before.reduce((s, c) => s + (c.name?.length ?? 0) + (c.value?.length ?? 0), 0);
  const afterSize = after.reduce((s, c) => s + (c.name?.length ?? 0) + (c.value?.length ?? 0), 0);

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║              Step 2 — 쿠키 정리 결과                ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  정리 전: ${before.length}개, ${beforeSize.toLocaleString()} B`);
  console.log(`  정리 후: ${after.length}개, ${afterSize.toLocaleString()} B`);
  console.log(`  절감:    ${before.length - after.length}개, ${(beforeSize - afterSize).toLocaleString()} B`);
  console.log(`  상태:    ${afterSize <= 8192 ? '✅ 헤더 한도 이내' : '⚠️  여전히 한도 초과 — 로그인 갱신 필요'}`);
  console.log();
}

// ─────────────────────────────────────────────────────────────────────────
// 세션 파일 저장 (Playwright storageState 포맷)
// ─────────────────────────────────────────────────────────────────────────
async function saveSession(context) {
  const state = await context.storageState();
  // 백업
  if (fs.existsSync(SESSION_FILE)) {
    fs.copyFileSync(SESSION_FILE, SESSION_BACKUP);
  }
  fs.writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2), 'utf-8');
  console.log(`  ✅ 세션 저장 완료: ${SESSION_FILE}`);
  console.log(`  📦 백업: ${SESSION_BACKUP}`);
}

// ─────────────────────────────────────────────────────────────────────────
// 세션 파일 로드
// ─────────────────────────────────────────────────────────────────────────
function loadSessionCookies() {
  if (!fs.existsSync(SESSION_FILE)) {
    console.log('  ℹ️  세션 파일 없음 — 로그인부터 시작합니다.');
    return [];
  }
  try {
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
    return raw.cookies ?? [];
  } catch {
    console.warn('  ⚠️  세션 파일 파싱 실패 — 새 세션으로 시작합니다.');
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 페이지 상태 체크 (400 / 로그인 필요 / 정상)
// ─────────────────────────────────────────────────────────────────────────
function pageStatus(page) {
  const url = page.url();
  if (url.includes(LOGIN_DOMAIN) || url.includes('/login') || url.includes('sign-in')) {
    return 'login-required';
  }
  return 'ok';
}

// ─────────────────────────────────────────────────────────────────────────
// Step 3: 재고관리 페이지 검증
// ─────────────────────────────────────────────────────────────────────────
async function verifyInventoryPage(page) {
  console.log('  → 페이지 응답 대기 중...');

  // 400 에러 감지 (서버 에러 페이지 텍스트)
  const bodyText = await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
  if (bodyText.includes('400') && bodyText.includes('Bad Request')) {
    return { ok: false, reason: '400 Bad Request 페이지가 여전히 표시됩니다.' };
  }

  // 재고 리스트 테이블 확인
  const tableSelectors = [
    'table tbody tr',
    '[class*="inventory-list"]',
    '[class*="InventoryList"]',
    '[class*="stock-list"]',
    '.list-table tbody tr',
  ];

  let tableFound = false;
  for (const sel of tableSelectors) {
    const count = await page.locator(sel).count().catch(() => 0);
    if (count > 0) { tableFound = true; break; }
  }

  // 페이지네이션 확인
  const paginationSelectors = [
    '[class*="pagination"]',
    '[class*="Pagination"]',
    '.paging',
    'nav[aria-label*="page"]',
  ];

  let paginationFound = false;
  for (const sel of paginationSelectors) {
    const exists = await page.locator(sel).isVisible({ timeout: 3_000 }).catch(() => false);
    if (exists) { paginationFound = true; break; }
  }

  // 판매자 정보 / 상단 메뉴바 확인 (Wing 공통 헤더)
  const headerFound = await page.locator('header, [class*="gnb"], [class*="Header"], [class*="top-menu"]')
    .isVisible({ timeout: 3_000 }).catch(() => false);

  return {
    ok: tableFound || headerFound,
    tableFound,
    paginationFound,
    headerFound,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 메인 실행
// ─────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🛠  쿠팡 윙 재고관리 400 에러 자동 해결 스크립트');
  console.log('='.repeat(54));

  // ── 세션 로드 & 진단 ───────────────────────────────────────
  const rawCookies = loadSessionCookies();
  const diag = diagnose(rawCookies);
  printDiagnosis(diag);

  // ── 쿠키 정리 ──────────────────────────────────────────────
  const cleanedCookies = cleanCookies(rawCookies);
  printCleanSummary(rawCookies, cleanedCookies);

  // Playwright 쿠키 형식으로 변환 (sameSite 정규화)
  const toPlaywrightCookies = (cookies) =>
    cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path ?? '/',
      httpOnly: c.httpOnly ?? false,
      secure: c.secure ?? false,
      sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax',
      ...(c.expires && c.expires > 0 ? { expires: c.expires } : {}),
    }));

  // ── 브라우저 오픈 ──────────────────────────────────────────
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║         Step 2 — 브라우저 세션 복구                 ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
    slowMo: 300,
  });

  const context = await browser.newContext({
    viewport: null,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    extraHTTPHeaders: {
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  // 정리된 쿠키 주입
  if (cleanedCookies.length > 0) {
    await context.addCookies(toPlaywrightCookies(cleanedCookies));
    console.log(`  ✅ 정리된 쿠키 ${cleanedCookies.length}개 주입 완료`);
  }

  const page = await context.newPage();

  // ── Phase A: Wing 메인 페이지 경유 (세션 갱신) ─────────────
  console.log(`\n  → Wing 메인 페이지 접속 중: ${WING_HOME}`);
  const homeResp = await page.goto(WING_HOME, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  }).catch(e => { console.error('  ❌ 메인 페이지 접속 실패:', e.message); return null; });

  if (homeResp) {
    console.log(`  → 응답: HTTP ${homeResp.status()}`);
  }

  // ── Phase B: 로그인 필요 여부 확인 ────────────────────────
  await page.waitForTimeout(2_000);
  const homeStatus = pageStatus(page);

  if (homeStatus === 'login-required') {
    console.log('\n  ⚠️  세션 만료 — 로그인이 필요합니다.');
    console.log('  📋 브라우저에서 직접 로그인 해주세요.');
    console.log('  ⏳ 로그인 완료 후 Wing 메인 페이지가 나타나면 자동으로 진행됩니다...\n');

    // 로그인 완료 대기 (최대 3분)
    await page.waitForURL(
      url => !url.toString().includes(LOGIN_DOMAIN) && !url.toString().includes('/login'),
      { timeout: 180_000 }
    ).catch(() => {
      throw new Error('로그인 대기 시간(3분) 초과. 스크립트를 다시 실행해 주세요.');
    });

    console.log('  ✅ 로그인 완료 감지됨.');
    await page.waitForTimeout(2_000);
  } else {
    console.log('  ✅ 기존 세션 유효. 로그인 불필요.');
    await page.waitForTimeout(1_500);
  }

  // ── Phase C: Wing 메인에서 Akamai 신규 쿠키 수신 대기 ─────
  console.log('  → Wing 서버 쿠키 갱신 대기 (2초)...');
  await page.waitForTimeout(2_000);

  // ── Phase D: 재고관리 페이지로 이동 ───────────────────────
  console.log(`\n  → 재고관리 페이지 이동: ${TARGET_URL}`);

  // 400 에러 응답 감지
  let responseStatus = null;
  page.once('response', resp => {
    if (resp.url() === TARGET_URL || resp.url().startsWith(TARGET_URL)) {
      responseStatus = resp.status();
    }
  });

  const inventoryResp = await page.goto(TARGET_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  }).catch(e => { console.error('  ❌ 재고관리 페이지 접속 실패:', e.message); return null; });

  const httpStatus = inventoryResp?.status() ?? responseStatus ?? '?';
  console.log(`  → 응답: HTTP ${httpStatus}`);

  if (httpStatus === 400) {
    console.log('\n  ❌ 여전히 400. 현재 쿠키 상태 재진단...');
    const currentCookies = await context.cookies();
    const rediag = diagnose(currentCookies);
    printDiagnosis(rediag);
    console.log('  → 해결책: 로그아웃 후 재로그인 또는 쿠키 전체 초기화를 시도합니다.');

    // 전체 쿠키 초기화 후 재시도
    await context.clearCookies();
    console.log('  → 쿠키 전체 초기화 완료. Wing 재접속...');
    await page.goto(WING_HOME, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    if (pageStatus(page) === 'login-required') {
      console.log('\n  ⚠️  쿠키 초기화 후 로그인 필요합니다. 브라우저에서 로그인 해주세요...');
      await page.waitForURL(
        url => !url.toString().includes(LOGIN_DOMAIN) && !url.toString().includes('/login'),
        { timeout: 180_000 }
      );
      console.log('  ✅ 로그인 완료.');
      await page.waitForTimeout(2_000);
    }

    console.log(`  → 재고관리 페이지 재시도: ${TARGET_URL}`);
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }

  // ── Step 3: 검증 ───────────────────────────────────────────
  await page.waitForTimeout(3_000);

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║              Step 3 — 페이지 검증                   ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  → 현재 URL: ${page.url()}`);

  const result = await verifyInventoryPage(page);

  console.log(`  헤더/메뉴바:     ${result.headerFound ? '✅ 확인됨' : '⚠️  미확인'}`);
  console.log(`  재고 리스트 테이블: ${result.tableFound ? '✅ 확인됨' : '⚠️  미확인 (로딩 중일 수 있음)'}`);
  console.log(`  페이지네이션:    ${result.paginationFound ? '✅ 확인됨' : '⚠️  미확인'}`);

  if (!result.ok) {
    if (result.reason) console.log(`  → ${result.reason}`);
    console.log('\n  ⚠️  페이지가 완전히 로드되지 않았습니다.');
    console.log('  💡 브라우저에서 수동으로 확인 후 Ctrl+C로 종료하세요.');
    await page.waitForTimeout(15_000);
  } else {
    console.log('\n  ✅ 재고관리 페이지 정상 로드 확인!\n');

    // 세션 저장
    console.log('  → 갱신된 세션 저장 중...');
    await saveSession(context);
  }

  // ── 최종 쿠키 상태 출력 ────────────────────────────────────
  const finalCookies = await context.cookies();
  const finalDiag = diagnose(finalCookies);
  console.log(`\n  [최종 쿠키 상태] ${finalDiag.coupangCookies.length}개, ${finalDiag.coupangSize.toLocaleString()} B`);

  console.log('\n  브라우저를 10초 후 종료합니다...');
  await page.waitForTimeout(10_000);

  await browser.close();
  console.log('\n✅ 완료\n');
}

main().catch(err => {
  console.error('\n❌ 오류:', err.message);
  process.exit(1);
});
