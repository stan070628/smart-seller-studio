# 소싱 검증기 (Sourcing Validator) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 키워드를 입력하면 Naver 4종 API로 데이터를 수집하고 Claude Max 플랜으로 소싱 진입 판정을 내려주는 로컬 전용 웹 앱을 `~/Desktop/projects/sourcing-validator/`에 생성한다.

**Architecture:** Naver DataLab + 자동완성 + 쇼핑수 + 뉴스 API를 병렬로 호출해 데이터를 모은 뒤 `claude -p` subprocess에 넘기고, SSE 스트리밍으로 분석 결과를 실시간 표시한다. Anthropic API 키 없이 `claude` CLI(Max 플랜)만 사용한다.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS, Vitest, Node.js `child_process.spawn`, Naver Open API

**Reference:** `~/Desktop/projects/advertise/autoreel/autoreel/claude_ai.py` — `_run()` 함수가 동일한 `claude -p` subprocess 패턴 사용

---

## File Map

| 경로 (프로젝트 루트: `~/Desktop/projects/sourcing-validator/`) | 역할 |
|---|---|
| `src/lib/naver.ts` | Naver 4종 API 호출 + `NaverData` 타입 |
| `src/lib/claude.ts` | `streamClaude` AsyncGenerator — spawn 래퍼 |
| `src/lib/prompt.ts` | `buildPrompt` — NaverData → Claude 프롬프트 문자열 |
| `src/app/api/validate/route.ts` | POST endpoint, SSE 스트리밍 |
| `src/app/page.tsx` | 프론트엔드 — 키워드 입력 + 결과 스트리밍 |
| `src/lib/__tests__/naver.test.ts` | naver.ts 단위 테스트 |
| `src/lib/__tests__/claude.test.ts` | claude.ts 단위 테스트 |
| `src/lib/__tests__/prompt.test.ts` | prompt.ts 단위 테스트 |
| `vitest.config.ts` | Vitest 설정 |
| `.env.local` | NAVER_CLIENT_ID, NAVER_CLIENT_SECRET |

---

## Task 1: 프로젝트 초기화

**Files:**
- Create: `~/Desktop/projects/sourcing-validator/` (전체 Next.js 프로젝트)
- Create: `vitest.config.ts`
- Create: `.env.local`

- [ ] **Step 1: Next.js 앱 생성**

```bash
cd ~/Desktop/projects
npx create-next-app@latest sourcing-validator \
  --typescript \
  --tailwind \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --no-eslint \
  --yes
cd sourcing-validator
```

Expected: `sourcing-validator/` 디렉터리 생성, `npm run dev` 실행 가능 상태

- [ ] **Step 2: 포트 3001 설정 + Vitest 설치**

`package.json`의 `scripts` 섹션을 아래로 교체:
```json
"scripts": {
  "dev": "next dev -p 3001",
  "build": "next build",
  "start": "next start -p 3001",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

그런 다음:
```bash
npm install -D vitest
```

- [ ] **Step 3: vitest.config.ts 생성**

`~/Desktop/projects/sourcing-validator/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 4: .env.local 생성**

`~/Desktop/projects/sourcing-validator/.env.local`:
```
NAVER_CLIENT_ID=여기에_smart_seller_studio_.env.local의_NAVER_CLIENT_ID_값_복사
NAVER_CLIENT_SECRET=여기에_smart_seller_studio_.env.local의_NAVER_CLIENT_SECRET_값_복사
```

smart_seller_studio의 `.env.local`에서 두 값을 복사해 넣는다.

- [ ] **Step 5: 기본 파일 정리 + 초기 커밋**

`src/app/page.tsx`를 아래로 교체 (임시 placeholder):
```tsx
export default function Home() {
  return <main className="p-8"><h1 className="text-2xl">소싱 검증기</h1></main>;
}
```

`src/app/globals.css`는 그대로 유지 (Tailwind 기본).

```bash
git init
git add -A
git commit -m "chore: init sourcing-validator (Next.js 15, port 3001, vitest)"
```

- [ ] **Step 6: 서버 기동 확인**

```bash
npm run dev
```

Expected: `http://localhost:3001` 에서 "소싱 검증기" 텍스트 보임. `Ctrl+C`로 종료.

---

## Task 2: Naver API 유틸 (src/lib/naver.ts)

**Files:**
- Create: `src/lib/naver.ts`
- Create: `src/lib/__tests__/naver.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

`src/lib/__tests__/naver.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { collectNaverData } from '../naver';

