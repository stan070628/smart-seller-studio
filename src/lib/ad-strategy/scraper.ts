import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import type { CollectedData, RawProduct, RawCampaign } from './types';

const WING_INVENTORY_URL =
  'https://wing.coupang.com/vendor-inventory/list?statusSearch=VALID';

// browse 스킬이 저장하는 세션 파일 경로 (git root 기준)
const WING_SESSION_FILE = path.resolve(
  process.cwd(),
  '.gstack/browse-states/wing-session.json',
);

interface ProductAdStat {
  name: string;
  adSpend: number;   // 원
  adRoas: number;    // %
  adOrders: number;
}

async function scrapeAdProductReport(): Promise<ProductAdStat[]> {
  const cookie = process.env.COUPANG_ADS_COOKIE;
  if (!cookie) {
    console.warn('[scraper] COUPANG_ADS_COOKIE 미설정 — 상품별 광고 데이터 없이 진행');
    return [];
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
  });

  try {
    const context = await browser.newContext();

    const cookiePairs = cookie
      .split(';')
      .map((c) => {
        const eqIdx = c.indexOf('=');
        if (eqIdx < 0) return null;
        const name = c.slice(0, eqIdx).trim();
        const value = c.slice(eqIdx + 1).trim();
        return { name, value, domain: '.advertising.coupang.com', path: '/' };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null && c.name.length > 0);

    await context.addCookies(cookiePairs);

    const page = await context.newPage();

    // 30일 상품별 보고서 페이지
    await page.goto(
      'https://advertising.coupang.com/marketing/report/product?period=30d',
      { waitUntil: 'domcontentloaded', timeout: 30_000 },
    );

    if (page.url().includes('login') || page.url().includes('sign-in')) {
      console.warn('[scraper] 광고센터 세션 만료 — 상품별 광고 데이터 없이 진행');
      return [];
    }

    // 테이블 로드 대기 (최대 15초, 없으면 빈 배열)
    await page
      .waitForSelector('table tbody tr', { timeout: 15_000 })
      .catch(() => null);
    await page.waitForTimeout(2_000);

    const stats = await page.evaluate((): ProductAdStat[] => {
      interface ProductAdStat {
        name: string;
        adSpend: number;
        adRoas: number;
        adOrders: number;
      }

      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows
        .map((row) => {
          const cells = Array.from(row.querySelectorAll('td'));
          if (cells.length < 3) return null;

          // 상품명: 첫 번째 셀 (또는 a 태그 텍스트)
          const nameEl = row.querySelector('a') ?? cells[0];
          const name = nameEl?.textContent?.trim() ?? '';
          if (!name) return null;

          const allText = row.textContent ?? '';

          // 광고비: "N원" 패턴
          const spendMatch = allText.match(/([0-9,]+)\s*원/);
          const adSpend = spendMatch
            ? parseInt(spendMatch[1].replace(/,/g, ''), 10)
            : 0;

          // ROAS: "N%" 패턴
          const roasMatch = allText.match(/([0-9]+(?:\.[0-9]+)?)\s*%/);
          const adRoas = roasMatch ? parseFloat(roasMatch[1]) : 0;

          // 전환 주문수
          const orderMatch = allText.match(/전환[^0-9]*([0-9]+)/);
          const adOrders = orderMatch ? parseInt(orderMatch[1], 10) : 0;

          return { name, adSpend, adRoas, adOrders } as ProductAdStat;
        })
        .filter((s): s is ProductAdStat => s !== null && s.name.length > 0);
    });

    await page.close();
    return stats;
  } catch (err) {
    console.warn('[scraper] 상품별 광고 보고서 스크래핑 실패 (무시):', err);
    return [];
  } finally {
    await browser.close();
  }
}

/** 두 문자열이 앞 10자 기준으로 포함 관계면 true */
function levenshteinSimilar(a: string, b: string): boolean {
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  const prefix = short.slice(0, 10);
  return long.includes(prefix);
}

/**
 * Wing 벤더 인벤토리 + 광고센터 캠페인 + 상품별 광고 보고서를 수집한다.
 *
 * Wing 세션: `.gstack/browse-states/wing-session.json` (browse 스킬 `$B state save wing-session`으로 갱신)
 * 광고센터: COUPANG_ADS_COOKIE env var
 */
