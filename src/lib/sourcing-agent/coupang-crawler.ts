import chromiumMin from '@sparticuz/chromium-min';
import { chromium as playwrightChromium } from 'playwright-core';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const randomDelay = () => sleep(2000 + Math.random() * 3000);

export interface CoupangProduct {
  productId: string;
  name: string;
  price: number;
  imageUrl: string;
  productUrl: string;
  rank: number;
}

async function getBrowser() {
  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    return playwrightChromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
  }
  // chromiumMin.headless 속성은 이 버전에 없으므로 playwright 기본값(true) 사용
  return playwrightChromium.launch({
    args: chromiumMin.args,
    executablePath: await chromiumMin.executablePath(
      'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar'
    ),
    headless: true,
  });
}

export async function crawlCoupangCategory(
  categoryUrl: string,
  limit = 20
): Promise<CoupangProduct[]> {
  const browser = await getBrowser();

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      locale: 'ko-KR',
    });

    const page = await context.newPage();

    // webdriver 속성 제거로 봇 탐지 우회
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await randomDelay();

    // 자연스러운 스크롤로 지연 로딩 이미지 트리거
    for (const dist of [300, 600, 1000]) {
      await page.evaluate((y: number) => window.scrollBy(0, y), dist);
      await sleep(500 + Math.random() * 300);
    }

    const products = await page.evaluate((maxItems: number) => {
      // 쿠팡 DOM 구조가 변경될 수 있으므로 복수 셀렉터 fallback 적용
      const selectors = [
        'li[class*="search-product"]:not([class*="ad-product"])',
        'li.search-product:not(.ad-product)',
        'ul#productList > li:not([class*="ad"])',
      ];

      let items: Element[] = [];
      for (const sel of selectors) {
        const found = Array.from(document.querySelectorAll(sel));
        if (found.length > 0) { items = found; break; }
      }

      const results: {
        productId: string; name: string; price: number;
        imageUrl: string; productUrl: string; rank: number;
      }[] = [];

      let rank = 1;
      for (const item of items.slice(0, maxItems * 2)) {
        const anchor = item.querySelector('a[href*="/vp/products/"]') as HTMLAnchorElement | null;
        if (!anchor) continue;

        const href = anchor.getAttribute('href') ?? '';
        const idMatch = href.match(/\/products\/(\d+)/);
        if (!idMatch) continue;
        const productId = idMatch[1];

        const nameEl = item.querySelector('[class*="name"]') as HTMLElement | null;
        const priceEl = item.querySelector('[class*="price-value"], strong[class*="price"]') as HTMLElement | null;
        const imgEl = item.querySelector('img') as HTMLImageElement | null;

        const name = nameEl?.textContent?.trim() ?? '';
        if (!name) continue;

        // q 파라미터를 q90으로 통일해 고품질 썸네일 확보
        const rawSrc = imgEl?.src ?? imgEl?.getAttribute('data-src') ?? '';
        const imageUrl = rawSrc.replace(/q\d+/, 'q90');

        results.push({
          productId,
          name,
          price: parseInt((priceEl?.textContent ?? '0').replace(/[^0-9]/g, ''), 10),
          imageUrl,
          productUrl: `https://www.coupang.com${href.split('?')[0]}`,
          rank: rank++,
        });

        if (results.length >= maxItems) break;
      }
      return results;
    }, limit);

    // name, productId, imageUrl 모두 있는 항목만 반환
    return products.filter((p) => p.name && p.productId && p.imageUrl);
  } finally {
    await browser.close();
  }
}
