/**
 * 한국어 도매꾹 상품명 + 이미지 → 1688 동일 상품 매칭 모듈
 *
 * 1. Claude Haiku로 한→중 키워드 번역
 * 2. puppeteer-core로 1688 검색결과 상위 5개 스크래핑
 * 3. compareImages로 유사도 비교 (80% 이상만 채택)
 * 4. calc1688Margin으로 원가/마진 계산
 */

import Anthropic from '@anthropic-ai/sdk';
import puppeteer from 'puppeteer-core';
import { compareImages } from './image-similarity';
import {
  calc1688Margin,
  DEFAULT_EXCHANGE_RATE_KRW_PER_RMB,
  DEFAULT_TARIFF_RATE,
} from '@/lib/sourcing/margin-1688';

const SIMILARITY_THRESHOLD = 80;
const MAX_CANDIDATES = 5;
const DEFAULT_SHIPPING_PER_UNIT_KRW = 3000;
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

export interface ChinaMatch {
  productName: string;
  priceRmb: number;
  priceKrw: number;
  url: string;
  imageUrl: string;
  marginRate: number;
}

interface RawCandidate {
  title: string;
  priceRmb: number;
  url: string;
  imageUrl: string;
}

async function getBrowser() {
  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    return puppeteer.launch({
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
      headless: true,
    });
  }
  const chromiumMin = (await import('@sparticuz/chromium-min')).default;
  return puppeteer.launch({
    args: [...chromiumMin.args, '--lang=zh-CN'],
    executablePath: await chromiumMin.executablePath(
      'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar'
    ),
    headless: true,
  });
}

/** Claude Haiku로 한국어 상품명을 1688 검색에 적합한 중국어 키워드로 번역 */
async function translateKeyword(koreanName: string): Promise<string> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 80,
    messages: [
      {
        role: 'user',
        content:
          `다음 한국어 상품명을 1688.com 검색에 최적화된 중국어 키워드(간체자, 3단어 이내)로만 번역하세요.\n` +
          `설명이나 다른 텍스트 없이 중국어 키워드만 반환하세요.\n\n상품명: ${koreanName}`,
      },
    ],
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('Claude 번역 응답 없음');
  return textBlock.text.trim();
}

/** puppeteer-core로 1688 검색결과 상위 후보 스크래핑 */
async function scrape1688Candidates(keyword: string): Promise<RawCandidate[]> {
  const searchUrl = `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(keyword)}`;
  const browser = await getBrowser();

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 900 });

    // 봇 탐지 우회
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // 지연 로딩 트리거
    for (const dist of [400, 800, 1200]) {
      await page.evaluate((y: number) => window.scrollBy(0, y), dist);
      await new Promise<void>((r) => setTimeout(r, 600 + Math.random() * 400));
    }

    // 복수 셀렉터 fallback으로 상품 카드 추출
    const candidates = await page.evaluate((max: number) => {
      const selectors = [
        '.organic-offer-list .organic-offer-item',
        '[class*="offer-list"] [class*="offer-item"]',
        '.offer-list-row .offer-item',
      ];

      let items: Element[] = [];
      for (const sel of selectors) {
        const found = Array.from(document.querySelectorAll(sel));
        if (found.length > 0) { items = found; break; }
      }

      const results: { title: string; priceRmb: number; url: string; imageUrl: string }[] = [];

      for (const item of items.slice(0, max * 3)) {
        const anchor = item.querySelector('a') as HTMLAnchorElement | null;
        const titleEl = item.querySelector('[class*="title"], [class*="subject"], [class*="name"]') as HTMLElement | null;
        const priceEl = item.querySelector('[class*="price"] em, [class*="price"] strong, [class*="price"]') as HTMLElement | null;
        const imgEl = item.querySelector('img') as HTMLImageElement | null;

        const title = titleEl?.textContent?.trim() ?? '';
        const href = anchor?.getAttribute('href') ?? '';
        const rawPrice = priceEl?.textContent?.replace(/[^0-9.]/g, '') ?? '';
        const priceRmb = parseFloat(rawPrice) || 0;
        const rawSrc = imgEl?.src ?? imgEl?.getAttribute('data-src') ?? '';
        const imageUrl = rawSrc.startsWith('//') ? `https:${rawSrc}` : rawSrc;
        const url = href.startsWith('//') ? `https:${href}` : href.startsWith('http') ? href : `https:${href}`;

        if (!title || priceRmb <= 0 || !imageUrl) continue;
        results.push({ title, priceRmb, url, imageUrl });
        if (results.length >= max) break;
      }
      return results;
    }, MAX_CANDIDATES);

    return candidates;
  } finally {
    await browser.close();
  }
}

/**
 * 상품명 + 이미지로 1688 최적 매칭 상품을 반환한다.
 * 유사도 80% 이상 후보가 없으면 null을 반환한다.
 */
export async function matchOn1688(
  productName: string,
  referenceImageUrl: string,
  marketPriceKrw: number,
): Promise<ChinaMatch | null> {
  // 1단계: 한→중 키워드 번역
  let chineseKeyword: string;
  try {
    chineseKeyword = await translateKeyword(productName);
  } catch (err) {
    console.error('[china-matcher] 번역 실패:', err instanceof Error ? err.message : err);
    return null;
  }

  // 2단계: 1688 검색결과 스크래핑
  let candidates: RawCandidate[];
  try {
    candidates = await scrape1688Candidates(chineseKeyword);
  } catch (err) {
    console.error('[china-matcher] 1688 스크래핑 실패:', err instanceof Error ? err.message : err);
    return null;
  }

  if (candidates.length === 0) {
    console.warn('[china-matcher] 1688 검색 결과 없음:', chineseKeyword);
    return null;
  }

  // 3단계: 이미지 유사도 비교 (병렬 실행)
  const similarityResults = await Promise.all(
    candidates.map((c) => compareImages(referenceImageUrl, c.imageUrl))
  );

  // 유사도 내림차순 정렬 후 임계값 이상인 최고 후보 선택
  const ranked = candidates
    .map((c, i) => ({ ...c, similarity: similarityResults[i].similarity }))
    .filter((c) => c.similarity >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity);

  if (ranked.length === 0) {
    console.info(
      `[china-matcher] 유사도 ${SIMILARITY_THRESHOLD}% 이상 후보 없음 (최고: ` +
      `${Math.max(...similarityResults.map((r) => r.similarity))}%)`
    );
    return null;
  }

  const best = ranked[0];

  // 4단계: 1688 마진 계산
  const marginResult = calc1688Margin({
    buyPriceRmb: best.priceRmb,
    exchangeRate: DEFAULT_EXCHANGE_RATE_KRW_PER_RMB,
    tariffRate: DEFAULT_TARIFF_RATE,
    // 자동 매칭 경로는 관세사 수임료를 따로 알지 못하므로 상수 전액을 과세운임으로 본다.
    dutiableFreightKrw: DEFAULT_SHIPPING_PER_UNIT_KRW,
    nonDutiableFreightKrw: 0,
    packQty: 1,
    channel: 'coupang',
    categoryName: null,
    sellPrice: marketPriceKrw,
    groceryRunningCost: 0,
  });

  return {
    productName: best.title,
    priceRmb: best.priceRmb,
    priceKrw: marginResult.totalCostKrw,
    url: best.url,
    imageUrl: best.imageUrl,
    marginRate: marginResult.marginRate,
  };
}