const MOCK_DATALAB = {
  results: [{
    data: [
      { period: '2025-05-01', ratio: 45.1 },
      { period: '2025-06-01', ratio: 52.3 },
    ]
  }]
};
const MOCK_AUTOCOMPLETE = {
  items: [[['사무실텀블러', '0'], ['차량용텀블러', '0']]]
};
const MOCK_SHOPPING = { total: 890 };
const MOCK_NEWS = {
  items: [
    {
      title: '<b>텀블러</b> 시장 성장',
      description: '올해 <b>텀블러</b> 시장은...',
      pubDate: 'Fri, 30 May 2026 10:00:00 +0900',
    }
  ]
};

describe('collectNaverData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NAVER_CLIENT_ID = 'test-id';
    process.env.NAVER_CLIENT_SECRET = 'test-secret';
  });

  it('4종 API를 병렬로 호출하고 NaverData를 반환한다', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(MOCK_DATALAB) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(MOCK_AUTOCOMPLETE) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(MOCK_SHOPPING) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(MOCK_NEWS) });

    const result = await collectNaverData('텀블러');

    expect(result.trend).toHaveLength(2);
    expect(result.trend[0]).toEqual({ period: '2025-05-01', ratio: 45.1 });
    expect(result.related).toEqual(['사무실텀블러', '차량용텀블러']);
    expect(result.competitionCount).toBe(890);
    expect(result.news[0].title).toBe('텀블러 시장 성장'); // HTML 태그 제거됨
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('DataLab 호출 시 올바른 헤더를 포함한다', async () => {
    mockFetch
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(MOCK_DATALAB) });
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(MOCK_DATALAB) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(MOCK_AUTOCOMPLETE) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(MOCK_SHOPPING) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(MOCK_NEWS) });

    await collectNaverData('텀블러');

    const datalabCall = mockFetch.mock.calls[0];
    expect(datalabCall[1].headers['X-Naver-Client-Id']).toBe('test-id');
    expect(datalabCall[1].headers['X-Naver-Client-Secret']).toBe('test-secret');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/__tests__/naver.test.ts
```

Expected: FAIL — `Cannot find module '../naver'`

- [ ] **Step 3: naver.ts 구현**

`src/lib/naver.ts`:
```typescript
export interface TrendPoint {
  period: string;
  ratio: number;
}

export interface NewsItem {
  title: string;
  description: string;
  pubDate: string;
}

export interface NaverData {
  trend: TrendPoint[];
  related: string[];
  competitionCount: number;
  news: NewsItem[];
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function fetchDatalabTrend(keyword: string): Promise<TrendPoint[]> {
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - 12);

  const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
    method: 'POST',
    headers: {
      'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID!,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      startDate: formatDate(start),
      endDate: formatDate(end),
      timeUnit: 'month',
      keywordGroups: [{ groupName: keyword, keywords: [keyword] }],
    }),
  });

  const data = await res.json();
  return (data.results?.[0]?.data ?? []) as TrendPoint[];
}

async function fetchAutocomplete(keyword: string): Promise<string[]> {
  const res = await fetch(
    `https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(keyword)}&st=100&frm=nv`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  const data = await res.json();
  const items: string[][] = data.items?.[0] ?? [];
  return items.slice(0, 10).map((item) => item[0]);
}

async function fetchShoppingCount(keyword: string): Promise<number> {
  const res = await fetch(
    `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(keyword)}&display=1`,
    {
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID!,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET!,
      },
    }
  );
  const data = await res.json();
  return data.total ?? 0;
}

async function fetchNews(keyword: string): Promise<NewsItem[]> {
  const res = await fetch(
    `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(keyword)}&display=3&sort=date`,
    {
      headers: {
        'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID!,
        'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET!,
      },
    }
  );
  const data = await res.json();
  return (data.items ?? []).map((item: Record<string, string>) => ({
    title: stripHtml(item.title),
    description: stripHtml(item.description),
    pubDate: item.pubDate,
  }));
}

