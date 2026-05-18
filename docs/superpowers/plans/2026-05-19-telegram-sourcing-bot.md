# 텔레그램 소싱 봇 + 소싱에이전트 탭 리뉴얼 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 텔레그램 봇으로 상품명을 받아 네이버쇼핑 + Domeggook + 1688 소싱 분석을 실행하고, 소싱에이전트 탭에서 결과 이력을 관리한다.

**Architecture:** Telegram webhook → `after()` 백그라운드 실행 → 네이버쇼핑(소비자가) + Domeggook 키워드 검색(도매가) + 1688 Playwright 크롤링(소싱가) → DB 저장 + Telegram 결과 전송. 소싱에이전트 탭은 이력 뷰어로 전면 교체. 쿠팡 크롤링 코드 전체 삭제.

**Tech Stack:** Next.js 16 App Router (`after` from `next/server`), PostgreSQL (`pg`), Telegram Bot API, Naver Shopping Open API, Domeggook API, Playwright + @sparticuz/chromium-min (1688 크롤링용 유지)

**스펙 보정:** `src/lib/sourcing-agent/china-matcher.ts`와 `src/lib/sourcing-agent/image-similarity.ts`는 1688 매칭에 계속 사용되므로 삭제하지 않는다. Domeggook 썸네일을 reference 이미지로 활용한다.

---

## 파일 구조

| 경로 | 액션 | 역할 |
|------|------|------|
| `src/lib/sourcing-agent/keyword-db.ts` | 신규 | 신규 테이블 CRUD |
| `src/lib/telegram/client.ts` | 신규 | Telegram Bot API sendMessage |
| `src/lib/sourcing-agent/keyword-pipeline.ts` | 신규 | 키워드 소싱 파이프라인 |
| `src/app/api/telegram/webhook/route.ts` | 신규 | Telegram webhook 수신 |
| `src/app/api/sourcing/agent/results/route.ts` | 수정 | 신규 테이블 조회로 교체 |
| `src/components/sourcing/SourcingAgentTab.tsx` | 수정 | 전면 교체 (이력 뷰어) |
| `src/lib/sourcing-agent/coupang-crawler.ts` | 삭제 | 쿠팡 크롤링 제거 |
| `src/lib/sourcing-agent/pipeline.ts` | 삭제 | 카테고리 기반 파이프라인 |
| `src/lib/sourcing-agent/domeggook-matcher.ts` | 삭제 | 이미지 기반 매칭 → 키워드 직접 검색 |
| `src/app/api/sourcing/agent/run/route.ts` | 삭제 | webhook으로 대체 |
| `src/app/api/sourcing/agent/categories/route.ts` | 삭제 | 카테고리 개념 제거 |

---

## Task 1: DB 마이그레이션

**Files:**
- Create: `src/lib/sourcing-agent/keyword-db.ts`

- [ ] **Step 1: DB에 신규 테이블 생성**

아래 SQL을 프로젝트의 DB 클라이언트로 실행한다 (psql, Supabase SQL editor, 또는 `node -e` 등).

```sql
-- 소싱 요청 이력
CREATE TABLE keyword_sourcing_requests (
  id            SERIAL PRIMARY KEY,
  keyword       TEXT NOT NULL,
  chat_id       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

-- 요청 당 최대 5개 결과 (마진 내림차순)
CREATE TABLE keyword_sourcing_results (
  id                     SERIAL PRIMARY KEY,
  request_id             INTEGER NOT NULL REFERENCES keyword_sourcing_requests(id) ON DELETE CASCADE,
  rank                   INTEGER NOT NULL,
  naver_price            INTEGER,
  naver_url              TEXT,
  domeggook_product_name TEXT,
  domeggook_price        INTEGER,
  domeggook_url          TEXT,
  domeggook_image_url    TEXT,
  domeggook_margin_rate  NUMERIC,
  china_product_name     TEXT,
  china_price_krw        INTEGER,
  china_url              TEXT,
  china_margin_rate      NUMERIC,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON keyword_sourcing_requests(requested_at DESC);
CREATE INDEX ON keyword_sourcing_results(request_id);
```

