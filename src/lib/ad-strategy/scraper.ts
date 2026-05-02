import { chromium } from 'playwright';
import type { CollectedData, RawProduct, RawCampaign } from './types';

const WING_INVENTORY_URL =
  'https://wing.coupang.com/vendor-inventory/list?statusSearch=VALID';

/**
 * Wing 벤더 인벤토리 + 광고센터 캠페인 데이터를 수집한다.
 * Wing: COUPANG_WING_COOKIE env var 쿠키 주입 방식.
 * 광고센터: COUPANG_ADS_COOKIE env var 사용.
 * 쿠키 갱신: 브라우저 DevTools → Application → Cookies → wing.coupang.com에서 복사.
 */
export async function scrapeAdData(): Promise<CollectedData> {
  const [products, campaigns] = await Promise.all([
    scrapeWingProducts(),
    scrapeAdsCampaigns(),
  ]);
  return { products, campaigns, collectedAt: new Date().toISOString() };
}

async function scrapeWingProducts(): Promise<RawProduct[]> {
  const wingCookie = process.env.COUPANG_WING_COOKIE;
  if (!wingCookie) {
    throw new Error(
      'Wing 세션 쿠키가 없습니다. .env.local의 COUPANG_WING_COOKIE를 설정해 주세요.',
    );
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const context = await browser.newContext();

    // 쿠키 파싱 후 주입
    const cookiePairs = wingCookie
      .split(';')
      .map((c) => {
        const eqIdx = c.indexOf('=');
        if (eqIdx < 0) return null;
        const name = c.slice(0, eqIdx).trim();
        const value = c.slice(eqIdx + 1).trim();
        return { name, value, domain: '.wing.coupang.com', path: '/' };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null && c.name.length > 0);

    await context.addCookies(cookiePairs);

    const page = await context.newPage();
    await page.goto(WING_INVENTORY_URL, { waitUntil: 'networkidle', timeout: 30_000 });

    if (page.url().includes('login') || page.url().includes('sign-in') || page.url().includes('xauth')) {
      throw new Error(
        'Wing 세션이 만료되었습니다. .env.local의 COUPANG_WING_COOKIE를 갱신해 주세요.',
      );
    }

    // 상품 테이블이 로드될 때까지 대기
    await page.waitForSelector('table tbody tr, [class*="inventory-row"]', {
      timeout: 15_000,
    }).catch(() => null);

    const products = await page.evaluate((): RawProduct[] => {
      const rows = Array.from(
        document.querySelectorAll('table tbody tr, [class*="inventory-row"]'),
      );
      return rows
        .map((row) => {
          const cells = Array.from(row.querySelectorAll('td, [class*="cell"]'));
          const nameEl =
            row.querySelector('[class*="product-name"], [data-label*="상품명"]') ||
            cells[1];
          const name = nameEl?.textContent?.trim() ?? '';
          if (!name) return null;

          const idEl = cells[0];
          const sellerProductId = idEl?.textContent?.trim() ?? '';

          const isItemWinner =
            row.querySelector('[class*="winner"], [class*="item-winner"]') !== null ||
            cells.some((c) =>
              c.textContent?.includes('아이템위너') ||
              c.textContent?.includes('위너 보유'),
            );

          const stockCell = cells.find(
            (c) =>
              c.getAttribute('data-label')?.includes('재고') ||
              c.querySelector('[class*="stock"]') !== null,
          );
          const stock =
            parseInt((stockCell?.textContent ?? '0').replace(/[^0-9]/g, ''), 10) || 0;

          const priceCell = cells.find(
            (c) =>
              c.getAttribute('data-label')?.includes('판매가') ||
              c.getAttribute('data-label')?.includes('가격'),
          );
          const salePrice =
            parseInt((priceCell?.textContent ?? '0').replace(/[^0-9]/g, ''), 10) || 0;

          const imageViolation =
            row.querySelector('[class*="violation"], [class*="block"], [class*="error"]') !==
              null ||
            cells.some(
              (c) =>
                c.textContent?.includes('이미지 위반') ||
                c.textContent?.includes('검수 반려'),
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

    // 저장된 쿠키 파싱 후 주입
    const cookiePairs = cookie
      .split(';')
      .map((c) => {
        const eqIdx = c.indexOf('=');
        if (eqIdx < 0) return null;
        const name = c.slice(0, eqIdx).trim();
        const value = c.slice(eqIdx + 1).trim();
        return {
          name,
          value,
          domain: '.advertising.coupang.com',
          path: '/',
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null && c.name.length > 0);

    await context.addCookies(cookiePairs);

    const page = await context.newPage();
    await page.goto(
      'https://advertising.coupang.com/marketing/dashboard/sales',
      { waitUntil: 'networkidle', timeout: 30_000 },
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
          const cells = Array.from(
            row.querySelectorAll('td, [class*="cell"]'),
          );
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