export async function collectNaverData(keyword: string): Promise<NaverData> {
  const [trend, related, competitionCount, news] = await Promise.all([
    fetchDatalabTrend(keyword),
    fetchAutocomplete(keyword),
    fetchShoppingCount(keyword),
    fetchNews(keyword),
  ]);
  return { trend, related, competitionCount, news };
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

```bash
npx vitest run src/lib/__tests__/naver.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/naver.ts src/lib/__tests__/naver.test.ts
git commit -m "feat: Naver 4종 API 유틸 (DataLab, 자동완성, 쇼핑수, 뉴스)"
```

---

## Task 3: Claude subprocess 래퍼 (src/lib/claude.ts)

**Files:**
- Create: `src/lib/claude.ts`
- Create: `src/lib/__tests__/claude.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

`src/lib/__tests__/claude.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

vi.mock('child_process', () => ({ spawn: vi.fn() }));

import { spawn } from 'child_process';
import { streamClaude } from '../claude';

function makeMockChild(chunks: string[], exitCode = 0) {
  const stdout = new Readable({
    read() {
      for (const c of chunks) this.push(Buffer.from(c));
      this.push(null);
    },
  });
  const stderr = new Readable({ read() { this.push(null); } });
  const child = Object.assign(new EventEmitter(), { stdout, stderr });
  process.nextTick(() => child.emit('close', exitCode));
  vi.mocked(spawn).mockReturnValue(child as any);
  return child;
}

describe('streamClaude', () => {
  afterEach(() => vi.clearAllMocks());

  it('stdout 청크를 순서대로 yield한다', async () => {
    makeMockChild(['분석 결과: ', '진입 추천']);

    const chunks: string[] = [];
    for await (const chunk of streamClaude('텀블러 분석')) {
      chunks.push(chunk);
    }
    expect(chunks.join('')).toBe('분석 결과: 진입 추천');
  });

  it('올바른 claude 명령으로 spawn한다', async () => {
    makeMockChild(['ok']);
    for await (const _ of streamClaude('테스트')) { /* consume */ }
    expect(spawn).toHaveBeenCalledWith(
      'claude',
      ['-p', '테스트', '--output-format', 'text'],
      { env: process.env }
    );
  });

  it('exit code 1이면 Error를 throw한다', async () => {
    makeMockChild([], 1);
    const gen = streamClaude('실패 테스트');
    await expect(async () => {
      for await (const _ of gen) { /* consume */ }
    }).rejects.toThrow('claude exited with code 1');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/__tests__/claude.test.ts
```

Expected: FAIL — `Cannot find module '../claude'`

- [ ] **Step 3: claude.ts 구현**

`src/lib/claude.ts`:
```typescript
import { spawn } from 'child_process';
import type { Readable } from 'stream';

export async function* streamClaude(prompt: string): AsyncGenerator<string> {
  const child = spawn('claude', ['-p', prompt, '--output-format', 'text'], {
    env: process.env,
  });

  const closePromise = new Promise<number>((resolve) => {
    child.on('close', (code) => resolve(code ?? 0));
  });

  for await (const chunk of child.stdout as Readable) {
    yield (chunk as Buffer).toString('utf-8');
  }

  const exitCode = await closePromise;
  if (exitCode !== 0) {
    throw new Error(`claude exited with code ${exitCode}`);
  }
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

```bash
npx vitest run src/lib/__tests__/claude.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/claude.ts src/lib/__tests__/claude.test.ts
git commit -m "feat: Claude subprocess 스트리밍 래퍼"
```

---

## Task 4: 프롬프트 빌더 (src/lib/prompt.ts)

**Files:**
- Create: `src/lib/prompt.ts`
- Create: `src/lib/__tests__/prompt.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

`src/lib/__tests__/prompt.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../prompt';
import type { NaverData } from '../naver';

const MOCK_DATA: NaverData = {
  trend: [
    { period: '2025-05-01', ratio: 45.1 },
    { period: '2025-06-01', ratio: 52.3 },
  ],
  related: ['사무실텀블러', '차량용텀블러'],
  competitionCount: 890,
  news: [
    {
      title: '텀블러 시장 성장',
      description: '올해 텀블러 시장은 꾸준히 성장 중',
      pubDate: 'Fri, 30 May 2026 10:00:00 +0900',
    }
  ],
};

describe('buildPrompt', () => {
  it('키워드를 [키워드] 섹션에 포함한다', () => {
    const prompt = buildPrompt('텀블러', MOCK_DATA);
    expect(prompt).toContain('[키워드] 텀블러');
  });

  it('트렌드를 기간: 비율 형식으로 포함한다', () => {
    const prompt = buildPrompt('텀블러', MOCK_DATA);
    expect(prompt).toContain('2025-05-01: 45.1');
    expect(prompt).toContain('2025-06-01: 52.3');
  });

  it('연관 키워드를 쉼표로 구분해 포함한다', () => {
    const prompt = buildPrompt('텀블러', MOCK_DATA);
    expect(prompt).toContain('사무실텀블러, 차량용텀블러');
  });

  it('경쟁 상품수를 포함한다', () => {
    const prompt = buildPrompt('텀블러', MOCK_DATA);
    expect(prompt).toContain('890');
  });

  it('뉴스 제목과 설명을 포함한다', () => {
    const prompt = buildPrompt('텀블러', MOCK_DATA);
    expect(prompt).toContain('텀블러 시장 성장');
  });

  it('판정 형식 지시가 포함된다', () => {
    const prompt = buildPrompt('텀블러', MOCK_DATA);
    expect(prompt).toContain('진입 점수');
    expect(prompt).toContain('핵심 근거');
    expect(prompt).toContain('공략 키워드');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run src/lib/__tests__/prompt.test.ts
```

Expected: FAIL — `Cannot find module '../prompt'`

- [ ] **Step 3: prompt.ts 구현**

`src/lib/prompt.ts`:
```typescript
import type { NaverData } from './naver';

export function buildPrompt(keyword: string, data: NaverData): string {
  const trendStr = data.trend
    .map(({ period, ratio }) => `${period}: ${ratio}`)
    .join(', ');

  const newsStr = data.news
    .map(({ title, description }) => `- ${title}: ${description}`)
    .join('\n');

  return `당신은 한국 이커머스 소싱 전문가입니다.
아래 데이터를 분석해 소싱 진입 판정을 내려주세요.

[키워드] ${keyword}
[검색 트렌드 — 최근 12개월] ${trendStr}
[연관 키워드] ${data.related.join(', ')}
[경쟁 상품수] "${keyword}" ${data.competitionCount.toLocaleString()}개
[최신 뉴스/트렌드]
${newsStr}

분석 시 고려사항:
- 검색 트렌드의 최근 3개월 방향성 (상승/하락/횡보)
- 연관 키워드 중 경쟁이 낮고 수요가 있는 니치 후보
- 뉴스에서 파악되는 시장 맥락 및 계절성

판정 형식 (반드시 아래 구조로 끝내세요):
---
진입 점수: ★☆☆☆☆ (숫자/5)
판정: 진입 추천 | 보류 | 포기
핵심 근거:
• ...
• ...
• ...
공략 키워드: ...`;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인**

```bash
npx vitest run src/lib/__tests__/prompt.test.ts
```

Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/prompt.ts src/lib/__tests__/prompt.test.ts
git commit -m "feat: Claude 소싱 판정 프롬프트 빌더"
```

---

## Task 5: API Route — SSE 스트리밍 (src/app/api/validate/route.ts)

**Files:**
- Create: `src/app/api/validate/route.ts`

- [ ] **Step 1: route.ts 구현**

`src/app/api/validate/route.ts`:
```typescript
import { NextRequest } from 'next/server';
import { collectNaverData } from '@/lib/naver';
import { streamClaude } from '@/lib/claude';
import { buildPrompt } from '@/lib/prompt';

type StreamEvent =
  | { type: 'status'; text: string }
  | { type: 'text'; text: string }
  | { type: 'done' }
  | { type: 'error'; text: string };

export async function POST(req: NextRequest): Promise<Response> {
  const { keyword } = (await req.json()) as { keyword: string };

  if (!keyword?.trim()) {
    return new Response(JSON.stringify({ error: '키워드를 입력해주세요' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: StreamEvent) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
        );
      };

      try {
        emit({ type: 'status', text: 'Naver 데이터 수집 중...' });
        const naverData = await collectNaverData(keyword.trim());

        emit({ type: 'status', text: 'Claude 분석 시작...' });
        const prompt = buildPrompt(keyword.trim(), naverData);

        for await (const chunk of streamClaude(prompt)) {
          emit({ type: 'text', text: chunk });
        }

        emit({ type: 'done' });
      } catch (err) {
        emit({
          type: 'error',
          text: err instanceof Error ? err.message : '분석 중 오류가 발생했습니다',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

- [ ] **Step 2: 수동 smoke test (curl)**

서버를 띄워둔 상태에서:
```bash
npm run dev &
sleep 3

curl -s -N -X POST http://localhost:3001/api/validate \
  -H "Content-Type: application/json" \
  -d '{"keyword":"텀블러"}'
```

Expected: `data: {"type":"status","text":"Naver 데이터 수집 중..."}` 등 SSE 이벤트 흘러나옴.
Naver API 키가 없으면 `data: {"type":"error",...}` 가 오는데, 스트리밍 자체는 정상.

- [ ] **Step 3: 커밋**

```bash
# 서버 종료 후
git add src/app/api/validate/route.ts
git commit -m "feat: POST /api/validate SSE 스트리밍 엔드포인트"
```

---

## Task 6: 프론트엔드 UI (src/app/page.tsx)

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: page.tsx 전면 교체**

`src/app/page.tsx`:
```tsx
'use client';

import { useState, useRef } from 'react';

type StreamEvent =
  | { type: 'status'; text: string }
  | { type: 'text'; text: string }
  | { type: 'done' }
  | { type: 'error'; text: string };

function VerdictCard({ text }: { text: string }) {
  const scoreMatch = text.match(/진입 점수:\s*([★☆]+)/);
  const judgeMatch = text.match(/판정:\s*(진입 추천|보류|포기)/);
  const keywordMatch = text.match(/공략 키워드:\s*(.+)/);
  const bullets = [...text.matchAll(/^•\s*(.+)$/gm)].map((m) => m[1]);

  if (!judgeMatch) return null;

  const verdict = judgeMatch[1];
  const colorMap = {
    '진입 추천': 'bg-green-50 border-green-400 text-green-800',
    '보류': 'bg-yellow-50 border-yellow-400 text-yellow-800',
    '포기': 'bg-red-50 border-red-400 text-red-800',
  };
  const colors = colorMap[verdict as keyof typeof colorMap] ?? colorMap['보류'];

  return (
    <div className={`mt-4 p-5 rounded-xl border-2 ${colors}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-2xl">{scoreMatch?.[1] ?? '★★★☆☆'}</span>
        <span className="text-xl font-bold">{verdict}</span>
      </div>
      {bullets.length > 0 && (
        <ul className="space-y-1 mb-3">
          {bullets.map((b, i) => (
            <li key={i} className="text-sm">• {b}</li>
          ))}
        </ul>
      )}
      {keywordMatch && (
        <div className="pt-3 border-t border-current border-opacity-20 text-sm">
          <span className="font-medium">공략 키워드: </span>
          <span>{keywordMatch[1]}</span>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [analysisText, setAnalysisText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const accumulated = useRef('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyword.trim() || isLoading) return;

    setIsLoading(true);
    setStatus('');
    setAnalysisText('');
    setError('');
    accumulated.current = '';

    try {
      const res = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: keyword.trim() }),
      });

      if (!res.ok) throw new Error(`서버 오류 ${res.status}`);
      if (!res.body) throw new Error('응답 스트림 없음');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const raw = decoder.decode(value, { stream: true });
        for (const line of raw.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;

          let event: StreamEvent;
          try { event = JSON.parse(payload); } catch { continue; }

          if (event.type === 'status') {
            setStatus(event.text);
          } else if (event.type === 'text') {
            accumulated.current += event.text;
            setAnalysisText(accumulated.current);
          } else if (event.type === 'error') {
            setError(event.text);
            break outer;
          } else if (event.type === 'done') {
            break outer;
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류');
    } finally {
      setIsLoading(false);
      setStatus('');
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">소싱 검증기</h1>
        <p className="text-sm text-gray-500 mb-8">
          키워드를 입력하면 수요·경쟁·트렌드를 분석해 진입 판정을 내립니다.
        </p>

        <form onSubmit={handleSubmit} className="flex gap-3 mb-6">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="소싱 키워드 (예: 텀블러, 캠핑의자)"
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !keyword.trim()}
            className="px-6 py-3 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? '분석 중...' : '분석하기'}
          </button>
        </form>

        {status && (
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
            <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            {status}
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">
            {error}
          </div>
        )}

        {analysisText && (
          <div className="space-y-0">
            <div className="p-4 bg-white border border-gray-200 rounded-xl">
              <p className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wide">Claude 분석</p>
              <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">
                {analysisText}
              </pre>
            </div>
            <VerdictCard text={analysisText} />
          </div>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: 브라우저에서 수동 테스트**

```bash
npm run dev
```

1. `http://localhost:3001` 접속
2. "텀블러" 입력 → 분석하기 클릭
3. "Naver 데이터 수집 중..." 스피너 표시 확인
4. Claude 분석 텍스트가 실시간으로 흘러들어오는지 확인
5. 판정 카드가 분석 완료 후 표시되는지 확인

- [ ] **Step 3: 전체 테스트 suite 통과 확인**

```bash
npm test
```

Expected: PASS — naver(2) + claude(3) + prompt(6) = 11 tests

- [ ] **Step 4: 최종 커밋**

```bash
git add src/app/page.tsx
git commit -m "feat: 소싱 검증기 프론트엔드 UI (스트리밍 + 판정 카드)"
```

---

## 실행 방법 (완성 후)

```bash
cd ~/Desktop/projects/sourcing-validator
npm run dev
# → http://localhost:3001
```

`.env.local`에 `NAVER_CLIENT_ID`와 `NAVER_CLIENT_SECRET` 이 없으면 Naver API 호출 실패.
`claude` CLI가 로그인된 상태여야 함 (`claude --version`으로 확인).