- [ ] **Step 2: keyword-db.ts 작성**

```typescript
import pg from 'pg';

export interface KeywordRequest {
  id: number;
  keyword: string;
  chat_id: string | null;
  status: 'pending' | 'done' | 'error';
  error_message: string | null;
  requested_at: string;
  completed_at: string | null;
}

export interface KeywordResult {
  id: number;
  request_id: number;
  rank: number;
  naver_price: number | null;
  naver_url: string | null;
  domeggook_product_name: string | null;
  domeggook_price: number | null;
  domeggook_url: string | null;
  domeggook_image_url: string | null;
  domeggook_margin_rate: number | null;
  china_product_name: string | null;
  china_price_krw: number | null;
  china_url: string | null;
  china_margin_rate: number | null;
  created_at: string;
}

export interface KeywordResultInsert {
  rank: number;
  naver_price: number | null;
  naver_url: string | null;
  domeggook_product_name: string | null;
  domeggook_price: number | null;
  domeggook_url: string | null;
  domeggook_image_url: string | null;
  domeggook_margin_rate: number | null;
  china_product_name: string | null;
  china_price_krw: number | null;
  china_url: string | null;
  china_margin_rate: number | null;
}

/** 요청 생성 → id 반환 */
export async function createRequest(
  pool: pg.Pool,
  keyword: string,
  chatId: string | null,
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO keyword_sourcing_requests (keyword, chat_id, status)
     VALUES ($1, $2, 'pending') RETURNING id`,
    [keyword, chatId],
  );
  return rows[0].id;
}

/** 요청 완료 처리 */
export async function completeRequest(pool: pg.Pool, requestId: number): Promise<void> {
  await pool.query(
    `UPDATE keyword_sourcing_requests
     SET status = 'done', completed_at = NOW()
     WHERE id = $1`,
    [requestId],
  );
}

/** 요청 오류 처리 */
export async function failRequest(
  pool: pg.Pool,
  requestId: number,
  errorMessage: string,
): Promise<void> {
  await pool.query(
    `UPDATE keyword_sourcing_requests
     SET status = 'error', error_message = $2, completed_at = NOW()
     WHERE id = $1`,
    [requestId, errorMessage],
  );
}

