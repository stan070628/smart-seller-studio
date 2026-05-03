/**
 * 쿠팡 Wing + 광고센터 로컬 스크래퍼
 *
 * 실행 방법:
 *   cd scripts/ad-scraper
 *   npm install          # 최초 1회
 *   npm run scrape
 *
 * 세션 갱신:
 *   Wing: $B state save wing-session
 *   광고센터: .env의 COUPANG_ADS_COOKIE 업데이트
 */

import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Wing 세션 파일: 환경변수 > 기본값(프로젝트 루트/.gstack/...)
const WING_SESSION_FILE =
  process.env.WING_SESSION_FILE ??
  path.resolve(__dirname, '../../.gstack/browse-states/wing-session.json');

const WING_INVENTORY_URL =
  'https://wing.coupang.com/vendor-inventory/list?statusSearch=VALID';

const FIXED_USER_ID = 'cheong-yeon';

// ── Supabase 클라이언트 ──────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// ── Wing 쿠키 로드 ───────────────────────────────────────────────────
function loadWingCookies() {
  if (!fs.existsSync(WING_SESSION_FILE)) {
    throw new Error(
      `Wing 세션 파일이 없습니다: ${WING_SESSION_FILE}\n` +
        '브라우저에서 Wing에 로그인 후 "$B state save wing-session" 을 실행해 주세요.',
    );
  }

  const raw = JSON.parse(fs.readFileSync(WING_SESSION_FILE, 'utf-8'));
  const cookies = (raw.cookies ?? [])
    .filter(
      (c) =>
        c.domain.includes('wing.coupang.com') ||
        c.domain.includes('xauth.coupang.com') ||
        c.domain.includes('.coupang.com'),
    )
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path ?? '/',
      httpOnly: c.httpOnly ?? false,
      secure: c.secure ?? false,
      sameSite: c.sameSite ?? 'Lax',
      ...(c.expires && c.expires > 0 ? { expires: c.expires } : {}),
    }));

  if (cookies.length === 0) {
    throw new Error('Wing 세션 파일에 유효한 쿠키가 없습니다. 세션을 다시 저장해 주세요.');
  }
  return cookies;
}

// ── Wing 상품 목록 스크래핑 ──────────────────────────────────────────
async function scrapeWingProducts() {
  console.log('[Wing] 상품 목록 수집 중...');
  const cookies = loadWingCookies();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  try {
    const context = await browser.newContext();
    await context.addCookies(cookies);
    const page = await context.newPage();

    await page.goto(WING_INVENTORY_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    if (
      page.url().includes('xauth.coupang.com') ||
      page.url().includes('login') ||
      page.url().includes('sign-in')
    ) {
      throw new Error('Wing 세션이 만료되었습니다. "$B state save wing-session" 으로 세션을 갱신해 주세요.');
    }

    await page.waitForSelector('table tbody tr', { timeout: 15_000 }).catch(() => null);
    await page.waitForTimeout(3_000);

    const products = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows
        .map((row) => {
          const cells = Array.from(row.querySelectorAll('td'));
          const nameEl = row.querySelector('a.ip-title') ?? cells[1];
          const name = nameEl?.textContent?.trim() ?? '';
          if (!name) return null;

          const href = row.querySelector('a.ip-title')?.href ?? '';
          const idMatch = href.match(/vendorInventoryId=(\d+)/);
          const sellerProductId = idMatch?.[1] ?? '';

          const isItemWinner =
            row.querySelector('[class*="winner"], [class*="item-winner"]') !== null ||
            cells.some(
              (c) =>
                c.textContent?.includes('Item winner') ||
                c.textContent?.includes('아이템위너') ||
                c.textContent?.includes('위너 보유'),
            );

          const stockEl = row.querySelector('.is-top');
          const stock =
            parseInt((stockEl?.textContent ?? cells[2]?.textContent ?? '0').replace(/[^0-9]/g, ''), 10) || 0;

          const priceEl = row.querySelector('.isp-top');
          const salePrice =
            parseInt((priceEl?.textContent ?? cells[4]?.textContent ?? '0').replace(/[^0-9]/g, ''), 10) || 0;

          const imageViolation =
            row.querySelector('[class*="violation"], [class*="block"], [class*="error"]') !== null ||
            cells.some(
              (c) =>
                c.textContent?.includes('이미지 위반') ||
                c.textContent?.includes('검수 반려') ||
                c.textContent?.includes('Image violation') ||
                c.textContent?.includes('Rejected'),
            );

          return { name, sellerProductId, isItemWinner, stock, salePrice, monthlySales: 0, imageViolation };
        })
        .filter((p) => p !== null && p.name.length > 0);
    });

    console.log(`[Wing] ${products.length}개 상품 수집 완료`);
    await page.close();
    return products;
  } finally {
    await browser.close();
  }
}

