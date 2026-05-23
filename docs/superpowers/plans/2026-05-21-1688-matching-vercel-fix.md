# 1688 매칭 Vercel 서버리스 호환 복구 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `playwright-core`를 `puppeteer-core`로 교체해 Vercel 서버리스에서 1688 매칭이 정상 동작하도록 복구한다.

**Architecture:** `playwright-core/browsers.json`이 Vercel 배포 번들에서 누락되어 모듈 로드가 실패한다. `puppeteer-core`는 이 파일이 불필요해 동일 문제가 발생하지 않는다. `china-matcher.ts`의 브라우저 실행 코드만 puppeteer API로 교체하고, `keyword-pipeline.ts`에서 제거했던 1688 매칭 호출을 복구한다.

**Tech Stack:** `puppeteer-core`, `@sparticuz/chromium-min` (이미 설치됨), Next.js `serverExternalPackages`

---

### Task 1: puppeteer-core 설치 및 china-matcher.ts 교체

**Files:**
- Modify: `src/lib/sourcing-agent/china-matcher.ts`
- Modify: `next.config.ts`

- [ ] **Step 1: puppeteer-core 설치**

```bash
npm install puppeteer-core
```

Expected output: `added 1 package` (또는 업데이트 메시지)

- [ ] **Step 2: 설치 확인**

```bash
node -e "require('puppeteer-core'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: china-matcher.ts 전체 교체**

`src/lib/sourcing-agent/china-matcher.ts`를 아래 내용으로 완전히 교체한다:

```typescript
/**
 * 한국어 도매꾹 상품명 + 이미지 → 1688 동일 상품 매칭 모듈
 *
 * 1. Claude Haiku로 한→중 키워드 번역
 * 2. puppeteer-core로 1688 검색결과 상위 5개 스크래핑
 * 3. compareImages로 유사도 비교 (80% 이상만 채택)
 * 4. calc1688Margin으로 원가/마진 계산
 */

import Anthropic from '@anthropic-ai/sdk';
import chromiumMin from '@sparticuz/chromium-min';
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
  return puppeteer.launch({
    args: [...chromiumMin.args, '--lang=zh-CN'],
    executablePath: await chromiumMin.executablePath(
      'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar'
    ),
    headless: true,
  });
}

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

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    for (const dist of [400, 800, 1200]) {
      await page.evaluate((y: number) => window.scrollBy(0, y), dist);
      await new Promise<void>((r) => setTimeout(r, 600 + Math.random() * 400));
    }

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