/** 결과 일괄 저장 */
export async function saveKeywordResults(
  pool: pg.Pool,
  requestId: number,
  results: KeywordResultInsert[],
): Promise<void> {
  if (results.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of results) {
      await client.query(
        `INSERT INTO keyword_sourcing_results (
           request_id, rank,
           naver_price, naver_url,
           domeggook_product_name, domeggook_price, domeggook_url,
           domeggook_image_url, domeggook_margin_rate,
           china_product_name, china_price_krw, china_url, china_margin_rate
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          requestId, r.rank,
          r.naver_price, r.naver_url,
          r.domeggook_product_name, r.domeggook_price, r.domeggook_url,
          r.domeggook_image_url, r.domeggook_margin_rate,
          r.china_product_name, r.china_price_krw, r.china_url, r.china_margin_rate,
        ],
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

/** 요청 목록 조회 (결과 포함, 최신순) */
export async function getRequests(
  pool: pg.Pool,
  opts: { limit?: number; offset?: number; keyword?: string } = {},
): Promise<(KeywordRequest & { results: KeywordResult[] })[]> {
  const { limit = 50, offset = 0, keyword } = opts;
  const params: unknown[] = [limit, offset];
  let where = '';
  if (keyword) {
    params.push(`%${keyword}%`);
    where = `WHERE r.keyword ILIKE $${params.length}`;
  }

  const { rows: requests } = await pool.query<KeywordRequest>(
    `SELECT * FROM keyword_sourcing_requests r
     ${where}
     ORDER BY requested_at DESC
     LIMIT $1 OFFSET $2`,
    params,
  );

  if (requests.length === 0) return [];

  const ids = requests.map((r) => r.id);
  const { rows: results } = await pool.query<KeywordResult>(
    `SELECT * FROM keyword_sourcing_results
     WHERE request_id = ANY($1)
     ORDER BY request_id, rank`,
    [ids],
  );

  const resultsByRequest = new Map<number, KeywordResult[]>();
  for (const row of results) {
    const arr = resultsByRequest.get(row.request_id) ?? [];
    arr.push(row);
    resultsByRequest.set(row.request_id, arr);
  }

  return requests.map((req) => ({
    ...req,
    results: resultsByRequest.get(req.id) ?? [],
  }));
}

/** 통계: 전체 건수, 이번 주 건수, 완료된 요청의 평균 최고 마진율 */
export async function getStats(pool: pg.Pool): Promise<{
  total: number;
  thisWeek: number;
  avgTopMargin: number | null;
}> {
  const { rows } = await pool.query<{
    total: string;
    this_week: string;
  }>(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE requested_at > NOW() - INTERVAL '7 days') AS this_week
     FROM keyword_sourcing_requests`,
  );

  const { rows: marginRows } = await pool.query<{ avg_top_margin: string | null }>(
    `SELECT AVG(sub.top_margin) AS avg_top_margin
     FROM (
       SELECT MAX(domeggook_margin_rate) AS top_margin
       FROM keyword_sourcing_results ksr
       JOIN keyword_sourcing_requests kr ON kr.id = ksr.request_id
       WHERE kr.status = 'done'
       GROUP BY ksr.request_id
     ) sub`,
  );

  const row = rows[0];
  return {
    total: parseInt(row.total, 10),
    thisWeek: parseInt(row.this_week, 10),
    avgTopMargin: marginRows[0]?.avg_top_margin ? parseFloat(marginRows[0].avg_top_margin) : null,
  };
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/lib/sourcing-agent/keyword-db.ts
git commit -m "feat(sourcing): keyword_sourcing_requests/results 테이블 + DB 함수 추가"
```

---

## Task 2: Telegram 클라이언트

**Files:**
- Create: `src/lib/telegram/client.ts`

- [ ] **Step 1: client.ts 작성**

```typescript
const TELEGRAM_API = 'https://api.telegram.org';

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN 환경변수 미설정');
  return token;
}

/** 텔레그램 채팅에 텍스트 메시지 전송 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  parseMode: 'HTML' | 'Markdown' | undefined = undefined,
): Promise<void> {
  const token = getBotToken();
  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[telegram] sendMessage 실패 (${res.status}): ${body}`);
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/lib/telegram/client.ts
git commit -m "feat(telegram): Telegram Bot API sendMessage 클라이언트 추가"
```

---

## Task 3: 키워드 소싱 파이프라인

**Files:**
- Create: `src/lib/sourcing-agent/keyword-pipeline.ts`

이 파이프라인은 Telegram webhook에서 `after()`로 호출된다.
Domeggook 썸네일(`item.thumb`)을 reference 이미지로 `matchOn1688`에 전달한다.
1688 매칭 실패는 개별 상품 오류로 처리하고 계속 진행한다.

- [ ] **Step 1: keyword-pipeline.ts 작성**

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

const MIN_MARGIN_RATE = 30;
const TOP_N = 5;
const DOMEGGOOK_PAGE_SIZE = 10;

function formatResultMessage(
  keyword: string,
  naverPrice: number,
  results: KeywordResultInsert[],
): string {
  if (results.length === 0) {
    return `❌ 분석 실패\n📦 ${keyword}\n마진 ${MIN_MARGIN_RATE}% 이상 상품을 찾지 못했습니다.`;
  }

  const lines: string[] = [
    `✅ 소싱 분석 완료`,
    `📦 ${keyword}`,
    `💰 네이버 판매가: ${naverPrice.toLocaleString()}원`,
    ``,
    `─────────────────`,
  ];

  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

  for (const r of results) {
    const medal = medals[(r.rank - 1)] ?? `${r.rank}위`;
    const dMargin = r.domeggook_margin_rate?.toFixed(1) ?? '—';
    lines.push(`${medal} ${r.rank}위 | 도매꾹 마진 ${dMargin}%`);
    if (r.domeggook_price) {
      lines.push(`  도매꾹: ${r.domeggook_price.toLocaleString()}원 → ${r.domeggook_url ?? ''}`);
    }
    if (r.china_price_krw && r.china_url) {
      const cMargin = r.china_margin_rate?.toFixed(1) ?? '—';
      lines.push(`  1688:  ${r.china_price_krw.toLocaleString()}원 → ${r.china_url} (마진 ${cMargin}%)`);
    } else {
      lines.push(`  1688:  없음`);
    }
    lines.push(``);
  }

  lines.push(`─────────────────`);
  lines.push(`전체 결과는 소싱에이전트 탭에서 확인`);

  return lines.join('\n');
}

export async function runKeywordPipeline(keyword: string, chatId: string): Promise<void> {
  const pool = getSourcingPool();

  // 1. 분석 시작 메시지 전송
  await sendTelegramMessage(chatId, `🔍 분석 시작합니다\n📦 ${keyword}\n잠시만 기다려주세요...`);

  // 2. 요청 DB 저장
  const requestId = await createRequest(pool, keyword, chatId);

  try {
    // 3. 네이버쇼핑 소비자가 조회
    const naverPrice = await searchNaverLowestPrice(keyword);
    if (!naverPrice) {
      await failRequest(pool, requestId, '네이버쇼핑에서 가격을 찾을 수 없습니다.');
      await sendTelegramMessage(chatId, `❌ 분석 실패\n📦 ${keyword}\n네이버쇼핑에서 가격을 찾을 수 없습니다.`);
      return;
    }

    // 4. 키워드 추출 → Domeggook 검색
    const extracted = await extractKeywordsFromProduct(keyword);
    const searchKeywords: string[] = extracted?.length ? extracted : [keyword];

    const client = getDomeggookClient();
    const candidateMap = new Map<number, DomeggookListItem>();

    for (const kw of searchKeywords) {
      try {
        const res = await client.getItemList({ keyword: kw, pageSize: DOMEGGOOK_PAGE_SIZE, sort: 'rd' });
        for (const item of res.list) {
          if (!candidateMap.has(item.no)) candidateMap.set(item.no, item);
        }
      } catch (err) {
        console.warn('[keyword-pipeline] Domeggook 검색 실패:', kw, err instanceof Error ? err.message : err);
      }
    }

    const candidates = Array.from(candidateMap.values());

    if (candidates.length === 0) {
      await failRequest(pool, requestId, '도매꾹에서 매칭 상품을 찾지 못했습니다.');
      await sendTelegramMessage(chatId, `❌ 분석 실패\n📦 ${keyword}\n도매꾹에서 매칭 상품을 찾지 못했습니다.`);
      return;
    }

    // 5. 각 후보 처리
    const resultRows: Array<KeywordResultInsert & { _margin: number }> = [];

    for (const item of candidates) {
      const marginRate = calcMarginRate(item.price, naverPrice, null);
      if (marginRate < MIN_MARGIN_RATE) continue;

      // 1688 매칭 (Domeggook 썸네일을 reference 이미지로 사용)
      let chinaMatch = null;
      try {
        if (item.thumb) {
          chinaMatch = await matchOn1688(item.title, item.thumb, naverPrice);
        }
      } catch (err) {
        console.warn('[keyword-pipeline] 1688 매칭 실패:', item.title, err instanceof Error ? err.message : err);
      }

      resultRows.push({
        rank: 0, // 정렬 후 재할당
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
    }

    // 6. 마진 내림차순 상위 5개, rank 할당
    const top = resultRows
      .sort((a, b) => b._margin - a._margin)
      .slice(0, TOP_N)
      .map(({ _margin: _, ...row }, idx) => ({ ...row, rank: idx + 1 }));

    // 7. DB 저장
    await saveKeywordResults(pool, requestId, top);
    await completeRequest(pool, requestId);

    // 8. 결과 전송
    const message = formatResultMessage(keyword, naverPrice, top);
    await sendTelegramMessage(chatId, message);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[keyword-pipeline] 파이프라인 오류:', msg);
    await failRequest(pool, requestId, msg).catch(() => {});
    await sendTelegramMessage(chatId, `❌ 분석 실패\n📦 ${keyword}\n${msg}`).catch(() => {});
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/lib/sourcing-agent/keyword-pipeline.ts
git commit -m "feat(sourcing): 키워드 기반 소싱 파이프라인 추가 (Naver+Domeggook+1688)"
```

---

## Task 4: Telegram Webhook Route

**Files:**
- Create: `src/app/api/telegram/webhook/route.ts`

`after`는 `next/server`에서 import한다 (Next.js 16에서 stable).
Telegram이 webhook secret을 `x-telegram-bot-api-secret-token` 헤더로 전송한다.

- [ ] **Step 1: webhook 디렉토리 생성 확인**

```bash
mkdir -p src/app/api/telegram/webhook
```

- [ ] **Step 2: route.ts 작성**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { runKeywordPipeline } from '@/lib/sourcing-agent/keyword-pipeline';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // Telegram webhook secret 검증
  const secret = req.headers.get('x-telegram-bot-api-secret-token');
  if (process.env.TELEGRAM_WEBHOOK_SECRET && secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true }); // 파싱 실패는 무시
  }

  const message = (body as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
  const text = message?.text as string | undefined;
  const chatId = (message?.chat as Record<string, unknown>)?.id;

  // 텍스트 메시지가 아니면 무시
  if (!text || !chatId) {
    return NextResponse.json({ ok: true });
  }

  const keyword = text.trim();
  const chatIdStr = String(chatId);

  // 200 즉시 반환 후 백그라운드 실행
  after(runKeywordPipeline(keyword, chatIdStr));

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/telegram/webhook/route.ts
git commit -m "feat(telegram): webhook 수신 라우트 추가"
```

---

## Task 5: Results API Route 업데이트

**Files:**
- Modify: `src/app/api/sourcing/agent/results/route.ts`

- [ ] **Step 1: route.ts 전체 교체**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getRequests, getStats } from '@/lib/sourcing-agent/keyword-db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const rawLimit = parseInt(searchParams.get('limit') ?? '50', 10);
    const limit = Math.min(100, Math.max(1, isNaN(rawLimit) ? 50 : rawLimit));
    const rawOffset = parseInt(searchParams.get('offset') ?? '0', 10);
    const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);
    const keyword = searchParams.get('keyword') ?? undefined;
    const includeStats = searchParams.get('stats') === 'true';

    const pool = getSourcingPool();
    const [requests, stats] = await Promise.all([
      getRequests(pool, { limit, offset, keyword }),
      includeStats ? getStats(pool) : Promise.resolve(null),
    ]);

    return NextResponse.json({ success: true, data: requests, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/app/api/sourcing/agent/results/route.ts
git commit -m "feat(sourcing): results API를 신규 keyword_sourcing 테이블로 교체"
```

---

## Task 6: 구 파일 삭제

**참고:** `china-matcher.ts`와 `image-similarity.ts`는 1688 매칭에 계속 사용되므로 삭제하지 않는다.

- [ ] **Step 1: 구 파일 삭제**

```bash
git rm src/lib/sourcing-agent/coupang-crawler.ts
git rm src/lib/sourcing-agent/pipeline.ts
git rm src/lib/sourcing-agent/domeggook-matcher.ts
git rm src/app/api/sourcing/agent/run/route.ts
git rm src/app/api/sourcing/agent/categories/route.ts
```

- [ ] **Step 2: TypeScript 컴파일 오류 확인**

```bash
cd /Users/seungminlee/projects/smart_seller_studio && npx tsc --noEmit 2>&1 | head -30
```

삭제된 파일을 참조하는 import가 있으면 해당 파일을 찾아 수정한다.

- [ ] **Step 3: 커밋**

```bash
git commit -m "refactor(sourcing): 쿠팡 크롤링 및 카테고리 기반 파이프라인 삭제"
```

---

## Task 7: SourcingAgentTab.tsx 전면 교체

**Files:**
- Modify: `src/components/sourcing/SourcingAgentTab.tsx`

기존 파일 전체를 아래 코드로 교체한다.

- [ ] **Step 1: SourcingAgentTab.tsx 전체 교체**

```typescript
'use client';

import React, { useCallback, useEffect, useState } from 'react';

// ─── 색상 토큰 (다크 테마) ─────────────────────────────────────────────────────
const DC = {
  bg:      '#0f1117',
  surface: '#1a1d26',
  border:  '#2a2d3a',
  accent:  '#6366f1',
  text:    '#e2e8f0',
  textSub: '#94a3b8',
  success: '#10b981',
  warn:    '#f59e0b',
  danger:  '#ef4444',
} as const;

// ─── 타입 ─────────────────────────────────────────────────────────────────────
interface KeywordResult {
  id: number;
  rank: number;
  naver_price: number | null;
  domeggook_product_name: string | null;
  domeggook_price: number | null;
  domeggook_url: string | null;
  domeggook_margin_rate: number | null;
  china_product_name: string | null;
  china_price_krw: number | null;
  china_url: string | null;
  china_margin_rate: number | null;
}

interface KeywordRequest {
  id: number;
  keyword: string;
  status: 'pending' | 'done' | 'error';
  error_message: string | null;
  requested_at: string;
  completed_at: string | null;
  results: KeywordResult[];
}

interface Stats {
  total: number;
  thisWeek: number;
  avgTopMargin: number | null;
}

// ─── 유틸 ─────────────────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatKrw(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toLocaleString()}원`;
}

// ─── 서브 컴포넌트: 마진 배지 ─────────────────────────────────────────────────
function MarginBadge({ rate }: { rate: number | null }) {
  if (rate == null) return <span style={{ fontSize: 11, color: DC.textSub }}>—</span>;
  const pct = rate.toFixed(1);
  const color = rate >= 40 ? DC.success : rate >= 25 ? DC.warn : DC.danger;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 20,
      fontSize: 11, fontWeight: 700,
      background: `${color}22`, color,
      border: `1px solid ${color}55`,
    }}>
      {pct}%
    </span>
  );
}

// ─── 서브 컴포넌트: 상태 배지 ─────────────────────────────────────────────────
function StatusBadge({ status }: { status: KeywordRequest['status'] }) {
  if (status === 'pending') return <span style={{ color: DC.warn, fontSize: 12 }}>⏳ 분석 중...</span>;
  if (status === 'error')   return <span style={{ color: DC.danger, fontSize: 12 }}>❌ 오류</span>;
  return <span style={{ color: DC.success, fontSize: 12 }}>✅ 완료</span>;
}

// ─── 서브 컴포넌트: 결과 카드 ────────────────────────────────────────────────
function ResultCard({ result }: { result: KeywordResult }) {
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
  const medal = medals[result.rank - 1] ?? `${result.rank}위`;

  return (
    <div style={{
      background: DC.bg, borderRadius: 8, padding: '10px 14px',
      border: `1px solid ${DC.border}`, marginBottom: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 14 }}>{medal}</span>
        <span style={{ fontSize: 13, color: DC.text, fontWeight: 600 }}>
          {result.domeggook_product_name ?? '—'}
        </span>
        <MarginBadge rate={result.domeggook_margin_rate} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
        <div>
          <span style={{ color: DC.textSub }}>네이버가: </span>
          <span style={{ color: DC.text }}>{formatKrw(result.naver_price)}</span>
        </div>
        <div>
          <span style={{ color: DC.textSub }}>도매꾹가: </span>
          {result.domeggook_url ? (
            <a href={result.domeggook_url} target="_blank" rel="noreferrer"
               style={{ color: DC.accent }}>
              {formatKrw(result.domeggook_price)}
            </a>
          ) : (
            <span style={{ color: DC.text }}>{formatKrw(result.domeggook_price)}</span>
          )}
        </div>
        <div>
          <span style={{ color: DC.textSub }}>1688가: </span>
          {result.china_url ? (
            <a href={result.china_url} target="_blank" rel="noreferrer"
               style={{ color: DC.accent }}>
              {formatKrw(result.china_price_krw)}
            </a>
          ) : (
            <span style={{ color: DC.textSub }}>없음</span>
          )}
        </div>
        <div>
          <span style={{ color: DC.textSub }}>1688 마진: </span>
          <MarginBadge rate={result.china_margin_rate} />
        </div>
      </div>
    </div>
  );
}

// ─── 서브 컴포넌트: 요청 행 ───────────────────────────────────────────────────
function RequestRow({ request }: { request: KeywordRequest }) {
  const [open, setOpen] = useState(false);
  const topMargin = request.results.length > 0
    ? Math.max(...request.results.map((r) => r.domeggook_margin_rate ?? 0))
    : null;

  return (
    <div style={{
      background: DC.surface, borderRadius: 10,
      border: `1px solid ${DC.border}`, marginBottom: 8, overflow: 'hidden',
    }}>
      <div
        onClick={() => request.status === 'done' && setOpen((v) => !v)}
        style={{
          padding: '12px 16px', display: 'flex', alignItems: 'center',
          gap: 12, cursor: request.status === 'done' ? 'pointer' : 'default',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 600, color: DC.text,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {request.keyword}
          </div>
          <div style={{ fontSize: 11, color: DC.textSub, marginTop: 2 }}>
            {formatDate(request.requested_at)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <StatusBadge status={request.status} />
          {request.status === 'done' && topMargin != null && (
            <span style={{ fontSize: 11, color: DC.textSub }}>
              최고 <MarginBadge rate={topMargin} />
            </span>
          )}
          {request.status === 'done' && (
            <span style={{ color: DC.textSub, fontSize: 12 }}>{open ? '▲' : '▼'}</span>
          )}
        </div>
      </div>

      {open && request.results.length > 0 && (
        <div style={{ padding: '0 12px 12px' }}>
          {request.results.map((r) => (
            <ResultCard key={r.id} result={r} />
          ))}
        </div>
      )}

      {open && request.results.length === 0 && (
        <div style={{ padding: '8px 16px 12px', fontSize: 12, color: DC.textSub }}>
          결과 없음
        </div>
      )}

      {request.status === 'error' && request.error_message && (
        <div style={{ padding: '0 16px 12px', fontSize: 12, color: DC.danger }}>
          {request.error_message}
        </div>
      )}
    </div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export default function SourcingAgentTab() {
  const [requests, setRequests] = useState<KeywordRequest[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');

  const fetchData = useCallback(async (kw?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '50', stats: 'true' });
      if (kw) params.set('keyword', kw);
      const res = await fetch(`/api/sourcing/agent/results?${params}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setRequests(json.data);
      if (json.stats) setStats(json.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오기 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // pending 요청이 있으면 10초마다 자동 갱신
  useEffect(() => {
    const hasPending = requests.some((r) => r.status === 'pending');
    if (!hasPending) return;
    const timer = setInterval(() => fetchData(keyword || undefined), 10_000);
    return () => clearInterval(timer);
  }, [requests, keyword, fetchData]);

  return (
    <div style={{ background: DC.bg, minHeight: '100%', padding: 20, color: DC.text }}>
      {/* 헤더 */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>소싱 에이전트</div>
        <div style={{ fontSize: 12, color: DC.textSub }}>
          텔레그램 봇에 상품명을 보내면 자동 분석됩니다
        </div>
      </div>

      {/* 통계 */}
      {stats && (
        <div style={{
          display: 'flex', gap: 12, marginBottom: 16,
        }}>
          {[
            { label: '전체', value: `${stats.total}건` },
            { label: '이번 주', value: `${stats.thisWeek}건` },
            { label: '평균 마진', value: stats.avgTopMargin ? `${stats.avgTopMargin.toFixed(1)}%` : '—' },
          ].map(({ label, value }) => (
            <div key={label} style={{
              flex: 1, background: DC.surface, borderRadius: 8,
              border: `1px solid ${DC.border}`, padding: '10px 14px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 11, color: DC.textSub, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: DC.accent }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* 검색 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && fetchData(keyword || undefined)}
          placeholder="키워드 검색..."
          style={{
            flex: 1, background: DC.surface, border: `1px solid ${DC.border}`,
            borderRadius: 8, padding: '8px 12px', color: DC.text,
            fontSize: 13, outline: 'none',
          }}
        />
        <button
          onClick={() => fetchData(keyword || undefined)}
          style={{
            background: DC.accent, color: '#fff', border: 'none',
            borderRadius: 8, padding: '8px 16px', fontSize: 13,
            cursor: 'pointer',
          }}
        >
          검색
        </button>
        <button
          onClick={() => { setKeyword(''); fetchData(); }}
          style={{
            background: DC.surface, color: DC.textSub, border: `1px solid ${DC.border}`,
            borderRadius: 8, padding: '8px 12px', fontSize: 13,
            cursor: 'pointer',
          }}
        >
          초기화
        </button>
      </div>

      {/* 목록 */}
      {loading && (
        <div style={{ textAlign: 'center', color: DC.textSub, padding: 40 }}>불러오는 중...</div>
      )}
      {error && (
        <div style={{ color: DC.danger, fontSize: 13, padding: 16, background: `${DC.danger}11`, borderRadius: 8 }}>
          {error}
        </div>
      )}
      {!loading && !error && requests.length === 0 && (
        <div style={{ textAlign: 'center', color: DC.textSub, padding: 60 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📱</div>
          <div>텔레그램 봇에 상품명을 보내면 여기에 결과가 표시됩니다</div>
        </div>
      )}
      {requests.map((req) => (
        <RequestRow key={req.id} request={req} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/sourcing/SourcingAgentTab.tsx
git commit -m "feat(ui): 소싱에이전트 탭 리뉴얼 - 키워드 이력 뷰어로 교체"
```

---

## Task 8: 환경변수 설정 + Webhook 등록

- [ ] **Step 1: .env.local에 환경변수 추가**

`.env.local` 파일에 아래 항목 추가:
```
TELEGRAM_BOT_TOKEN=<@BotFather에서 받은 토큰>
TELEGRAM_WEBHOOK_SECRET=<임의 문자열, 예: openssl rand -hex 32 결과>
```

시크릿 생성:
```bash
openssl rand -hex 32
```

- [ ] **Step 2: Vercel 환경변수 등록**

Vercel 대시보드 또는 CLI로 프로덕션 환경변수 등록:
```bash
vercel env add TELEGRAM_BOT_TOKEN
vercel env add TELEGRAM_WEBHOOK_SECRET
```

- [ ] **Step 3: 배포 후 Webhook 등록**

프로덕션 배포 완료 후 아래 명령 실행 (TOKEN과 SECRET은 실제 값으로 교체):
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<your-vercel-domain>/api/telegram/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```

응답이 `{"ok":true,"result":true,...}` 이면 성공.

- [ ] **Step 4: 동작 확인**

텔레그램에서 봇에 상품명 전송:
```
욕실 코너 수납 선반
```

기대 응답 1 (즉시):
```
🔍 분석 시작합니다
📦 욕실 코너 수납 선반
잠시만 기다려주세요...
```

기대 응답 2 (1~3분 후):
```
✅ 소싱 분석 완료
📦 욕실 코너 수납 선반
💰 네이버 판매가: ...
...
```

- [ ] **Step 5: 커밋**

```bash
git commit -m "chore: 텔레그램 봇 webhook 등록 완료"
```

---

## 주요 의존성 확인

```bash
# 이미 설치되어 있어야 함
node -e "require('playwright-core'); require('@sparticuz/chromium-min'); console.log('OK')"
```

`after`는 `next/server`에 내장 (Next.js 16, 별도 설치 불필요).