// ── 광고센터 캠페인 스크래핑 ─────────────────────────────────────────
async function scrapeAdsCampaigns() {
  const cookie = process.env.COUPANG_ADS_COOKIE;
  if (!cookie) {
    console.warn('[광고센터] COUPANG_ADS_COOKIE 미설정 — 광고 데이터 없이 진행');
    return [];
  }
  console.log('[광고센터] 캠페인 수집 중...');

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  try {
    const context = await browser.newContext();
    const cookiePairs = cookie
      .split(';')
      .map((c) => {
        const eqIdx = c.indexOf('=');
        if (eqIdx < 0) return null;
        return { name: c.slice(0, eqIdx).trim(), value: c.slice(eqIdx + 1).trim(), domain: '.advertising.coupang.com', path: '/' };
      })
      .filter((c) => c !== null && c.name.length > 0);
    await context.addCookies(cookiePairs);

    const page = await context.newPage();
    await page.goto('https://advertising.coupang.com/marketing/dashboard/sales', { waitUntil: 'domcontentloaded', timeout: 30_000 });

    if (page.url().includes('login') || page.url().includes('sign-in')) {
      throw new Error('광고센터 세션이 만료되었습니다. .env의 COUPANG_ADS_COOKIE를 갱신해 주세요.');
    }

    await page.waitForSelector('table tbody tr, [class*="campaign"]', { timeout: 15_000 }).catch(() => null);

    const campaigns = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr, [class*="campaign-row"], [class*="campaignRow"]'));
      return rows
        .map((row) => {
          const cells = Array.from(row.querySelectorAll('td, [class*="cell"]'));
          const name = cells[0]?.textContent?.trim() ?? '';
          if (!name) return null;

          const campaignId = row.getAttribute('data-campaign-id') ?? row.getAttribute('data-id') ?? String(Math.random());
          const allText = row.textContent ?? '';
          const status =
            allText.includes('활성') || allText.includes('ACTIVE') ? 'ACTIVE' :
            allText.includes('종료') || allText.includes('ENDED') ? 'ENDED' : 'PAUSED';

          const budgetMatch = allText.match(/([0-9,]+)\s*원/);
          const dailyBudget = budgetMatch ? parseInt(budgetMatch[1].replace(/,/g, ''), 10) : 0;

          const roasMatch = allText.match(/([0-9]+(?:\.[0-9]+)?)\s*%/);
          const roas = roasMatch ? parseFloat(roasMatch[1]) : 0;

          const ctrMatch = allText.match(/CTR[^0-9]*([0-9]+(?:\.[0-9]+)?)/i);
          const ctr = ctrMatch ? parseFloat(ctrMatch[1]) : 0;

          const endDateMatch = allText.match(/(\d{4}[-/.]\d{2}[-/.]\d{2})/);
          const endDate = endDateMatch ? endDateMatch[1] : undefined;

          return { campaignId, name, status, dailyBudget, roas, ctr, endDate };
        })
        .filter((c) => c !== null && c.name.length > 0);
    });

    console.log(`[광고센터] ${campaigns.length}개 캠페인 수집 완료`);
    await page.close();
    return campaigns;
  } finally {
    await browser.close();
  }
}