export async function scrapeAdData(): Promise<CollectedData> {
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
        levenshteinSimilar(product.name, s.name),
    );
    if (stat) {
      product.adSpend = stat.adSpend;
      product.adRoas = stat.adRoas;
      product.adOrders = stat.adOrders;
    }
  }

  return { products, campaigns, collectedAt: new Date().toISOString() };
}

interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

/** browse 세션 파일에서 쿠키를 읽어 Playwright context에 주입 */
function loadWingCookies(): PlaywrightCookie[] {
  if (!fs.existsSync(WING_SESSION_FILE)) {
    throw new Error(
      `Wing 세션 파일이 없습니다: ${WING_SESSION_FILE}\n` +
      '브라우저에서 Wing에 로그인 후 "$B state save wing-session" 을 실행해 주세요.',
    );
  }

  const raw = JSON.parse(fs.readFileSync(WING_SESSION_FILE, 'utf-8')) as {
    cookies?: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
      expires?: number;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: string;
    }>;
  };

  const cookies: PlaywrightCookie[] = (raw.cookies ?? [])
    .filter((c) =>
      c.domain.includes('wing.coupang.com') ||
      c.domain.includes('xauth.coupang.com') ||
      c.domain.includes('.coupang.com'),
    )
    .map((c) => {
      const entry: PlaywrightCookie = {
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path ?? '/',
        httpOnly: c.httpOnly ?? false,
        secure: c.secure ?? false,
        sameSite: (c.sameSite as 'Strict' | 'Lax' | 'None') ?? 'Lax',
      };
      if (c.expires && c.expires > 0) entry.expires = c.expires;
      return entry;
    });

  if (cookies.length === 0) {
    throw new Error('Wing 세션 파일에 유효한 쿠키가 없습니다. 세션을 다시 저장해 주세요.');
  }

  return cookies;
}

async function scrapeWingProducts(): Promise<RawProduct[]> {
  const cookies = loadWingCookies();

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

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
      throw new Error(
        'Wing 세션이 만료되었습니다. ' +
        '"$B state save wing-session" 으로 세션을 갱신해 주세요.',
      );
    }

    // 상품 테이블이 로드될 때까지 대기 (DOM 렌더링 후 추가 5초)
    await page
      .waitForSelector('table tbody tr', { timeout: 15_000 })
      .catch(() => null);
    await page.waitForTimeout(3_000);

    const products = await page.evaluate((): RawProduct[] => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows
        .map((row) => {
          const cells = Array.from(row.querySelectorAll('td'));

          // 상품명: a.ip-title 또는 cells[1] fallback
          const nameEl = row.querySelector('a.ip-title') ?? cells[1];
          const name = nameEl?.textContent?.trim() ?? '';
          if (!name) return null;

          // Inventory ID: URL 파라미터 or 텍스트에서 추출
          const href = (row.querySelector('a.ip-title') as HTMLAnchorElement | null)?.href ?? '';
          const idMatch = href.match(/vendorInventoryId=(\d+)/) ?? name.match(/Inventory ID (\d+)/);
          const sellerProductId = idMatch?.[1] ?? '';

          // 아이템위너: cells[3]에 "Item winner" 또는 "아이템위너" 텍스트
          const isItemWinner =
            row.querySelector('[class*="winner"], [class*="item-winner"]') !== null ||
            cells.some(
              (c) =>
                c.textContent?.includes('Item winner') ||
                c.textContent?.includes('아이템위너') ||
                c.textContent?.includes('위너 보유'),
            );

          // 재고: .is-top 숫자
          const stockEl = row.querySelector('.is-top');
          const stock =
            parseInt((stockEl?.textContent ?? cells[2]?.textContent ?? '0').replace(/[^0-9]/g, ''), 10) || 0;

          // 판매가: .isp-top 에서 숫자 추출 (예: "41,900KRW~")
          const priceEl = row.querySelector('.isp-top');
          const salePrice =
            parseInt((priceEl?.textContent ?? cells[4]?.textContent ?? '0').replace(/[^0-9]/g, ''), 10) || 0;

          // 이미지 위반: 위반/반려 텍스트
          const imageViolation =
            row.querySelector('[class*="violation"], [class*="block"], [class*="error"]') !== null ||
            cells.some(
              (c) =>
                c.textContent?.includes('이미지 위반') ||
                c.textContent?.includes('검수 반려') ||
                c.textContent?.includes('Image violation') ||
                c.textContent?.includes('Rejected'),
            );

          return {
            name,
            sellerProductId,
            isItemWinner,
            stock,
            salePrice,
            monthlySales: 0,
            imageViolation,
          } as RawProduct;
        })
        .filter((p): p is RawProduct => p !== null && p.name.length > 0);
    });

    await page.close();
    return products;
  } finally {
    await browser.close();
  }
}

