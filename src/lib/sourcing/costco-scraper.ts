/**
 * costco-scraper.ts
 * 코스트코 코리아 온라인몰 스크래퍼
 *
 * costco.co.kr은 Angular(Spartacus/Hybris) SPA이므로
 * Playwright로 JavaScript 렌더링 후 DOM에서 데이터를 추출한다.
 *
 * ⚠️ 로컬 실행 전 브라우저 설치 필요:
 *    npx playwright install chromium
 *
 * ⚠️ Vercel 배포 시:
 *    playwright-core + @sparticuz/chromium-min 으로 교체 필요
 */

import { chromium } from 'playwright';

// ─────────────────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────────────────

export interface CostcoProduct {
  productCode: string;
  title: string;
  categoryName: string;
  price: number;
  originalPrice?: number;
  imageUrl?: string;
  productUrl: string;
}

export interface ScrapeResult {
  products: CostcoProduct[];
  errors: { category: string; message: string }[];
  totalScraped: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 수집 대상 카테고리
// ─────────────────────────────────────────────────────────────────────────────

export const COSTCO_CATEGORIES = [
  { name: '식품', slug: 'food' },
  { name: '생활용품', slug: 'household-cleaning' },
  { name: '건강·뷰티', slug: 'health-beauty' },
  { name: '전자제품', slug: 'electronics' },
  { name: '의류·패션', slug: 'clothing' },
  { name: '완구·스포츠', slug: 'toys-sports' },
  { name: '가구·홈데코', slug: 'furniture-home-decor' },
  { name: '자동차용품', slug: 'automotive' },
] as const;

const BASE_URL = 'https://www.costco.co.kr';

// ─────────────────────────────────────────────────────────────────────────────
// 카테고리 페이지 스크래핑
// ─────────────────────────────────────────────────────────────────────────────

async function scrapeCategoryPage(
  page: import('playwright').Page,
  categoryName: string,
  pageUrl: string,
): Promise<CostcoProduct[]> {
  await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30_000 });

  await page.waitForSelector(
    'cx-product-list-item, .product-item, app-product-list-item, [class*="product-card"]',
    { timeout: 20_000 },
  ).catch(() => null);

  const products = await page.evaluate((catName: string) => {
    const cardSelectors = [
      'cx-product-list-item',
      'app-product-list-item',
      '.product-item',
      '[class*="product-card"]',
      '[data-product-code]',
    ];

    let cards: Element[] = [];
    for (const sel of cardSelectors) {
      const found = Array.from(document.querySelectorAll(sel));
      if (found.length > 0) { cards = found; break; }
    }

    return cards.map((card) => {
      // 상품명
      const titleEl = card.querySelector(
        '.cx-product-name, .product-name, h2 a, h3 a, [class*="product-name"], [class*="item-name"]'
      );
      const title = titleEl?.textContent?.trim() ?? '';

      // 링크 / 코드
      const linkEl = card.querySelector('a[href*="/p/"], a[href*="/product"]') as HTMLAnchorElement | null;
      const href = linkEl?.href ?? '';
      const productCode = (() => {
        try {
          const pathname = new URL(href).pathname;
          const numericMatch = pathname.match(/(\d{5,})/);
          if (numericMatch) return numericMatch[1];
          const segments = pathname.split('/').filter(Boolean);
          return segments[segments.length - 1] || href;
        } catch { return href; }
      })();

      // 현재 가격
      const priceEl = card.querySelector(
        '.cx-value, cx-product-price .value, [class*="price-value"], [class*="selling-price"], [class*="current-price"]'
      );
      const priceCleaned = (priceEl?.textContent?.trim() ?? '').replace(/[^0-9]/g, '');
      const price = priceCleaned ? parseInt(priceCleaned, 10) : 0;

      // 원가
      const originalPriceEl = card.querySelector(
        '.cx-original-price, [class*="original-price"], [class*="list-price"], del'
      );
      const originalPriceCleaned = (originalPriceEl?.textContent?.trim() ?? '').replace(/[^0-9]/g, '');
      const originalPrice = originalPriceCleaned ? parseInt(originalPriceCleaned, 10) : undefined;

      // 이미지
      const imgEl = card.querySelector('cx-media img, img[src*="costco"], img') as HTMLImageElement | null;
      const imageUrl = imgEl?.src ?? undefined;

      return { productCode, title, categoryName: catName, price, originalPrice, imageUrl, productUrl: href };
    }).filter((p) => p.title && p.price > 0 && p.productUrl);
  }, categoryName);

  return products as CostcoProduct[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 스크래퍼
// ─────────────────────────────────────────────────────────────────────────────

export async function scrapeCostcoProducts(
  options: { categories?: string[]; maxPages?: number } = {},
): Promise<ScrapeResult> {
  const { maxPages = 3 } = options;
  const targetCategories = options.categories
    ? COSTCO_CATEGORIES.filter((c) => options.categories!.includes(c.slug))
    : COSTCO_CATEGORIES;

  const browser = await chromium.launch({ headless: true });
  const allProducts: CostcoProduct[] = [];
  const errors: { category: string; message: string }[] = [];

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'ko-KR',
    });
    const page = await context.newPage();

    for (const category of targetCategories) {
      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const url =
          pageNum === 1
            ? `${BASE_URL}/c/${category.slug}`
            : `${BASE_URL}/c/${category.slug}?currentPage=${pageNum - 1}`;

        try {
          const products = await scrapeCategoryPage(page, category.name, url);
          if (products.length === 0) break;
          allProducts.push(...products);
        } catch (err) {
          errors.push({ category: `${category.name} p${pageNum}`, message: err instanceof Error ? err.message : String(err) });
          break;
        }
      }
    }

    await context.close();
  } finally {
    await browser.close();
  }

  // 중복 제거
  const seen = new Set<string>();
  const unique = allProducts.filter((p) => {
    if (!p.productCode || seen.has(p.productCode)) return false;
    seen.add(p.productCode);
    return true;
  });

  return { products: unique, errors, totalScraped: unique.length };
}
