# 소싱 자동화 에이전트 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 쿠팡 세부 카테고리 판매순위 → 도매꾹/1688 이미지 매칭 → 마진 검증을 자동화해 하루 5개 소싱 후보를 발굴하는 에이전트를 구축한다.

**Architecture:** Playwright(스텔스 크롤링)로 쿠팡 판매순위 상품을 수집하고, 기존 `domeggook-client` + Claude Vision으로 도매꾹 이미지 매칭, 1688 검색 URL 생성 후 마진 30% 필터로 상위 5개를 Render PostgreSQL에 저장한다. Vercel 서버리스 환경에서 `playwright-core` + `@sparticuz/chromium-min`을 사용한다.

**Tech Stack:** Next.js App Router, Playwright-core + @sparticuz/chromium-min, Claude Vision API, Anthropic SDK, node-postgres (pg), React

---

## 파일 맵

| 역할 | 경로 | 상태 |
|---|---|---|
| DB 마이그레이션 | `supabase/migrations/065_sourcing_agent.sql` | 신규 |
| DB 레이어 | `src/lib/sourcing-agent/db.ts` | 신규 |
| 쿠팡 크롤러 | `src/lib/sourcing-agent/coupang-crawler.ts` | 신규 |
| 이미지 유사도 | `src/lib/sourcing-agent/image-similarity.ts` | 신규 |
| 도매꾹 매처 | `src/lib/sourcing-agent/domeggook-matcher.ts` | 신규 |
| 1688 매처 | `src/lib/sourcing-agent/china-matcher.ts` | 신규 |
| 파이프라인 | `src/lib/sourcing-agent/pipeline.ts` | 신규 |
| API: 실행 | `src/app/api/sourcing/agent/run/route.ts` | 신규 |
| API: 결과 조회 | `src/app/api/sourcing/agent/results/route.ts` | 신규 |
| API: 카테고리 | `src/app/api/sourcing/agent/categories/route.ts` | 신규 |
| UI 탭 | `src/components/sourcing/SourcingAgentTab.tsx` | 신규 |
| 대시보드 탭 등록 | `src/components/sourcing/SourcingDashboard.tsx` | 수정 |
| Vercel cron 등록 | `vercel.json` | 수정 |

---

## Task 1: 패키지 설치 + DB 마이그레이션

**Files:**
- Create: `supabase/migrations/065_sourcing_agent.sql`
- Modify: `package.json` (패키지 추가)

- [ ] **Step 1: playwright-core 및 chromium-min 설치**

```bash
cd /Users/seungminlee/projects/smart_seller_studio
npm install playwright-core @sparticuz/chromium-min
```

Expected: `package.json`의 dependencies에 두 패키지가 추가됨

- [ ] **Step 2: 마이그레이션 SQL 파일 작성**

`supabase/migrations/065_sourcing_agent.sql`을 아래 내용으로 생성:

```sql
-- 소싱 에이전트: 카테고리 관리
CREATE TABLE IF NOT EXISTS sourcing_agent_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  coupang_category_url TEXT NOT NULL,
  last_crawled_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true
);

-- 소싱 에이전트: 발굴 결과
CREATE TABLE IF NOT EXISTS sourcing_agent_results (
  id SERIAL PRIMARY KEY,
  crawled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category_id INT REFERENCES sourcing_agent_categories(id),

  coupang_product_id TEXT NOT NULL,
  coupang_product_name TEXT NOT NULL,
  coupang_rank INT,
  coupang_price INT,
  coupang_image_url TEXT,
  coupang_url TEXT NOT NULL,

  domeggook_product_name TEXT,
  domeggook_price INT,
  domeggook_url TEXT,
  domeggook_image_url TEXT,
  domeggook_similarity FLOAT,

  china_product_name TEXT,
  china_price_krw INT,
  china_url TEXT,
  china_image_url TEXT,

  domeggook_margin_rate FLOAT,
  china_margin_rate FLOAT,

  UNIQUE(coupang_product_id, (crawled_at::DATE))
);

CREATE INDEX IF NOT EXISTS idx_agent_results_crawled
  ON sourcing_agent_results(crawled_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_categories_last_crawled
  ON sourcing_agent_categories(last_crawled_at ASC NULLS FIRST);

-- 카테고리 시드 데이터 (세부 카테고리 30개)
INSERT INTO sourcing_agent_categories (name, coupang_category_url) VALUES
  ('욕실 수납함',       'https://www.coupang.com/np/search?q=욕실수납함&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('지퍼백/위생봉투',   'https://www.coupang.com/np/search?q=지퍼백+위생봉투&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('칫솔/치약홀더',     'https://www.coupang.com/np/search?q=칫솔+치약홀더&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('걸레/밀대',         'https://www.coupang.com/np/search?q=걸레+밀대&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('주방 계량도구',     'https://www.coupang.com/np/search?q=주방계량도구&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('케이블 정리함',     'https://www.coupang.com/np/search?q=케이블정리함&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('서랍 정리대',       'https://www.coupang.com/np/search?q=서랍정리대&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('냉장고 정리함',     'https://www.coupang.com/np/search?q=냉장고정리함&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('반려견 장난감',     'https://www.coupang.com/np/search?q=강아지장난감&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('강아지 리드줄',     'https://www.coupang.com/np/search?q=강아지리드줄&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('강아지 의류',       'https://www.coupang.com/np/search?q=강아지옷&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('강아지 배변패드',   'https://www.coupang.com/np/search?q=강아지배변패드&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('고양이 장난감',     'https://www.coupang.com/np/search?q=고양이장난감&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('고양이 스크래처',   'https://www.coupang.com/np/search?q=고양이스크래처&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('고양이 급수기',     'https://www.coupang.com/np/search?q=고양이급수기&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('헤어핀/헤어밴드',  'https://www.coupang.com/np/search?q=헤어핀+헤어밴드&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('네일 스티커',       'https://www.coupang.com/np/search?q=네일스티커&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('화장솜/면봉',       'https://www.coupang.com/np/search?q=화장솜+면봉&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('유아 목욕완구',     'https://www.coupang.com/np/search?q=유아목욕완구&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('이유식 도구',       'https://www.coupang.com/np/search?q=이유식도구&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('치발기',            'https://www.coupang.com/np/search?q=치발기&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('캠핑 식기',         'https://www.coupang.com/np/search?q=캠핑식기&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('캠핑 조명',         'https://www.coupang.com/np/search?q=캠핑조명+랜턴&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('캠핑 수납',         'https://www.coupang.com/np/search?q=캠핑수납+캠핑박스&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('폼롤러',            'https://www.coupang.com/np/search?q=폼롤러&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('요가블록',          'https://www.coupang.com/np/search?q=요가블록&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('미니 밴드',         'https://www.coupang.com/np/search?q=미니밴드+루프밴드&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('볼펜/형광펜 세트',  'https://www.coupang.com/np/search?q=볼펜세트+형광펜&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('포스트잇',          'https://www.coupang.com/np/search?q=포스트잇&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('다이어리/노트',     'https://www.coupang.com/np/search?q=다이어리+노트&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36')
ON CONFLICT DO NOTHING;
```