async function scrapeAdsCampaigns(): Promise<RawCampaign[]> {
  const cookie = process.env.COUPANG_ADS_COOKIE;
  if (!cookie) {
    console.warn('[scraper] COUPANG_ADS_COOKIE 미설정 — 광고 데이터 없이 진행');
    return [];
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
  });

  try {
    const context = await browser.newContext();

    const cookiePairs = cookie
      .split(';')
      .map((c) => {
        const eqIdx = c.indexOf('=');
        if (eqIdx < 0) return null;
        const name = c.slice(0, eqIdx).trim();
        const value = c.slice(eqIdx + 1).trim();
        return { name, value, domain: '.advertising.coupang.com', path: '/' };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null && c.name.length > 0);

    await context.addCookies(cookiePairs);

    const page = await context.newPage();
    await page.goto(
      'https://advertising.coupang.com/marketing/dashboard/sales',
      { waitUntil: 'domcontentloaded', timeout: 30_000 },
    );

    if (page.url().includes('login') || page.url().includes('sign-in')) {
      throw new Error(
        '광고센터 세션이 만료되었습니다. .env.local의 COUPANG_ADS_COOKIE를 갱신해 주세요.',
      );
    }

    await page
      .waitForSelector('table tbody tr, [class*="campaign"]', { timeout: 15_000 })
      .catch(() => null);

    const campaigns = await page.evaluate((): RawCampaign[] => {
      const rows = Array.from(
        document.querySelectorAll(
          'table tbody tr, [class*="campaign-row"], [class*="campaignRow"]',
        ),
      );
      return rows
        .map((row) => {
          const cells = Array.from(row.querySelectorAll('td, [class*="cell"]'));
          const name = cells[0]?.textContent?.trim() ?? '';
          if (!name) return null;

          const campaignId =
            row.getAttribute('data-campaign-id') ??
            row.getAttribute('data-id') ??
            String(Math.random());

          const allText = row.textContent ?? '';
          const status: RawCampaign['status'] =
            allText.includes('활성') || allText.includes('ACTIVE')
              ? 'ACTIVE'
              : allText.includes('종료') || allText.includes('ENDED')
              ? 'ENDED'
              : 'PAUSED';

          const budgetMatch = allText.match(/([0-9,]+)\s*원/);
          const dailyBudget = budgetMatch
            ? parseInt(budgetMatch[1].replace(/,/g, ''), 10)
            : 0;

          const roasMatch = allText.match(/([0-9]+(?:\.[0-9]+)?)\s*%/);
          const roas = roasMatch ? parseFloat(roasMatch[1]) : 0;

          const ctrMatch = allText.match(/CTR[^0-9]*([0-9]+(?:\.[0-9]+)?)/i);
          const ctr = ctrMatch ? parseFloat(ctrMatch[1]) : 0;

          const endDateMatch = allText.match(/(\d{4}[-/.]\d{2}[-/.]\d{2})/);
          const endDate = endDateMatch ? endDateMatch[1] : undefined;

          return {
            campaignId,
            name,
            status,
            dailyBudget,
            roas,
            ctr,
            endDate,
          } as RawCampaign;
        })
        .filter((c): c is RawCampaign => c !== null && c.name.length > 0);
    });

    await page.close();
    return campaigns;
  } finally {
    await browser.close();
  }
}