export async function matchOn1688(
  productName: string,
  referenceImageUrl: string,
  marketPriceKrw: number,
): Promise<ChinaMatch | null> {
  let chineseKeyword: string;
  try {
    chineseKeyword = await translateKeyword(productName);
  } catch (err) {
    console.error('[china-matcher] 번역 실패:', err instanceof Error ? err.message : err);
    return null;
  }

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

  const similarityResults = await Promise.all(
    candidates.map((c) => compareImages(referenceImageUrl, c.imageUrl))
  );

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

  const marginResult = calc1688Margin({
    buyPriceRmb: best.priceRmb,
    exchangeRate: DEFAULT_EXCHANGE_RATE_KRW_PER_RMB,
    tariffRate: DEFAULT_TARIFF_RATE,
    shippingPerUnitKrw: DEFAULT_SHIPPING_PER_UNIT_KRW,
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
```

- [ ] **Step 4: next.config.ts 업데이트 — playwright-core → puppeteer-core**

`next.config.ts` line 14의 `serverExternalPackages` 배열에서 `'playwright-core'`를 `'puppeteer-core'`로 교체한다:

```typescript
serverExternalPackages: ['@resvg/resvg-js', 'sharp', 'puppeteer-core', '@sparticuz/chromium-min', 'pg'],
```

- [ ] **Step 5: 로컬 빌드 확인**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ Generating static pages` — 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add src/lib/sourcing-agent/china-matcher.ts next.config.ts package.json package-lock.json
git commit -m "fix(china-matcher): playwright-core → puppeteer-core, Vercel 서버리스 호환"
```

---

### Task 2: keyword-pipeline.ts에 1688 매칭 복구

**Files:**
- Modify: `src/lib/sourcing-agent/keyword-pipeline.ts`

- [ ] **Step 1: keyword-pipeline.ts 수정 — 1688 매칭 복구**

`src/lib/sourcing-agent/keyword-pipeline.ts` 첫 번째 import 블록(line 1~15)을 아래로 교체한다:

```typescript
import { getSourcingPool } from '@/lib/sourcing/db';
import { searchNaverLowestPrice } from '@/lib/sourcing/naver-shopping';
import { extractKeywordsFromProduct } from '@/lib/sourcing/ai-keyword-extract';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { calcMarginRate } from '@/lib/sourcing/domeggook-pricing';
import { matchOn1688 } from './china-matcher';
import {
  createRequest,
  completeRequest,
  failRequest,
  saveKeywordResults,
  type KeywordResultInsert,
} from './keyword-db';
import { sendTelegramMessage } from '@/lib/telegram/client';
import type { DomeggookListItem } from '@/types/sourcing';
```

- [ ] **Step 2: 1688 매칭 로직 복구**

`keyword-pipeline.ts`의 각 후보 처리 루프(현재 `resultRows.push({...})` 블록)를 아래로 교체한다:

현재 코드 (line ~109~124):
```typescript
      resultRows.push({
        rank: 0,
        naver_price: naverPrice,
        naver_url: null,
        domeggook_product_name: item.title,
        domeggook_price: item.price,
        domeggook_url: item.url,
        domeggook_image_url: item.thumb || null,
        domeggook_margin_rate: marginRate,
        china_product_name: null,
        china_price_krw: null,
        china_url: null,
        china_margin_rate: null,
        _margin: marginRate,
      });
```

교체할 코드:
```typescript
      let chinaMatch = null;
      try {
        if (item.thumb) {
          chinaMatch = await matchOn1688(item.title, item.thumb, naverPrice);
        }
      } catch (err) {
        console.warn('[keyword-pipeline] 1688 매칭 실패:', item.title, err instanceof Error ? err.message : err);
      }

      resultRows.push({
        rank: 0,
        naver_price: naverPrice,
        naver_url: null,
        domeggook_product_name: item.title,
        domeggook_price: item.price,
        domeggook_url: item.url,
        domeggook_image_url: item.thumb || null,
        domeggook_margin_rate: marginRate,
        china_product_name: chinaMatch?.productName ?? null,
        china_price_krw: chinaMatch?.priceKrw ?? null,
        china_url: chinaMatch?.url ?? null,
        china_margin_rate: chinaMatch ? chinaMatch.marginRate * 100 : null,
        _margin: marginRate,
      });
```

- [ ] **Step 3: 로컬 빌드 확인**

```bash
npm run build 2>&1 | tail -5
```

Expected: `✓ Generating static pages` — 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add src/lib/sourcing-agent/keyword-pipeline.ts
git commit -m "feat(keyword-pipeline): 1688 매칭 복구 (puppeteer-core 기반)"
```

---

### Task 3: Vercel 배포 및 웹훅 재등록

**Files:** 없음 (배포 작업)

- [ ] **Step 1: Vercel 프로덕션 배포**

```bash
vercel --prod --force 2>&1 | tail -10
```

Expected: `"readyState": "READY"`

- [ ] **Step 2: 웹훅 재등록**

환경 변수에서 토큰/시크릿 값을 확인한 후 아래 명령 실행 (값은 `.env.local` 참조):

```bash
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"https://smartsellerstudio.vercel.app/api/telegram/webhook\", \"secret_token\": \"${TELEGRAM_WEBHOOK_SECRET}\"}"
```

Expected: `{"ok":true,"result":true,"description":"Webhook was set"}`

- [ ] **Step 3: 웹훅 상태 확인**

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo" | grep -o '"url":"[^"]*"'
```

Expected: `"url":"https://smartsellerstudio.vercel.app/api/telegram/webhook"`

- [ ] **Step 4: 텔레그램에서 실제 테스트**

텔레그램 봇에 상품명 전송 (예: `자동차 세정 티슈`).
- 30초 이내: `🔍 분석 시작합니다` 응답 확인
- 2~3분 이내: 결과 메시지에 **1688 가격/마진** 포함 여부 확인

- [ ] **Step 5: 에러 로그 확인**

```bash
vercel logs --level error --since 5m --expand 2>&1 | head -30
```

Expected: `No logs found` (에러 없음) 또는 `[china-matcher] 유사도 80% 이상 후보 없음` 수준의 경고만 존재

- [ ] **Step 6: 최종 커밋 불필요** (Task 1, 2에서 이미 완료)