- [ ] **Step 3: 마이그레이션 적용**

```bash
# SOURCING_DATABASE_URL 환경변수가 설정된 상태에서 실행
node -e "
const pg = require('pg');
const fs = require('fs');
const url = new URL(process.env.SOURCING_DATABASE_URL);
const pool = new pg.Pool({
  host: url.hostname, port: parseInt(url.port||'5432'), database: url.pathname.slice(1),
  user: url.username, password: decodeURIComponent(url.password),
  ssl: { rejectUnauthorized: false }, family: 4,
});
pool.query(fs.readFileSync('supabase/migrations/065_sourcing_agent.sql','utf8'))
  .then(() => { console.log('OK'); pool.end(); })
  .catch(e => { console.error(e); pool.end(); process.exit(1); });
"
```

Expected: `OK` 출력, 에러 없음

- [ ] **Step 4: 테이블 확인**

```bash
node -e "
const pg = require('pg');
const url = new URL(process.env.SOURCING_DATABASE_URL);
const pool = new pg.Pool({ host: url.hostname, port: parseInt(url.port||'5432'), database: url.pathname.slice(1), user: url.username, password: decodeURIComponent(url.password), ssl: { rejectUnauthorized: false }, family: 4 });
pool.query('SELECT COUNT(*) FROM sourcing_agent_categories').then(r => { console.log('카테고리 수:', r.rows[0].count); pool.end(); });
"
```

Expected: `카테고리 수: 30`

- [ ] **Step 5: 커밋**

```bash
git add supabase/migrations/065_sourcing_agent.sql package.json package-lock.json
git commit -m "feat(sourcing-agent): DB 마이그레이션 + playwright-core 설치"
```

---

## Task 2: DB 레이어

**Files:**
- Create: `src/lib/sourcing-agent/db.ts`

- [ ] **Step 1: DB 레이어 파일 작성**

`src/lib/sourcing-agent/db.ts`:

```typescript
import pg from 'pg';
import { getSourcingPool } from '@/lib/sourcing/db';

export interface AgentCategory {
  id: number;
  name: string;
  coupang_category_url: string;
  last_crawled_at: string | null;
  is_active: boolean;
}

export interface AgentResultInsert {
  category_id: number;
  coupang_product_id: string;
  coupang_product_name: string;
  coupang_rank: number;
  coupang_price: number;
  coupang_image_url: string;
  coupang_url: string;
  domeggook_product_name: string | null;
  domeggook_price: number | null;
  domeggook_url: string | null;
  domeggook_image_url: string | null;
  domeggook_similarity: number | null;
  china_product_name: string | null;
  china_price_krw: number | null;
  china_url: string | null;
  china_image_url: string | null;
  domeggook_margin_rate: number | null;
  china_margin_rate: number | null;
}

export interface AgentResult extends AgentResultInsert {
  id: number;
  crawled_at: string;
  category_name: string;
}

/** last_crawled_at 가장 오래된(또는 null) 활성 카테고리 1개 반환 */
export async function getNextCategory(pool: pg.Pool): Promise<AgentCategory | null> {
  const { rows } = await pool.query<AgentCategory>(
    `SELECT * FROM sourcing_agent_categories
     WHERE is_active = true
     ORDER BY last_crawled_at ASC NULLS FIRST
     LIMIT 1`
  );
  return rows[0] ?? null;
}

/** ID로 특정 카테고리 조회 */
export async function getCategoryById(pool: pg.Pool, id: number): Promise<AgentCategory | null> {
  const { rows } = await pool.query<AgentCategory>(
    'SELECT * FROM sourcing_agent_categories WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

/** 모든 활성 카테고리 목록 */
export async function getAllCategories(pool: pg.Pool): Promise<AgentCategory[]> {
  const { rows } = await pool.query<AgentCategory>(
    'SELECT * FROM sourcing_agent_categories WHERE is_active = true ORDER BY name'
  );
  return rows;
}

/** 동일 쿠팡 상품 ID가 최근 30일 내에 저장됐는지 확인 */
export async function isDuplicateProduct(pool: pg.Pool, coupangProductId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM sourcing_agent_results
     WHERE coupang_product_id = $1
       AND crawled_at > NOW() - INTERVAL '30 days'
     LIMIT 1`,
    [coupangProductId]
  );
  return rows.length > 0;
}