// ── 광고센터 상품별 보고서 스크래핑 ────────────────────────────────────
async function scrapeAdProductReport() {
  const cookie = process.env.COUPANG_ADS_COOKIE;
  if (!cookie) return [];
  console.log('[광고센터] 상품별 광고 보고서 수집 중...');

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

  try {
    const context = await browser.newContext();
    const cookiePairs = cookie
      .split(';')
      .map((c) => {
        const eqIdx = c.indexOf('=');
        if (eqIdx < 0) return null;
        return { name: c.slice(0, eqIdx).trim(), value: c.slice(eqIdx + 1).trim(), domain: '.advertising.coupang.com', path: '/' };
      })
      .filter((c) => c !== null && c.name.length > 0);
    await context.addCookies(cookiePairs);

    const page = await context.newPage();
    await page.goto('https://advertising.coupang.com/marketing/report/product?period=30d', { waitUntil: 'domcontentloaded', timeout: 30_000 });

    if (page.url().includes('login') || page.url().includes('sign-in')) {
      console.warn('[광고센터] 세션 만료 — 상품별 광고 데이터 없이 진행');
      return [];
    }

    await page.waitForSelector('table tbody tr', { timeout: 15_000 }).catch(() => null);
    await page.waitForTimeout(2_000);

    const stats = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows
        .map((row) => {
          const cells = Array.from(row.querySelectorAll('td'));
          if (cells.length < 3) return null;
          const nameEl = row.querySelector('a') ?? cells[0];
          const name = nameEl?.textContent?.trim() ?? '';
          if (!name) return null;

          const allText = row.textContent ?? '';
          const spendMatch = allText.match(/([0-9,]+)\s*원/);
          const adSpend = spendMatch ? parseInt(spendMatch[1].replace(/,/g, ''), 10) : 0;
          const roasMatch = allText.match(/([0-9]+(?:\.[0-9]+)?)\s*%/);
          const adRoas = roasMatch ? parseFloat(roasMatch[1]) : 0;
          const orderMatch = allText.match(/전환[^0-9]*([0-9]+)/);
          const adOrders = orderMatch ? parseInt(orderMatch[1], 10) : 0;

          return { name, adSpend, adRoas, adOrders };
        })
        .filter((s) => s !== null && s.name.length > 0);
    });

    console.log(`[광고센터] ${stats.length}개 상품 광고 데이터 수집 완료`);
    await page.close();
    return stats;
  } catch (err) {
    console.warn('[광고센터] 상품별 보고서 스크래핑 실패 (무시):', err);
    return [];
  } finally {
    await browser.close();
  }
}

// ── 이름 유사도 매칭 ─────────────────────────────────────────────────
function nameSimilar(a, b) {
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  const prefix = short.slice(0, 10);
  return long.includes(prefix);
}

// ── 메인 ─────────────────────────────────────────────────────────────
async function main() {
  console.log('=== 쿠팡 광고 데이터 수집 시작 ===\n');

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[오류] .env 파일에 SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 설정해주세요.');
    process.exit(1);
  }

  try {
    const [products, campaigns, adStats] = await Promise.all([
      scrapeWingProducts(),
      scrapeAdsCampaigns(),
      scrapeAdProductReport(),
    ]);

    // 상품명 부분 매칭으로 광고 성과 주입
    for (const product of products) {
      const stat = adStats.find(
        (s) =>
          product.name.includes(s.name) ||
          s.name.includes(product.name) ||
          nameSimilar(product.name, s.name),
      );
      if (stat) {
        product.adSpend = stat.adSpend;
        product.adRoas = stat.adRoas;
        product.adOrders = stat.adOrders;
      }
    }

    const collectedData = { products, campaigns, collectedAt: new Date().toISOString() };

    // Supabase에 저장
    console.log('\n[Supabase] 캐시 저장 중...');
    const { error } = await supabase.from('ad_strategy_cache').insert({
      user_id: FIXED_USER_ID,
      collected_data: collectedData,
      collected_at: collectedData.collectedAt,
    });

    if (error) {
      console.error('[Supabase] 저장 실패:', error.message);
      process.exit(1);
    }

    console.log('\n=== 수집 완료 ===');
    console.log(`상품: ${products.length}개 | 캠페인: ${campaigns.length}개`);
    console.log('스마트셀러 스튜디오 광고전략 페이지를 새로고침하면 결과를 볼 수 있습니다.');
  } catch (err) {
    console.error('\n[오류]', err.message);
    process.exit(1);
  }
}

main();