/** 결과 5개 일괄 저장 (중복 시 무시) */
export async function saveAgentResults(pool: pg.Pool, results: AgentResultInsert[]): Promise<void> {
  if (results.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of results) {
      await client.query(
        `INSERT INTO sourcing_agent_results (
           category_id, coupang_product_id, coupang_product_name,
           coupang_rank, coupang_price, coupang_image_url, coupang_url,
           domeggook_product_name, domeggook_price, domeggook_url,
           domeggook_image_url, domeggook_similarity,
           china_product_name, china_price_krw, china_url, china_image_url,
           domeggook_margin_rate, china_margin_rate
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
         )
         ON CONFLICT (coupang_product_id, (crawled_at::DATE)) DO NOTHING`,
        [
          r.category_id, r.coupang_product_id, r.coupang_product_name,
          r.coupang_rank, r.coupang_price, r.coupang_image_url, r.coupang_url,
          r.domeggook_product_name, r.domeggook_price, r.domeggook_url,
          r.domeggook_image_url, r.domeggook_similarity,
          r.china_product_name, r.china_price_krw, r.china_url, r.china_image_url,
          r.domeggook_margin_rate, r.china_margin_rate,
        ]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** 카테고리 last_crawled_at 업데이트 */
export async function updateCategoryLastCrawled(pool: pg.Pool, categoryId: number): Promise<void> {
  await pool.query(
    'UPDATE sourcing_agent_categories SET last_crawled_at = NOW() WHERE id = $1',
    [categoryId]
  );
}

/** 결과 목록 조회 (페이지네이션, 카테고리 필터) */
export async function getAgentResults(
  pool: pg.Pool,
  opts: { limit?: number; offset?: number; categoryId?: number } = {}
): Promise<AgentResult[]> {
  const { limit = 50, offset = 0, categoryId } = opts;
  const conditions = categoryId ? ['r.category_id = $3'] : [];
  const params: unknown[] = [limit, offset];
  if (categoryId) params.push(categoryId);

  const where = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query<AgentResult>(
    `SELECT r.*, c.name AS category_name
     FROM sourcing_agent_results r
     JOIN sourcing_agent_categories c ON c.id = r.category_id
     WHERE 1=1 ${where}
     ORDER BY r.crawled_at DESC, r.domeggook_margin_rate DESC NULLS LAST
     LIMIT $1 OFFSET $2`,
    params
  );
  return rows;
}
```

- [ ] **Step 2: TypeScript 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep "sourcing-agent/db"
```

Expected: 출력 없음 (에러 없음)

- [ ] **Step 3: 커밋**

```bash
git add src/lib/sourcing-agent/db.ts
git commit -m "feat(sourcing-agent): DB 레이어 (CRUD 함수)"
```

---

## Task 3: 쿠팡 크롤러

**Files:**
- Create: `src/lib/sourcing-agent/coupang-crawler.ts`

- [ ] **Step 1: 크롤러 작성**

`src/lib/sourcing-agent/coupang-crawler.ts`:

```typescript
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
  return playwrightChromium.launch({
    args: chromiumMin.args,
    executablePath: await chromiumMin.executablePath(
      'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar'
    ),
    headless: chromiumMin.headless,
  });
}

/**
 * 쿠팡 카테고리/검색 URL에서 판매량 상위 N개 상품을 수집한다.
 * Playwright stealth 모드로 anti-bot 감지를 최소화한다.
 */
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

    // webdriver 속성 제거 (자동화 감지 차단)
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await randomDelay();

    // 자연스러운 스크롤 시뮬레이션
    for (const dist of [300, 600, 1000]) {
      await page.evaluate((y: number) => window.scrollBy(0, y), dist);
      await sleep(500 + Math.random() * 300);
    }

    const products = await page.evaluate((maxItems: number) => {
      // 쿠팡 검색 결과 상품 선택자 (광고 제외)
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

        const rawSrc = imgEl?.src ?? imgEl?.getAttribute('data-src') ?? '';
        // 쿠팡 썸네일은 q70 파라미터 → 더 높은 품질로 교체
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

    return products.filter((p) => p.name && p.productId && p.imageUrl);
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 2: TypeScript 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep "sourcing-agent/coupang-crawler"
```

Expected: 출력 없음

- [ ] **Step 3: 커밋**

```bash
git add src/lib/sourcing-agent/coupang-crawler.ts
git commit -m "feat(sourcing-agent): 쿠팡 카테고리 크롤러 (Playwright stealth)"
```

---

## Task 4: 이미지 유사도 비교

**Files:**
- Create: `src/lib/sourcing-agent/image-similarity.ts`

- [ ] **Step 1: 이미지 유사도 모듈 작성**

`src/lib/sourcing-agent/image-similarity.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { fetchImagesFromUrls, resizeForClaude } from '@/lib/ai/claude-vision';

export interface SimilarityResult {
  similarity: number;     // 0–100
  isSameProduct: boolean; // similarity >= 80
}

const client = new Anthropic();

/**
 * 두 이미지 URL을 Claude Vision으로 비교해 유사도(0–100)를 반환한다.
 * 네트워크/API 실패 시 { similarity: 0, isSameProduct: false } 반환.
 */
export async function compareImages(
  imageUrl1: string,
  imageUrl2: string
): Promise<SimilarityResult> {
  try {
    const [img1, img2] = await fetchImagesFromUrls([imageUrl1, imageUrl2]);
    const r1 = await resizeForClaude(img1.imageBase64, img1.mimeType);
    const r2 = await resizeForClaude(img2.imageBase64, img2.mimeType);

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 80,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: r1.mimeType, data: r1.imageBase64 },
            },
            {
              type: 'image',
              source: { type: 'base64', media_type: r2.mimeType, data: r2.imageBase64 },
            },
            {
              type: 'text',
              text: '두 상품 이미지가 동일한 상품인지 판단하세요. JSON만 반환 (다른 텍스트 금지): {"similarity": 0에서100사이정수, "is_same_product": true또는false}',
            },
          ],
        },
      ],
    });

    const text = (response.content[0] as { type: 'text'; text: string }).text;
    const match = text.match(/\{[^}]+\}/);
    if (!match) return { similarity: 0, isSameProduct: false };

    const parsed = JSON.parse(match[0]) as { similarity: number; is_same_product: boolean };
    return {
      similarity: parsed.similarity ?? 0,
      isSameProduct: parsed.is_same_product ?? false,
    };
  } catch {
    return { similarity: 0, isSameProduct: false };
  }
}
```

- [ ] **Step 2: TypeScript 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep "image-similarity"
```

Expected: 출력 없음

- [ ] **Step 3: 커밋**

```bash
git add src/lib/sourcing-agent/image-similarity.ts
git commit -m "feat(sourcing-agent): Claude Vision 이미지 유사도 비교"
```

---

## Task 5: 도매꾹 매처

**Files:**
- Create: `src/lib/sourcing-agent/domeggook-matcher.ts`

- [ ] **Step 1: 도매꾹 매처 작성**

`src/lib/sourcing-agent/domeggook-matcher.ts`:

```typescript
import { extractKeywordsFromProduct } from '@/lib/sourcing/ai-keyword-extract';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { compareImages } from './image-similarity';
import type { DomeggookListItem } from '@/types/sourcing';

export interface DomeggookMatch {
  productName: string;
  price: number;
  url: string;
  imageUrl: string;
  similarity: number;
}

/**
 * 쿠팡 상품명 + 이미지 URL → 도매꾹에서 동일 상품 매칭.
 * 1. Gemini로 핵심 키워드 추출
 * 2. 도매꾹 getItemList로 후보 10개 조회
 * 3. Claude Vision으로 이미지 유사도 비교 → 80% 이상만 반환
 * 매칭 실패 시 null 반환.
 */
export async function matchOnDomeggook(
  coupangName: string,
  coupangImageUrl: string
): Promise<DomeggookMatch | null> {
  // 1. 키워드 추출
  const keywords = await extractKeywordsFromProduct(coupangName);
  if (!keywords || keywords.length === 0) return null;

  const client = getDomeggookClient();
  const candidates: DomeggookListItem[] = [];

  // 2. 상위 2개 키워드로 검색 (최대 10개/키워드)
  for (const kw of keywords.slice(0, 2)) {
    try {
      const res = await client.getItemList({ keyword: kw, pageSize: 10, sort: 'rd' });
      candidates.push(...res.list.filter((i) => i.unitQty <= 3));
    } catch {
      // 키워드 검색 실패 시 다음 키워드 시도
    }
    if (candidates.length >= 10) break;
  }

  if (candidates.length === 0) return null;

  // 3. 이미지 유사도 비교 (최대 10개, 순차 처리)
  let bestMatch: (DomeggookMatch & { similarity: number }) | null = null;

  for (const item of candidates.slice(0, 10)) {
    if (!item.thumb) continue;

    const { similarity, isSameProduct } = await compareImages(coupangImageUrl, item.thumb);
    if (!isSameProduct) continue;
    if (!bestMatch || similarity > bestMatch.similarity) {
      bestMatch = {
        productName: item.title,
        price: item.price,
        url: item.url || `https://www.domeggook.com/main/product/productdetail/?pno=${item.no}`,
        imageUrl: item.thumb,
        similarity,
      };
    }
  }

  return bestMatch;
}
```

- [ ] **Step 2: TypeScript 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep "domeggook-matcher"
```

Expected: 출력 없음

- [ ] **Step 3: 커밋**

```bash
git add src/lib/sourcing-agent/domeggook-matcher.ts
git commit -m "feat(sourcing-agent): 도매꾹 이미지 매칭 (키워드 추출 + Vision 비교)"
```

---

## Task 6: 1688 매처

**Files:**
- Create: `src/lib/sourcing-agent/china-matcher.ts`

- [ ] **Step 1: 1688 매처 작성**

`src/lib/sourcing-agent/china-matcher.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import chromiumMin from '@sparticuz/chromium-min';
import { chromium as playwrightChromium } from 'playwright-core';
import { compareImages } from './image-similarity';
import { calc1688Margin, DEFAULT_EXCHANGE_RATE_KRW_PER_RMB, DEFAULT_TARIFF_RATE } from '@/lib/sourcing/margin-1688';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const anthropic = new Anthropic();

export interface ChinaMatch {
  productName: string;
  priceRmb: number;
  priceKrw: number;     // 관세/배송비 포함 원화 환산
  url: string;
  imageUrl: string;
  marginRate: number;
}

/** 한국어 키워드를 1688 검색용 중국어로 변환 */
async function translateToChineseKeyword(koreanKeyword: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 30,
    messages: [{
      role: 'user',
      content: `한국어 상품명을 1688에서 검색할 중국어 키워드 1개로만 번역. 중국어만 출력, 다른 텍스트 금지: "${koreanKeyword}"`,
    }],
  });
  return (response.content[0] as { text: string }).text.trim();
}

async function getBrowser() {
  if (process.env.NODE_ENV !== 'production') {
    return playwrightChromium.launch({ headless: true, args: ['--no-sandbox'] });
  }
  return playwrightChromium.launch({
    args: chromiumMin.args,
    executablePath: await chromiumMin.executablePath(
      'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar'
    ),
    headless: chromiumMin.headless,
  });
}

/**
 * 한국어 상품명 + 쿠팡 이미지 URL → 1688에서 동일 상품 매칭.
 * 1. Claude Haiku로 중국어 키워드 번역
 * 2. 1688 검색 결과 상위 5개 스크래핑
 * 3. Claude Vision 이미지 유사도 비교 → 80% 이상만 반환
 * 매칭 실패 시 null 반환.
 */
export async function matchOn1688(
  coupangName: string,
  coupangImageUrl: string,
  coupangPriceKrw: number
): Promise<ChinaMatch | null> {
  const chineseKeyword = await translateToChineseKeyword(coupangName);

  const searchUrl =
    `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(chineseKeyword)}&sortType=totalSales`;

  const browser = await getBrowser();
  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'zh-CN',
    });
    const page = await context.newPage();
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await sleep(2000);

    const candidates = await page.evaluate(() => {
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

      return items.slice(0, 5).map((item) => {
        const anchor = item.querySelector('a') as HTMLAnchorElement | null;
        const img = item.querySelector('img') as HTMLImageElement | null;
        const priceEl = item.querySelector('[class*="price"], [class*="Price"]') as HTMLElement | null;
        const nameEl = item.querySelector('[class*="title"], [class*="subject"], [class*="name"]') as HTMLElement | null;

        const rawPrice = priceEl?.textContent?.replace(/[^0-9.]/g, '') ?? '0';
        return {
          name: nameEl?.textContent?.trim() ?? '',
          url: anchor?.href ?? '',
          imageUrl: img?.src ?? img?.getAttribute('data-src') ?? '',
          priceRmb: parseFloat(rawPrice) || 0,
        };
      }).filter((c) => c.url && c.imageUrl && c.priceRmb > 0);
    });

    let bestMatch: ChinaMatch | null = null;

    for (const c of candidates) {
      const { similarity, isSameProduct } = await compareImages(coupangImageUrl, c.imageUrl);
      if (!isSameProduct) continue;

      // 마진 계산: 관세 8% + 수입VAT 10% + 배송비 800원/개 가정
      const marginResult = calc1688Margin({
        buyPriceRmb: c.priceRmb,
        exchangeRate: DEFAULT_EXCHANGE_RATE_KRW_PER_RMB,
        tariffRate: DEFAULT_TARIFF_RATE,
        shippingPerUnitKrw: 800,
        packQty: 1,
        channel: 'coupang_rocket',
        categoryName: null,
        sellPrice: coupangPriceKrw,
        groceryRunningCost: 0,
      });

      const marginRate = marginResult.marginRate ?? 0;

      if (!bestMatch || similarity > (bestMatch as ChinaMatch & { _sim: number })._sim) {
        (bestMatch as ChinaMatch & { _sim?: number }) = {
          productName: c.name,
          priceRmb: c.priceRmb,
          priceKrw: marginResult.totalCostKrw,
          url: c.url,
          imageUrl: c.imageUrl,
          marginRate,
          _sim: similarity,
        } as ChinaMatch & { _sim: number };
      }
    }

    // _sim 필드 제거
    if (bestMatch) {
      const { _sim, ...clean } = bestMatch as ChinaMatch & { _sim?: number };
      void _sim;
      return clean;
    }
    return null;
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 2: TypeScript 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep "china-matcher"
```

Expected: 출력 없음

- [ ] **Step 3: 커밋**

```bash
git add src/lib/sourcing-agent/china-matcher.ts
git commit -m "feat(sourcing-agent): 1688 이미지 매칭 (번역 + Vision 비교 + 마진 계산)"
```

---

## Task 7: 파이프라인 오케스트레이터

**Files:**
- Create: `src/lib/sourcing-agent/pipeline.ts`

- [ ] **Step 1: 파이프라인 작성**

`src/lib/sourcing-agent/pipeline.ts`:

```typescript
import { getSourcingPool } from '@/lib/sourcing/db';
import {
  getNextCategory,
  getCategoryById,
  isDuplicateProduct,
  saveAgentResults,
  updateCategoryLastCrawled,
  type AgentResultInsert,
} from './db';
import { crawlCoupangCategory } from './coupang-crawler';
import { matchOnDomeggook } from './domeggook-matcher';
import { matchOn1688 } from './china-matcher';
import { calcMarginRate } from '@/lib/sourcing/domeggook-pricing';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface PipelineOptions {
  categoryId?: number; // 미지정 시 자동 순환
}

export interface PipelineResult {
  categoryName: string;
  crawledCount: number;
  savedCount: number;
}

/**
 * 소싱 에이전트 메인 파이프라인.
 * 쿠팡 카테고리 크롤 → 도매꾹/1688 매칭 → 마진 필터 → 상위 5개 저장.
 */
export async function runSourcingAgentPipeline(
  opts: PipelineOptions = {}
): Promise<PipelineResult> {
  const pool = getSourcingPool();

  // 1. 카테고리 선택
  const category = opts.categoryId
    ? await getCategoryById(pool, opts.categoryId)
    : await getNextCategory(pool);

  if (!category) throw new Error('활성 카테고리가 없습니다.');

  // 2. 쿠팡 상위 20개 수집
  const products = await crawlCoupangCategory(category.coupang_category_url, 20);

  const candidates: AgentResultInsert[] = [];

  // 3. 각 상품 매칭 + 마진 계산 (순차 처리, Vision API 부하 분산)
  for (const product of products) {
    // 30일 내 중복 건너뜀
    if (await isDuplicateProduct(pool, product.productId)) continue;

    try {
      // 도매꾹 매칭
      const dgMatch = await matchOnDomeggook(product.name, product.imageUrl);
      if (!dgMatch) continue; // 도매꾹 매칭 필수

      // 도매꾹 마진 계산
      const dgMarginRate = calcMarginRate({
        sellPrice: product.price,
        costPrice: dgMatch.price,
        moq: 1,
        shippingFee: 0,
        categoryName: null,
        channel: 'coupang_rocket',
      });

      if (!dgMarginRate || dgMarginRate < 0.30) continue; // 30% 미만 제외

      // 1688 병렬 매칭 (실패해도 진행)
      const chinaMatch = await matchOn1688(product.name, product.imageUrl, product.price).catch(() => null);

      candidates.push({
        category_id: category.id,
        coupang_product_id: product.productId,
        coupang_product_name: product.name,
        coupang_rank: product.rank,
        coupang_price: product.price,
        coupang_image_url: product.imageUrl,
        coupang_url: product.productUrl,
        domeggook_product_name: dgMatch.productName,
        domeggook_price: dgMatch.price,
        domeggook_url: dgMatch.url,
        domeggook_image_url: dgMatch.imageUrl,
        domeggook_similarity: dgMatch.similarity,
        china_product_name: chinaMatch?.productName ?? null,
        china_price_krw: chinaMatch?.priceKrw ?? null,
        china_url: chinaMatch?.url ?? null,
        china_image_url: chinaMatch?.imageUrl ?? null,
        domeggook_margin_rate: dgMarginRate,
        china_margin_rate: chinaMatch?.marginRate ?? null,
      });
    } catch {
      // 개별 상품 실패는 건너뜀
    }

    await sleep(1500); // Vision API 호출 간격
  }

  // 4. 마진율 내림차순 상위 5개 저장
  const top5 = candidates
    .sort((a, b) => (b.domeggook_margin_rate ?? 0) - (a.domeggook_margin_rate ?? 0))
    .slice(0, 5);

  await saveAgentResults(pool, top5);
  await updateCategoryLastCrawled(pool, category.id);

  return {
    categoryName: category.name,
    crawledCount: products.length,
    savedCount: top5.length,
  };
}
```

- [ ] **Step 2: `calcMarginRate` 시그니처 확인 후 맞게 조정**

```bash
grep -n "export function calcMarginRate" /Users/seungminlee/projects/smart_seller_studio/src/lib/sourcing/domeggook-pricing.ts
```

실제 시그니처에 따라 `pipeline.ts`의 `calcMarginRate` 호출부를 수정한다. 만약 `calcMarginRate`가 다른 인터페이스를 사용한다면, 아래 인라인 계산으로 대체:

```typescript
// calcMarginRate 대체 인라인 계산
const COUPANG_FEE_RATE = 0.10; // 로켓그로스 수수료
const VAT = 0.10;
const dgMarginRate = (product.price - dgMatch.price * (1 + COUPANG_FEE_RATE + VAT)) / product.price;
```

- [ ] **Step 3: TypeScript 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep "sourcing-agent/pipeline"
```

Expected: 출력 없음

- [ ] **Step 4: 커밋**

```bash
git add src/lib/sourcing-agent/pipeline.ts
git commit -m "feat(sourcing-agent): 파이프라인 오케스트레이터"
```

---

## Task 8: API 라우트 3개

**Files:**
- Create: `src/app/api/sourcing/agent/run/route.ts`
- Create: `src/app/api/sourcing/agent/results/route.ts`
- Create: `src/app/api/sourcing/agent/categories/route.ts`
- Modify: `vercel.json` (cron 추가)

- [ ] **Step 1: POST /api/sourcing/agent/run**

`src/app/api/sourcing/agent/run/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { runSourcingAgentPipeline } from '@/lib/sourcing-agent/pipeline';

export const maxDuration = 300; // Vercel Fluid Compute: 최대 300초

export async function POST(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET && process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const categoryId = typeof body.categoryId === 'number' ? body.categoryId : undefined;

    const result = await runSourcingAgentPipeline({ categoryId });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: GET /api/sourcing/agent/results**

`src/app/api/sourcing/agent/results/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getAgentResults } from '@/lib/sourcing-agent/db';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 100);
  const offset = parseInt(searchParams.get('offset') ?? '0');
  const categoryId = searchParams.get('categoryId')
    ? parseInt(searchParams.get('categoryId')!)
    : undefined;

  const pool = getSourcingPool();
  const results = await getAgentResults(pool, { limit, offset, categoryId });
  return NextResponse.json({ results });
}
```

- [ ] **Step 3: GET /api/sourcing/agent/categories**

`src/app/api/sourcing/agent/categories/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getAllCategories } from '@/lib/sourcing-agent/db';

export async function GET() {
  const pool = getSourcingPool();
  const categories = await getAllCategories(pool);
  return NextResponse.json({ categories });
}
```

- [ ] **Step 4: vercel.json에 cron 추가**

`vercel.json`의 `crons` 배열에 추가:

```json
{
  "path": "/api/sourcing/agent/run",
  "schedule": "0 21 * * *"
}
```

(한국 오전 6시 = UTC 21시 전날)

- [ ] **Step 5: TypeScript 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep "api/sourcing/agent"
```

Expected: 출력 없음

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/sourcing/agent/ vercel.json
git commit -m "feat(sourcing-agent): API 라우트 3개 + Vercel cron 등록"
```

---

## Task 9: UI — 소싱 에이전트 탭

**Files:**
- Create: `src/components/sourcing/SourcingAgentTab.tsx`
- Modify: `src/components/sourcing/SourcingDashboard.tsx`

- [ ] **Step 1: SourcingAgentTab 컴포넌트 작성**

`src/components/sourcing/SourcingAgentTab.tsx`:

```typescript
'use client';

import { useEffect, useState, useCallback } from 'react';
import type { AgentResult, AgentCategory } from '@/lib/sourcing-agent/db';

const C = {
  bg: '#0f1117',
  surface: '#1a1d26',
  border: '#2a2d3a',
  accent: '#6366f1',
  text: '#e2e8f0',
  textSub: '#94a3b8',
  success: '#10b981',
  warn: '#f59e0b',
};

function MarginBadge({ rate }: { rate: number | null }) {
  if (rate === null) return <span style={{ color: C.textSub }}>-</span>;
  const pct = Math.round(rate * 100);
  const color = pct >= 40 ? C.success : pct >= 30 ? C.warn : '#ef4444';
  return <span style={{ color, fontWeight: 700 }}>{pct}%</span>;
}

function SourceLinks({
  coupangUrl, domeggookUrl, chinaUrl,
}: { coupangUrl: string; domeggookUrl: string | null; chinaUrl: string | null }) {
  const link = (label: string, url: string | null) =>
    url ? (
      <a
        key={label}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: C.accent, fontSize: '12px', textDecoration: 'none',
          padding: '2px 6px', borderRadius: '4px', background: '#1e2035',
        }}
      >
        {label} ↗
      </a>
    ) : null;

  return (
    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
      {link('쿠팡', coupangUrl)}
      {link('도매꾹', domeggookUrl)}
      {link('1688', chinaUrl)}
    </div>
  );
}

function DetailSlideOver({ result, onClose }: { result: AgentResult; onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50, display: 'flex',
        justifyContent: 'flex-end', background: 'rgba(0,0,0,0.5)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '480px', background: C.surface, height: '100%',
          overflowY: 'auto', padding: '24px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ color: C.text, margin: 0, fontSize: '15px' }}>{result.coupang_product_name}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textSub, cursor: 'pointer', fontSize: '18px' }}>✕</button>
        </div>

        {/* 이미지 3단 비교 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '16px' }}>
          {[
            { label: '쿠팡', url: result.coupang_image_url },
            { label: '도매꾹', url: result.domeggook_image_url },
            { label: '1688', url: result.china_image_url },
          ].map(({ label, url }) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: C.textSub, marginBottom: '4px' }}>{label}</div>
              {url ? (
                <img src={url} alt={label} style={{ width: '100%', borderRadius: '6px', objectFit: 'contain', background: '#fff', height: '120px' }} />
              ) : (
                <div style={{ height: '120px', background: C.border, borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.textSub, fontSize: '12px' }}>없음</div>
              )}
            </div>
          ))}
        </div>

        {/* 유사도 */}
        {result.domeggook_similarity !== null && (
          <div style={{ marginBottom: '12px', fontSize: '13px', color: C.textSub }}>
            도매꾹 유사도: <span style={{ color: C.success, fontWeight: 700 }}>{Math.round(result.domeggook_similarity)}%</span>
          </div>
        )}

        {/* 가격/마진 정보 */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: '16px' }}>
          <tbody>
            {[
              ['쿠팡 판매가', `${result.coupang_price?.toLocaleString()}원`],
              ['도매꾹 공급가', result.domeggook_price ? `${result.domeggook_price.toLocaleString()}원` : '-'],
              ['도매꾹 마진율', <MarginBadge key="dg" rate={result.domeggook_margin_rate} />],
              ['1688 원가(관세포함)', result.china_price_krw ? `${result.china_price_krw.toLocaleString()}원` : '-'],
              ['1688 마진율', <MarginBadge key="cn" rate={result.china_margin_rate} />],
            ].map(([k, v]) => (
              <tr key={String(k)} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: '8px 4px', color: C.textSub }}>{k}</td>
                <td style={{ padding: '8px 4px', color: C.text, textAlign: 'right' }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* 출처 링크 */}
        <SourceLinks
          coupangUrl={result.coupang_url}
          domeggookUrl={result.domeggook_url}
          chinaUrl={result.china_url}
        />
      </div>
    </div>
  );
}

export default function SourcingAgentTab() {
  const [results, setResults] = useState<AgentResult[]>([]);
  const [categories, setCategories] = useState<AgentCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | ''>('');
  const [selectedResult, setSelectedResult] = useState<AgentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runStatus, setRunStatus] = useState<string | null>(null);

  const fetchResults = useCallback(async () => {
    setLoading(true);
    const params = selectedCategoryId ? `?categoryId=${selectedCategoryId}` : '';
    const res = await fetch(`/api/sourcing/agent/results${params}`);
    const data = await res.json();
    setResults(data.results ?? []);
    setLoading(false);
  }, [selectedCategoryId]);

  useEffect(() => {
    fetch('/api/sourcing/agent/categories')
      .then((r) => r.json())
      .then((d) => setCategories(d.categories ?? []));
    fetchResults();
  }, [fetchResults]);

  const handleRun = async () => {
    setRunning(true);
    setRunStatus('실행 중...');
    try {
      const body = selectedCategoryId ? { categoryId: selectedCategoryId } : {};
      const res = await fetch('/api/sourcing/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setRunStatus(`완료: ${data.categoryName} — ${data.savedCount}개 저장`);
        await fetchResults();
      } else {
        setRunStatus(`오류: ${data.error}`);
      }
    } catch {
      setRunStatus('실행 실패');
    }
    setRunning(false);
  };

  return (
    <div style={{ padding: '16px', color: C.text }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '16px' }}>소싱 에이전트</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select
            value={selectedCategoryId}
            onChange={(e) => setSelectedCategoryId(e.target.value ? parseInt(e.target.value) : '')}
            style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, borderRadius: '6px', padding: '6px 10px', fontSize: '13px' }}
          >
            <option value="">전체 카테고리</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            onClick={handleRun}
            disabled={running}
            style={{
              background: running ? C.border : C.accent, color: '#fff',
              border: 'none', borderRadius: '6px', padding: '6px 14px',
              cursor: running ? 'not-allowed' : 'pointer', fontSize: '13px',
            }}
          >
            {running ? '실행 중...' : '지금 소싱'}
          </button>
        </div>
      </div>

      {runStatus && (
        <div style={{ marginBottom: '12px', fontSize: '13px', color: C.textSub }}>{runStatus}</div>
      )}

      {/* 결과 테이블 */}
      {loading ? (
        <div style={{ color: C.textSub, fontSize: '13px' }}>로딩 중...</div>
      ) : results.length === 0 ? (
        <div style={{ color: C.textSub, fontSize: '13px' }}>
          소싱 결과가 없습니다. '지금 소싱' 버튼을 눌러 시작하세요.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}`, color: C.textSub }}>
                {['상품명', '카테고리', '쿠팡순위', '도매꾹가', '1688가', '마진율', '발굴일', '출처'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 6px', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr
                  key={r.id}
                  style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}
                  onClick={() => setSelectedResult(r)}
                >
                  <td style={{ padding: '8px 6px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.coupang_product_name}
                  </td>
                  <td style={{ padding: '8px 6px', color: C.textSub }}>{r.category_name}</td>
                  <td style={{ padding: '8px 6px' }}>{r.coupang_rank}위</td>
                  <td style={{ padding: '8px 6px' }}>
                    {r.domeggook_price ? `${r.domeggook_price.toLocaleString()}원` : '-'}
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    {r.china_price_krw ? `${r.china_price_krw.toLocaleString()}원` : '-'}
                  </td>
                  <td style={{ padding: '8px 6px' }}>
                    <MarginBadge rate={r.domeggook_margin_rate} />
                  </td>
                  <td style={{ padding: '8px 6px', color: C.textSub }}>
                    {new Date(r.crawled_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                  </td>
                  <td style={{ padding: '8px 6px' }} onClick={(e) => e.stopPropagation()}>
                    <SourceLinks coupangUrl={r.coupang_url} domeggookUrl={r.domeggook_url} chinaUrl={r.china_url} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedResult && (
        <DetailSlideOver result={selectedResult} onClose={() => setSelectedResult(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: SourcingDashboard.tsx에 탭 추가**

`src/components/sourcing/SourcingDashboard.tsx`를 열어 다음을 수정한다:

1. 파일 상단 import 추가:
```typescript
import SourcingAgentTab from '@/components/sourcing/SourcingAgentTab';
```

2. `sourcingSubTab` 타입에 `'agent'` 추가:
```typescript
// 기존:
const [sourcingSubTab, setSourcingSubTab] = useState<'tracking' | 'calculator' | 'niche' | 'costco' | 'costco-memo' | 'keywords' | 'seed'>('niche');
// 변경:
const [sourcingSubTab, setSourcingSubTab] = useState<'tracking' | 'calculator' | 'niche' | 'costco' | 'costco-memo' | 'keywords' | 'seed' | 'agent'>('niche');
```

3. 탭 목록 배열에 항목 추가 (기존 `{ id: 'seed' as const, ... }` 뒤에):
```typescript
{ id: 'agent' as const, label: '🤖 소싱 에이전트', icon: null },
```

4. 렌더 블록에 추가 (기존 `{sourcingSubTab === 'tracking' && ...}` 줄 뒤에):
```typescript
{sourcingSubTab === 'agent' && <SourcingAgentTab />}
```

- [ ] **Step 3: TypeScript 타입 체크**

```bash
npx tsc --noEmit 2>&1 | grep -E "SourcingAgent|SourcingDashboard"
```

Expected: 출력 없음

- [ ] **Step 4: 커밋**

```bash
git add src/components/sourcing/SourcingAgentTab.tsx src/components/sourcing/SourcingDashboard.tsx
git commit -m "feat(sourcing-agent): UI 탭 (테이블 + 슬라이드오버 + 수동 트리거)"
```

---

## Task 10: 통합 검증

- [ ] **Step 1: 전체 빌드 확인**

```bash
npm run build 2>&1 | tail -20
```

Expected: 에러 없이 빌드 완료

- [ ] **Step 2: 개발 서버 실행**

```bash
npm run dev
```

브라우저에서 `http://localhost:3000/sourcing` 접속 → '🤖 소싱 에이전트' 탭 확인

- [ ] **Step 3: 수동 파이프라인 실행 (개발 환경)**

```bash
curl -X POST http://localhost:3000/api/sourcing/agent/run \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

Expected:
```json
{
  "ok": true,
  "categoryName": "욕실 수납함",
  "crawledCount": 18,
  "savedCount": 3
}
```

- [ ] **Step 4: 결과 조회 확인**

```bash
curl http://localhost:3000/api/sourcing/agent/results | jq '.results | length'
```

Expected: 1 이상의 숫자

- [ ] **Step 5: UI에서 결과 확인**
- 테이블에 발굴된 상품 표시 확인
- 행 클릭 시 슬라이드오버 열림 확인
- 쿠팡/도매꾹/1688 URL 링크 동작 확인
- 마진율 30% 미만 상품이 없는지 확인

- [ ] **Step 6: 최종 커밋**

```bash
git add -A
git commit -m "feat(sourcing-agent): 소싱 자동화 에이전트 완성"
```

---

## 주의사항

- **`calcMarginRate` 시그니처**: Task 7 Step 2에서 실제 시그니처를 확인하고 인라인 계산으로 대체 가능
- **Coupang 셀렉터**: 쿠팡 HTML 구조는 변경될 수 있음. 크롤러 실패 시 Task 3 Step 1의 셀렉터를 실제 HTML에 맞게 조정
- **1688 접근성**: 1688은 지역/환경에 따라 접근이 제한될 수 있음. `chinaMatch`는 항상 optional이므로 null이어도 파이프라인은 동작함
- **Vercel maxDuration**: 전체 파이프라인이 300초를 초과하면 timeout 발생. 쿠팡 20개 × (Vision 2회 + 1688 크롤) ≈ 200~250초로 예상
