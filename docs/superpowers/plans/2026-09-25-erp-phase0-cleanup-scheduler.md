# ERP 0단계 — 정리와 스케줄러 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 작업 로그(`erp.job_runs`)와 텔레그램 실패 경보를 세우고, 품절 동기화 스케줄을 GitHub Actions에서 Supabase `pg_cron`으로 옮기고, 미사용 소싱 cron을 멈추고, 투자콕 테이블 50개를 무료 조직 Supabase로 이전한다.

**Architecture:** 작업 기록은 `erp` 스키마의 `job_runs` 한 테이블에 쌓고, 모든 cron 라우트는 `withJobRun()` 래퍼로 감싸 시작·종료·실패를 남긴다. 스케줄은 DB 안의 `pg_cron`이 `pg_net`으로 Vercel 라우트를 호출하며, URL과 비밀값은 Supabase Vault에 둔다. 투자콕 이전은 코드 변경 없이 `pg_dump`/`psql`과 대조 스크립트로 한다.

**Tech Stack:** Next.js 16 App Router · `pg` · Supabase Postgres 17.6(`pg_cron`, `pg_net`, `vault`) · vitest 4 · pg_dump/psql 18.3(Homebrew)

**Spec:** `docs/superpowers/specs/2026-09-25-erp-restructure-design.md` — 「단계와 완료 기준 › 0단계」

---

## 사전 정보 (실행자는 반드시 읽는다)

- 작업 폴더: `~/dev/smart_seller_studio/.worktrees/erp-restructure` (브랜치 `feature/erp-restructure`, upstream 없음). **모든 명령은 이 폴더에서 실행한다.**
- **기존 실패 13건**(7파일)은 ERP 작업 전부터 있었다: `cleanup-image-region`, `costco-naver-compare-handler`(4), `analyze-detail-images`, `keyword-discover`(3), `keyword-suggest-with-evaluate`(2), `assets-tab`, `detail-maker-thumbnail-panel`. **합격 기준 = 새 테스트 전부 통과 + 전체 실패 수 13 이하.**
- DB 접속: `.env.local`의 `SUPABASE_DB_URL`(5432 세션 풀러). 비밀값은 **절대 출력하지 않는다.** 앱 코드의 풀은 `getSourcingPool()`(`src/lib/sourcing/db.ts`, `SOURCING_DATABASE_URL` = 같은 프로젝트의 6543 포트).
- 운영 비밀값(`CRON_SECRET`, `APP_URL`)은 Vercel에만 있다. 필요하면 `npx vercel env pull /tmp/ssv.env --environment=production`으로 받고 **`.env.local`을 덮어쓰지 않는다.** 쓰고 나면 `rm /tmp/ssv.env`.
- 마이그레이션 번호: 이 브랜치는 105까지 있다. 원래 작업 폴더에 커밋 안 된 `106_ig_dm.sql`이 있으므로 **107부터** 쓴다.
- 테스트 DB 모킹 패턴: `vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: () => ({ query: mockQuery }) }))`, `mockQuery`는 `vi.hoisted`로 선언.
- 🔴 **사용자 승인 게이트**가 붙은 단계는 멈추고 사용자에게 묻는다(운영 배포 · 외부 서비스 설정 변경 · 테이블 삭제).

## File Structure

| 파일 | 역할 |
|---|---|
| Create `supabase/migrations/107_erp_job_runs.sql` | `erp` 스키마 + `job_runs` 테이블 |
| Create `scripts/apply-migration.mjs` | 마이그레이션 1개를 `SUPABASE_DB_URL`에 트랜잭션으로 적용(실패 시 롤백·비정상 종료) |
| Create `src/lib/jobs/mask.ts` | 로그·알림용 개인정보 마스킹 |
| Create `src/lib/jobs/run-log.ts` | `withJobRun()` — 작업 시작/종료 기록, 실패 시 텔레그램 |
| Modify `src/app/api/cron/stock-sync/route.ts` | `withJobRun`으로 감싼다 |
| Create `supabase/migrations/108_pg_cron_stock_sync.sql` | `pg_cron`·`pg_net` 활성화 + 품절 동기화 스케줄 |
| Create `scripts/ops/set-cron-secrets.mjs` | Vault에 `app_url`·`cron_secret` 저장(값 비출력) |
| Modify `.github/workflows/stock-sync.yml` | `schedule` 제거(수동 실행만 유지) |
| Modify `vercel.json` | 소싱 cron 7개 제거 |
| Create `scripts/ops/investcock-tables.txt` | 투자콕 테이블 50개 목록(이전 대상의 단일 출처) |
| Create `scripts/ops/investcock-dump.sh` | 50개 테이블 `pg_dump` → 외장 SSD |
| Create `scripts/ops/compare-rowcounts.mjs` | 두 DB의 테이블별 행 수 대조 |
| Create `scripts/ops/investcock-drop.sql` | 셀러 DB에서 50개 삭제(게이트 뒤에서만 실행) |
| Tests `src/__tests__/lib/jobs/mask.test.ts`, `src/__tests__/lib/jobs/run-log.test.ts`, `src/__tests__/api/cron-stock-sync.test.ts`, `src/__tests__/config/vercel-crons.test.ts` | |

---

### Task 1: `erp` 스키마와 `job_runs` 테이블

**Files:**
- Create: `supabase/migrations/107_erp_job_runs.sql`
- Create: `scripts/apply-migration.mjs`

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- 107_erp_job_runs.sql
-- ERP 재구성 0단계: 모든 예약 작업의 실행 기록.
-- 스케줄러가 실제로 제시각에 도는지(GitHub Actions는 5~6시간 간격으로 밀렸다)를 이 표로 잰다.
create schema if not exists erp;

create table if not exists erp.job_runs (
  id           bigserial primary key,
  job          text        not null,               -- 예: 'stock-sync'
  trigger      text        not null default 'cron', -- 'cron' | 'manual'
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text        not null default 'running'
               check (status in ('running', 'ok', 'failed')),
  counts       jsonb       not null default '{}'::jsonb,
  error        text                                  -- mask.ts를 거친 값만 넣는다
);

create index if not exists job_runs_job_started_idx on erp.job_runs (job, started_at desc);

alter table erp.job_runs enable row level security;  -- 서버는 service role/직접 접속만 쓴다
```

- [ ] **Step 2: 적용 스크립트 작성**

```js
// scripts/apply-migration.mjs
// 사용법: node scripts/apply-migration.mjs 107
// SUPABASE_DB_URL에 마이그레이션 하나를 트랜잭션으로 적용한다. 실패하면 롤백하고 exit 1.
// (scripts/migrate-sourcing.mjs는 오류를 삼키고 계속 진행해서 재사용하지 않는다)
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const num = process.argv[2];
if (!num) { console.error('번호를 지정하세요. 예) node scripts/apply-migration.mjs 107'); process.exit(1); }
const dir = path.join(root, 'supabase', 'migrations');
const file = fs.readdirSync(dir).find((f) => f.startsWith(num + '_'));
if (!file) { console.error(`${num}_*.sql 없음`); process.exit(1); }

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('begin');
  await client.query(fs.readFileSync(path.join(dir, file), 'utf-8'));
  await client.query('commit');
  console.log(`✅ ${file}`);
} catch (e) {
  await client.query('rollback');
  console.error(`❌ ${file}: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
```

- [ ] **Step 3: 적용**

Run: `node scripts/apply-migration.mjs 107`
Expected: `✅ 107_erp_job_runs.sql`

- [ ] **Step 4: 확인**

Run:
```bash
node -e "
const fs=require('fs');const {Client}=require('pg');for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)\$/);if(m)process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
(async()=>{const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();
console.log((await c.query(\"select column_name from information_schema.columns where table_schema='erp' and table_name='job_runs' order by ordinal_position\")).rows.map(r=>r.column_name).join(','));await c.end()})()"
```
Expected: `id,job,trigger,started_at,finished_at,status,counts,error`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/107_erp_job_runs.sql scripts/apply-migration.mjs
git commit -m "feat(erp): erp 스키마와 job_runs 작업 기록 테이블"
```

---

### Task 2: 개인정보 마스킹

**Files:**
- Create: `src/lib/jobs/mask.ts`
- Test: `src/__tests__/lib/jobs/mask.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/__tests__/lib/jobs/mask.test.ts
import { describe, it, expect } from 'vitest';
import { maskPII } from '@/lib/jobs/mask';

describe('maskPII', () => {
  it('휴대전화 번호 가운데를 가린다', () => {
    expect(maskPII('수취인 010-1234-5678 연락')).toBe('수취인 010-****-5678 연락');
    expect(maskPII('01012345678')).toBe('010****5678');
  });
  it('이메일 로컬파트를 가린다', () => {
    expect(maskPII('buyer.kim@example.com 오류')).toBe('b***@example.com 오류');
  });
  it('Bearer 토큰과 쿼리 비밀값을 가린다', () => {
    expect(maskPII('Authorization: Bearer abc.def-123')).toBe('Authorization: Bearer ***');
    expect(maskPII('https://x.io/a?secret=zz9&b=1')).toBe('https://x.io/a?secret=***&b=1');
  });
  it('500자로 자른다', () => {
    expect(maskPII('a'.repeat(600))).toHaveLength(500);
  });
  it('가릴 것이 없으면 그대로 둔다', () => {
    expect(maskPII('쿠팡 429 Too Many Requests')).toBe('쿠팡 429 Too Many Requests');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/jobs/mask.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/jobs/mask"`

- [ ] **Step 3: 구현**

```ts
// src/lib/jobs/mask.ts
/**
 * 작업 로그·텔레그램에 남기기 전에 개인정보와 비밀값을 가린다.
 * 주문 수집이 붙으면 오류 메시지에 수취인 연락처가 섞여 들어올 수 있다 — 기록 전에 반드시 거친다.
 */
const MAX_LEN = 500;

export function maskPII(input: string): string {
  return input
    .replace(/(01[016789])(-?)(\d{3,4})(-?)(\d{4})/g, (_m, a, s1, _mid, s2, d) => `${a}${s1}****${s2}${d}`)
    .replace(/([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '$1***@$2')
    .replace(/(Bearer\s+)\S+/gi, '$1***')
    .replace(/([?&](?:secret|token|key|signature)=)[^&\s]+/gi, '$1***')
    .slice(0, MAX_LEN);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/jobs/mask.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/mask.ts src/__tests__/lib/jobs/mask.test.ts
git commit -m "feat(jobs): 작업 로그용 개인정보·비밀값 마스킹"
```

---

### Task 3: `withJobRun` 작업 기록 래퍼

**Files:**
- Create: `src/lib/jobs/run-log.ts`
- Test: `src/__tests__/lib/jobs/run-log.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/__tests__/lib/jobs/run-log.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery, mockSend } = vi.hoisted(() => ({ mockQuery: vi.fn(), mockSend: vi.fn() }));
vi.mock('@/lib/sourcing/db', () => ({ getSourcingPool: () => ({ query: mockQuery }) }));
vi.mock('@/lib/telegram/client', () => ({ sendTelegramMessage: mockSend }));

import { withJobRun } from '@/lib/jobs/run-log';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('JOB_ALERT_TELEGRAM_CHAT_ID', 'chat-1');
  mockQuery.mockImplementation(async (sql: string) =>
    sql.startsWith('insert') ? { rows: [{ id: 42 }] } : { rows: [] },
  );
});

describe('withJobRun', () => {
  it('성공하면 running 행을 만들고 ok와 counts로 닫는다', async () => {
    const result = await withJobRun('stock-sync', async () => ({ value: 'done', counts: { changes: 2 } }));

    expect(result).toBe('done');
    expect(mockQuery.mock.calls[0][0]).toMatch(/^insert into erp\.job_runs/);
    expect(mockQuery.mock.calls[0][1]).toEqual(['stock-sync', 'cron']);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toMatch(/^update erp\.job_runs/);
    expect(params).toEqual([42, 'ok', JSON.stringify({ changes: 2 }), null]);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('실패하면 마스킹한 오류로 failed를 남기고 텔레그램을 보낸 뒤 다시 던진다', async () => {
    await expect(
      withJobRun('stock-sync', async () => { throw new Error('수취인 010-1234-5678 조회 실패'); }),
    ).rejects.toThrow('조회 실패');

    const params = mockQuery.mock.calls[1][1];
    expect(params[1]).toBe('failed');
    expect(params[3]).toBe('수취인 010-****-5678 조회 실패');
    expect(mockSend).toHaveBeenCalledWith('chat-1', '🔴 작업 실패 [stock-sync]: 수취인 010-****-5678 조회 실패');
  });

  it('trigger를 넘기면 그대로 기록한다', async () => {
    await withJobRun('stock-sync', async () => ({ value: 1, counts: {} }), { trigger: 'manual' });
    expect(mockQuery.mock.calls[0][1]).toEqual(['stock-sync', 'manual']);
  });

  it('기록 DB가 실패해도 작업 결과는 돌려준다', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    const result = await withJobRun('stock-sync', async () => ({ value: 'still', counts: {} }));
    expect(result).toBe('still');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/jobs/run-log.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/jobs/run-log"`

- [ ] **Step 3: 구현**

```ts
// src/lib/jobs/run-log.ts
import { getSourcingPool } from '@/lib/sourcing/db';
import { sendTelegramMessage } from '@/lib/telegram/client';
import { maskPII } from './mask';

export interface JobOutcome<T> {
  value: T;
  counts: Record<string, number>;
}

/**
 * 예약 작업 한 번을 erp.job_runs에 남긴다.
 *
 * 스케줄러가 제시각에 도는지, 무엇이 실패했는지를 한 표에서 보려고 만들었다.
 * 기록 자체가 실패해도 작업은 막지 않는다 — 로그 때문에 품절 동기화가 멈추면 주객전도다.
 */
export async function withJobRun<T>(
  job: string,
  fn: () => Promise<JobOutcome<T>>,
  opts: { trigger?: 'cron' | 'manual' } = {},
): Promise<T> {
  const pool = getSourcingPool();
  let runId: number | null = null;
  try {
    const { rows } = await pool.query(
      'insert into erp.job_runs (job, trigger) values ($1, $2) returning id',
      [job, opts.trigger ?? 'cron'],
    );
    runId = rows[0]?.id ?? null;
  } catch (e) {
    console.error('[job_runs] 시작 기록 실패:', e);
  }

  const finish = async (status: 'ok' | 'failed', counts: Record<string, number>, error: string | null) => {
    if (runId === null) return;
    try {
      await pool.query(
        'update erp.job_runs set finished_at = now(), status = $2, counts = $3::jsonb, error = $4 where id = $1',
        [runId, status, JSON.stringify(counts), error],
      );
    } catch (e) {
      console.error('[job_runs] 종료 기록 실패:', e);
    }
  };

  try {
    const { value, counts } = await fn();
    await finish('ok', counts, null);
    return value;
  } catch (e: unknown) {
    const msg = maskPII(e instanceof Error ? e.message : String(e));
    await finish('failed', {}, msg);
    const chatId = process.env.JOB_ALERT_TELEGRAM_CHAT_ID ?? '';
    if (chatId) await sendTelegramMessage(chatId, `🔴 작업 실패 [${job}]: ${msg}`);
    throw e;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/jobs/run-log.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/run-log.ts src/__tests__/lib/jobs/run-log.test.ts
git commit -m "feat(jobs): withJobRun — 예약 작업 실행 기록과 실패 경보"
```

---

### Task 4: 품절 동기화 라우트를 작업 기록으로 감싸기

**Files:**
- Modify: `src/app/api/cron/stock-sync/route.ts`
- Test: `src/__tests__/api/cron-stock-sync.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/__tests__/api/cron-stock-sync.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockRun, mockWith } = vi.hoisted(() => ({
  mockRun: vi.fn(),
  mockWith: vi.fn(async (_job: string, fn: () => Promise<{ value: unknown }>) => (await fn()).value),
}));
vi.mock('@/lib/stock-sync/run', () => ({ runStockSync: mockRun, formatSyncReport: () => 'report' }));
vi.mock('@/lib/jobs/run-log', () => ({ withJobRun: mockWith }));
vi.mock('@/lib/telegram/client', () => ({ sendTelegramMessage: vi.fn() }));

const req = (qs = '') =>
  new NextRequest(`http://localhost/api/cron/stock-sync${qs}`, { headers: { authorization: 'Bearer s3cret' } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.stubEnv('CRON_SECRET', 's3cret');
  mockRun.mockResolvedValue({ dryRun: false, links: 10, changes: [{}, {}], errors: [] });
});

describe('GET /api/cron/stock-sync', () => {
  it('비밀값이 틀리면 401이고 작업을 기록하지 않는다', async () => {
    const { GET } = await import('@/app/api/cron/stock-sync/route');
    const res = await GET(new NextRequest('http://localhost/api/cron/stock-sync', { headers: { authorization: 'Bearer x' } }));
    expect(res.status).toBe(401);
    expect(mockWith).not.toHaveBeenCalled();
  });

  it('stock-sync 작업으로 기록하고 counts에 링크·변경·오류 수를 넘긴다', async () => {
    const { GET } = await import('@/app/api/cron/stock-sync/route');
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(mockWith).toHaveBeenCalledWith('stock-sync', expect.any(Function), { trigger: 'cron' });
    const outcome = await mockWith.mock.calls[0][1]();
    expect(outcome.counts).toEqual({ links: 10, changes: 2, errors: 0 });
  });

  it('dryRun 호출은 manual로 기록한다', async () => {
    const { GET } = await import('@/app/api/cron/stock-sync/route');
    await GET(req('?dryRun=1'));
    expect(mockWith).toHaveBeenCalledWith('stock-sync', expect.any(Function), { trigger: 'manual' });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/api/cron-stock-sync.test.ts`
Expected: FAIL — `mockWith` 호출 0회 (라우트가 아직 `withJobRun`을 쓰지 않는다)

- [ ] **Step 3: 라우트 수정** — 파일 전체를 아래로 바꾼다

```ts
// src/app/api/cron/stock-sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { runStockSync, formatSyncReport } from '@/lib/stock-sync/run';
import { sendTelegramMessage } from '@/lib/telegram/client';
import { withJobRun } from '@/lib/jobs/run-log';

/** 쿠팡 옵션 140여 개 조회 + 네이버 상세 700ms 간격이라 60초를 넘긴다 */
export const maxDuration = 300;

/**
 * GET /api/cron/stock-sync — 쿠팡 Wing에서 못 파는 옵션을 네이버·토스에서 품절 처리
 *
 * 호출은 Supabase pg_cron(supabase/migrations/108_pg_cron_stock_sync.sql)이 3시간마다 한다.
 * GitHub Actions 스케줄은 5~6시간 간격으로 밀려(2026-09-25 실측) 수동 실행용으로만 남겼다.
 * 실행 기록은 erp.job_runs에 남는다(withJobRun).
 *
 * `?dryRun=1`이면 판정만 하고 아무것도 바꾸지 않는다.
 * 텔레그램은 바뀐 것이나 오류가 있을 때만 보낸다 — 3시간마다 「변화 없음」이 오면 알림을 안 보게 된다.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET ?? '';
  const auth = request.headers.get('authorization') ?? '';
  if (!cronSecret || auth.replace('Bearer ', '') !== cronSecret) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
  const chatId = process.env.STOCK_SYNC_TELEGRAM_CHAT_ID ?? '';

  try {
    const result = await withJobRun(
      'stock-sync',
      async () => {
        const r = await runStockSync({ dryRun });
        return { value: r, counts: { links: r.links, changes: r.changes.length, errors: r.errors.length } };
      },
      { trigger: dryRun ? 'manual' : 'cron' },
    );
    if (chatId && (result.changes.length || result.errors.length)) {
      await sendTelegramMessage(chatId, formatSyncReport(result));
    }
    return NextResponse.json({ success: true, ...result });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (chatId) await sendTelegramMessage(chatId, `🔴 재고 동기화 실패: ${msg}`);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
```

> `CRON_SECRET`을 모듈 상수에서 요청 시점 읽기로 옮긴 것은 테스트의 `vi.stubEnv`가 적용되게 하려는 것이다(다른 라우트의 기존 주석과 같은 이유).

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/api/cron-stock-sync.test.ts src/__tests__/lib/jobs`
Expected: PASS (3 + 9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/stock-sync/route.ts src/__tests__/api/cron-stock-sync.test.ts
git commit -m "feat(stock-sync): 실행을 erp.job_runs에 기록"
```

---

### Task 5: 미사용 소싱 cron 정지

**Files:**
- Modify: `vercel.json`
- Test: `src/__tests__/config/vercel-crons.test.ts`

유지 판정 근거(스펙 「사용자 결정 › 소싱」): 코스트코 가격·세일 수집 3개와 영수증·대시보드 3개만 남긴다. `alerts/cron`은 `sourcing_items`를 읽는 소싱 가격 알림이라 함께 멈춘다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/__tests__/config/vercel-crons.test.ts
import { describe, it, expect } from 'vitest';
import vercel from '../../../vercel.json';

// 2026-09-25 ERP 0단계: 소싱을 쓰지 않아(sourcing_shortlist 마지막 기록 08-01) 이 목록만 남긴다.
// 새 cron은 여기가 아니라 Supabase pg_cron으로 건다(Hobby 플랜 일 1회 제한).
const ALLOWED = [
  '/api/sourcing/costco/cron',
  '/api/sourcing/costco/seasonal',
  '/api/sourcing/costco/naver-prices',
  '/api/cron/refresh-dashboard-metrics',
  '/api/cron/parse-receipts',
  '/api/cron/purge-receipt-images',
];

describe('vercel.json crons', () => {
  it('허용 목록 밖의 cron이 없다', () => {
    const paths = vercel.crons.map((c: { path: string }) => c.path).sort();
    expect(paths).toEqual([...ALLOWED].sort());
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/config/vercel-crons.test.ts`
Expected: FAIL — 13개 경로가 6개 목록과 다름

- [ ] **Step 3: `vercel.json` 수정** — 파일 전체를 아래로 바꾼다

```json
{
  "crons": [
    { "path": "/api/sourcing/costco/cron", "schedule": "0 21 * * *" },
    { "path": "/api/sourcing/costco/seasonal", "schedule": "0 22 1 * *" },
    { "path": "/api/sourcing/costco/naver-prices", "schedule": "0 22 * * *" },
    { "path": "/api/cron/refresh-dashboard-metrics", "schedule": "0 18 * * *" },
    { "path": "/api/cron/parse-receipts", "schedule": "0 19 * * *" },
    { "path": "/api/cron/purge-receipt-images", "schedule": "30 18 * * *" }
  ]
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/config/vercel-crons.test.ts`
Expected: PASS
(`resolveJsonModule`이 꺼져 있어 import가 실패하면 `import fs from 'fs'` + `JSON.parse(fs.readFileSync('vercel.json','utf8'))`로 바꾼다.)

- [ ] **Step 5: Commit**

```bash
git add vercel.json src/__tests__/config/vercel-crons.test.ts
git commit -m "chore(cron): 미사용 소싱 cron 7개 정지 — 코스트코·영수증·대시보드만 유지"
```

> 소싱 수집 데이터(`inventory_snapshots` 54만 · `sourcing_items` 45만 행 등)의 **삭제는 3단계의 죽은 라우트 정리와 함께** 한다. 지금 지우면 아직 남은 라우트가 오류를 낸다. 스펙 0-3의 「정리」는 이 계획에서 「수집 중지」까지다.

---

### Task 6: 전체 테스트와 1차 배포 🔴 게이트

- [ ] **Step 1: 전체 테스트**

Run: `npx vitest run 2>&1 | tail -5`
Expected: `Tests  13 failed | ...` 이하 (새 테스트 전부 통과, 실패 수가 13을 넘지 않음). 넘으면 멈추고 원인을 찾는다.

- [ ] **Step 2: 타입 검사**

Run: `npx tsc --noEmit 2>&1 | tail -5`
Expected: 출력 없음(오류 0)

- [ ] **Step 3: 🔴 사용자 승인 요청** — 다음을 보여주고 **운영 배포(main 병합) 승인**을 받는다: 커밋 목록(`git log --oneline origin/main..HEAD`), 바뀌는 운영 동작 2가지(① Vercel cron 13 → 6개 ② 품절 동기화가 `erp.job_runs`에 기록). 새 환경변수 `JOB_ALERT_TELEGRAM_CHAT_ID`를 Vercel에 넣을지(값은 기존 `STOCK_SYNC_TELEGRAM_CHAT_ID`와 같게 할지) 함께 묻는다.

- [ ] **Step 4: 승인 후 배포**

```bash
git push origin feature/erp-restructure
gh pr create --base main --head feature/erp-restructure --title "ERP 0단계: 작업 로그·소싱 cron 정지" --body "스펙 docs/superpowers/specs/2026-09-25-erp-restructure-design.md 0단계 1부"
```
사용자가 PR 병합을 승인하면 `gh pr merge --merge`. Vercel 운영 배포 완료를 `npx vercel ls --prod | head -3`으로 확인한다.

- [ ] **Step 5: 운영 수동 실행으로 기록 확인**

GitHub 수동 실행(드라이런): `gh workflow run stock-sync.yml -f dry_run=true`, 2분 뒤:
```bash
node -e "
const fs=require('fs');const {Client}=require('pg');for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)\$/);if(m)process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
(async()=>{const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();
console.log((await c.query('select job,trigger,status,counts,started_at from erp.job_runs order by id desc limit 3')).rows);await c.end()})()"
```
Expected: `stock-sync | manual | ok | {links, changes, errors}` 한 행

---

### Task 7: 품절 동기화를 `pg_cron`으로 이전 🔴 게이트

**Files:**
- Create: `scripts/ops/set-cron-secrets.mjs`
- Create: `supabase/migrations/108_pg_cron_stock_sync.sql`
- Modify: `.github/workflows/stock-sync.yml`

- [ ] **Step 1: Vault 비밀값 저장 스크립트**

```js
// scripts/ops/set-cron-secrets.mjs
// 사용법: node scripts/ops/set-cron-secrets.mjs /tmp/ssv.env
// Vercel 운영 env 파일에서 APP_URL·CRON_SECRET을 읽어 Supabase Vault에 저장(있으면 갱신). 값은 출력하지 않는다.
import pg from 'pg';
import fs from 'fs';

const read = (p) => Object.fromEntries(
  fs.readFileSync(p, 'utf-8').split('\n')
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '').trim()]),
);
const prod = read(process.argv[2]);
const local = read('.env.local');
const want = { app_url: prod.APP_URL, cron_secret: prod.CRON_SECRET };
for (const [k, v] of Object.entries(want)) if (!v) { console.error(`${k} 값이 비었다`); process.exit(1); }

const c = new pg.Client({ connectionString: local.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
for (const [name, value] of Object.entries(want)) {
  const { rows } = await c.query('select id from vault.secrets where name = $1', [name]);
  if (rows.length) await c.query('select vault.update_secret($1, $2)', [rows[0].id, value]);
  else await c.query('select vault.create_secret($1, $2)', [value, name]);
  console.log(`✅ vault.${name} (${value.length}자)`);
}
await c.end();
```

- [ ] **Step 2: 비밀값 저장**

```bash
npx vercel env pull /tmp/ssv.env --environment=production
grep -c -E '^(APP_URL|CRON_SECRET)=' /tmp/ssv.env   # Expected: 2
node scripts/ops/set-cron-secrets.mjs /tmp/ssv.env
rm /tmp/ssv.env
```
Expected: `✅ vault.app_url (…자)` / `✅ vault.cron_secret (…자)`. `APP_URL`이 없으면 멈추고 사용자에게 운영 URL을 묻는다(GitHub secret `APP_URL`과 같은 값).

- [ ] **Step 3: 마이그레이션 작성**

```sql
-- 108_pg_cron_stock_sync.sql
-- 품절 동기화 스케줄을 GitHub Actions에서 DB 안의 pg_cron으로 옮긴다.
-- GitHub 예약은 0 */3 * * * 인데 실제 5~6시간 간격이었다(2026-09-25, 최근 16회).
-- URL·비밀값은 Vault(app_url, cron_secret)에서 읽는다 — scripts/ops/set-cron-secrets.mjs로 넣는다.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('stock-sync') where exists (select 1 from cron.job where jobname = 'stock-sync');

select cron.schedule(
  'stock-sync',
  '0 */3 * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/cron/stock-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 300000
  );
  $job$
);
```

- [ ] **Step 4: 🔴 사용자 승인 후 적용** — 「지금부터 운영 품절 동기화를 pg_cron이 호출한다. GitHub 예약은 끈다」를 알리고 승인받는다.

Run: `node scripts/apply-migration.mjs 108`
Expected: `✅ 108_pg_cron_stock_sync.sql`

확장 활성화가 권한 오류로 실패하면 멈추고 사용자에게 Supabase 대시보드 → Database → Extensions에서 `pg_cron`·`pg_net`을 켜 달라고 요청한 뒤 다시 실행한다.

- [ ] **Step 5: 등록 확인**

```bash
node -e "
const fs=require('fs');const {Client}=require('pg');for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)\$/);if(m)process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
(async()=>{const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();
console.log((await c.query(\"select jobname,schedule,active from cron.job\")).rows);await c.end()})()"
```
Expected: `[{ jobname: 'stock-sync', schedule: '0 */3 * * *', active: true }]`

- [ ] **Step 6: GitHub 예약 제거** — `.github/workflows/stock-sync.yml`의 `on:` 블록을 아래로 바꾼다(나머지는 그대로)

```yaml
on:
  # 예약 실행은 Supabase pg_cron으로 옮겼다(supabase/migrations/108_pg_cron_stock_sync.sql).
  # GitHub 예약이 5~6시간 간격으로 밀려서다(2026-09-25 실측). 여기는 수동 드라이런용으로만 남긴다.
  workflow_dispatch:
    inputs:
      dry_run:
        description: '드라이런 (판정만, 변경 없음)'
        type: boolean
        default: true
```

- [ ] **Step 6b: 수동 실행을 manual로 기록** — 같은 파일 `run:` 블록의 curl URL을 `"$APP_URL/api/cron/stock-sync?dryRun=$DRY&trigger=manual"`로 바꾼다(이제 이 워크플로는 수동 전용이다 · Task 4 리뷰 지적).

- [ ] **Step 7: Commit + PR 병합(Task 6 승인 범위 안)**

```bash
git add scripts/ops/set-cron-secrets.mjs supabase/migrations/108_pg_cron_stock_sync.sql .github/workflows/stock-sync.yml
git commit -m "feat(cron): 품절 동기화 스케줄을 pg_cron으로 이전, GitHub 예약 제거"
git push origin feature/erp-restructure
```

---

### Task 8: 24시간 간격 검증 (verification-before-completion)

- [ ] **Step 1: 적용 24시간 뒤 실행 간격 조회**

```bash
node -e "
const fs=require('fs');const {Client}=require('pg');for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)\$/);if(m)process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
(async()=>{const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();
const r=(await c.query(\"select started_at,status, extract(epoch from started_at - lag(started_at) over (order by started_at))/3600 as gap_h from erp.job_runs where job='stock-sync' and trigger='cron' and started_at > now()-interval '26 hours' order by started_at\")).rows;
console.table(r);await c.end()})()"
```
Expected: 8행 전후, `status` 전부 `ok`, `gap_h`가 모두 **2.9~3.1**. 하나라도 어긋나면 `select * from net._http_response order by id desc limit 5`로 응답 코드를 보고 원인을 찾는다.

- [ ] **Step 2: 결과를 사용자에게 보고** — 이전(5~6시간)과 이후 간격을 표로.

---

### Task 9: 투자콕 테이블 이전 — 준비 (사용자 작업 포함)

**Files:**
- Create: `scripts/ops/investcock-tables.txt`
- Create: `scripts/ops/investcock-dump.sh`
- Create: `scripts/ops/compare-rowcounts.mjs`

- [ ] **Step 1: 테이블 목록 (투자콕 `backend/models.py`의 `__tablename__` 50개, 2026-09-25 추출)**

```text
users
api_keys
portfolios
holdings
rebalance_logs
trade_journals
refresh_tokens
ai_analysis_results
login_attempts
kis_tokens
account_settings
tax_profiles
tax_account_snapshots
tax_contributions
investment_plans
ic_rules
ic_budget_events
ic_llm_call_logs
ic_user_phase_selections
rebalance_snapshots
snapshot_actions
deposit_logs
recommend_universe
recommend_factor_snapshot
agent_debates
recommendations
recommendation_scores
backtest_runs
backtest_windows
backtest_equity_curve
backtest_trades
macro_indicators
regime_history
user_risk_profiles
user_cash_needs
user_tax_info
ticker_signals_daily
market_signals_daily
decision_journal
decision_reviews
paper_portfolio
paper_position
paper_trade
paper_trade_review
paper_learning
telegram_config
job_run_log
watchlists
watch_alerts
weekly_screener_picks
```

- [ ] **Step 2: 셀러 앱이 이 테이블을 참조하지 않는지 재확인**

```bash
while read t; do
  n=$(grep -rlE "from\(\s*['\"]$t['\"]|(FROM|INTO|UPDATE|JOIN)\s+\"?$t\b" src --include='*.ts' --include='*.tsx' 2>/dev/null | grep -v __tests__ | wc -l | tr -d ' ')
  [ "$n" != "0" ] && echo "⚠️ $t: $n"
done < scripts/ops/investcock-tables.txt; echo done
```
Expected: `done` 한 줄만(경고 없음). 경고가 나오면 멈추고 사용자에게 보고한다.

- [ ] **Step 3: 덤프 스크립트**

```bash
#!/usr/bin/env bash
# scripts/ops/investcock-dump.sh — 투자콕 50개 테이블을 스키마+데이터로 덤프한다.
# 사용법: bash scripts/ops/investcock-dump.sh   → 경로를 출력한다
set -euo pipefail
cd "$(dirname "$0")/../.."
DB_URL=$(grep -E '^SUPABASE_DB_URL=' .env.local | cut -d= -f2- | sed -E "s/^[\"']|[\"']$//g")
OUT_DIR=/Volumes/Mac_SSD/backups/investcock
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/investcock-$(date +%Y%m%d-%H%M).sql"
ARGS=()
while read -r t; do [ -n "$t" ] && ARGS+=(-t "public.$t"); done < scripts/ops/investcock-tables.txt
pg_dump "$DB_URL" --no-owner --no-privileges --no-publications --no-subscriptions "${ARGS[@]}" -f "$OUT"
echo "$OUT ($(du -h "$OUT" | cut -f1))"
```

- [ ] **Step 4: 행 수 대조 스크립트**

```js
// scripts/ops/compare-rowcounts.mjs
// 사용법: node scripts/ops/compare-rowcounts.mjs "<대상 DB URL 환경변수 이름>"
// 셀러 DB(SUPABASE_DB_URL)와 대상 DB의 투자콕 테이블 행 수를 비교한다. 하나라도 다르면 exit 1.
import pg from 'pg';
import fs from 'fs';

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf-8').split('\n')
  .map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean)
  .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const targetKey = process.argv[2];
if (!env[targetKey]) { console.error(`.env.local에 ${targetKey}가 없다`); process.exit(1); }
const tables = fs.readFileSync('scripts/ops/investcock-tables.txt', 'utf-8').split('\n').filter(Boolean);

const count = async (url) => {
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const out = {};
  for (const t of tables) out[t] = Number((await c.query(`select count(*) from public."${t}"`)).rows[0].count);
  await c.end();
  return out;
};
const [src, dst] = await Promise.all([count(env.SUPABASE_DB_URL), count(env[targetKey])]);
const diff = tables.filter((t) => src[t] !== dst[t]);
for (const t of diff) console.log(`❌ ${t}: 원본 ${src[t]} / 대상 ${dst[t]}`);
console.log(`${tables.length - diff.length}/${tables.length} 일치`);
process.exitCode = diff.length ? 1 : 0;
```

- [ ] **Step 5: Commit**

```bash
chmod +x scripts/ops/investcock-dump.sh
git add scripts/ops/investcock-tables.txt scripts/ops/investcock-dump.sh scripts/ops/compare-rowcounts.mjs
git commit -m "chore(ops): 투자콕 테이블 이전 도구 — 목록·덤프·행 수 대조"
```

- [ ] **Step 6: 🔴 사용자 작업 요청** — 다음을 안내하고 완료를 기다린다(계정·조직 생성은 사용자가 직접 한다):
  1. Supabase 대시보드에서 **새 조직(Free 플랜)** 생성 → 그 안에 프로젝트 `investcock` 생성, 리전 `ap-northeast-2`(서울). 생성 전 요금 페이지에서 Free 조직 프로젝트가 과금되지 않는지 확인.
  2. 새 프로젝트 → Connect → **Session pooler** 연결 문자열을 복사해 `.env.local`에 `INVESTCOCK_DB_URL=...`로 추가(채팅에 붙여넣지 않는다).

---

### Task 10: 투자콕 테이블 이전 — 복원·전환·삭제 🔴 게이트

- [ ] **Step 1: 이전 시점 정하기** — 투자콕 `daily_watch`·`weekly_screener`가 막 끝난 뒤가 좋다. 마지막 실행을 본다:

```bash
node -e "
const fs=require('fs');const {Client}=require('pg');for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)\$/);if(m)process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
(async()=>{const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});await c.connect();
console.log((await c.query('select job_name,max(started_at) from job_run_log group by 1')).rows);await c.end()})()"
```

- [ ] **Step 2: 덤프**

Run: `bash scripts/ops/investcock-dump.sh`
Expected: `/Volumes/Mac_SSD/backups/investcock/investcock-YYYYMMDD-HHMM.sql (약 5M)`. SSD가 없으면 멈춘다.

- [ ] **Step 3: 새 DB에 복원**

```bash
DUMP=$(ls -t /Volumes/Mac_SSD/backups/investcock/*.sql | head -1)
NEW=$(grep -E '^INVESTCOCK_DB_URL=' .env.local | cut -d= -f2- | sed -E "s/^[\"']|[\"']$//g")
psql "$NEW" -v ON_ERROR_STOP=1 -f "$DUMP" 2>&1 | tail -5
```
Expected: 오류 없이 종료. 확장 누락(`uuid-ossp`·`pgcrypto` 등) 오류가 나면 새 프로젝트에서 `create extension if not exists "<이름>";` 후 새 프로젝트의 public 스키마를 비우고(`drop schema public cascade; create schema public;`) 다시 복원한다.

- [ ] **Step 4: 행 수 대조**

Run: `node scripts/ops/compare-rowcounts.mjs INVESTCOCK_DB_URL`
Expected: `50/50 일치`, exit 0. 다르면(덤프 뒤 투자콕이 기록함) Step 2부터 다시.

- [ ] **Step 5: 🔴 사용자 작업 — 투자콕 접속 정보 교체** (비밀값이라 사용자가 직접 한다)
  1. Render → `investcock-api` → Environment → `DATABASE_URL`을 새 프로젝트 연결 문자열로 교체 → 저장(재배포됨).
  2. GitHub `stan070628/investcock` → Settings → Secrets → `PROD_DATABASE_URL`을 같은 값으로 교체.
  3. 교체 후 셀러 DB에 새로 들어오는 투자콕 기록이 없는지 확인:

```bash
node -e "
const fs=require('fs');const {Client}=require('pg');for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z_]+)=(.*)\$/);if(m)process.env[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
(async()=>{for(const k of ['SUPABASE_DB_URL','INVESTCOCK_DB_URL']){const c=new Client({connectionString:process.env[k],ssl:{rejectUnauthorized:false}});await c.connect();
console.log(k,(await c.query('select max(created_at) watch from watch_alerts')).rows[0],(await c.query('select job_name,max(started_at) from job_run_log group by 1')).rows);await c.end()}})()"
```

- [ ] **Step 6: 새 DB 기록 확인** — 다음 `daily_watch` 또는 `weekly_screener` 실행 뒤 Step 5-3을 다시 돌린다.
Expected: `INVESTCOCK_DB_URL` 쪽 `job_run_log` 최신 시각이 교체 이후이고 `status`가 `ok`. 셀러 DB 쪽은 교체 전 시각에서 멈춤.

- [ ] **Step 7: 삭제 SQL 작성**

```sql
-- scripts/ops/investcock-drop.sql
-- 투자콕 50개 테이블을 셀러 DB에서 지운다. Task 10 Step 6 확인 뒤에만 실행한다.
-- 덤프: /Volumes/Mac_SSD/backups/investcock/ (복원 검증은 새 프로젝트 50/50 일치로 끝났다)
begin;
drop table if exists
  public.users, public.api_keys, public.portfolios, public.holdings, public.rebalance_logs,
  public.trade_journals, public.refresh_tokens, public.ai_analysis_results, public.login_attempts,
  public.kis_tokens, public.account_settings, public.tax_profiles, public.tax_account_snapshots,
  public.tax_contributions, public.investment_plans, public.ic_rules, public.ic_budget_events,
  public.ic_llm_call_logs, public.ic_user_phase_selections, public.rebalance_snapshots,
  public.snapshot_actions, public.deposit_logs, public.recommend_universe,
  public.recommend_factor_snapshot, public.agent_debates, public.recommendations,
  public.recommendation_scores, public.backtest_runs, public.backtest_windows,
  public.backtest_equity_curve, public.backtest_trades, public.macro_indicators,
  public.regime_history, public.user_risk_profiles, public.user_cash_needs, public.user_tax_info,
  public.ticker_signals_daily, public.market_signals_daily, public.decision_journal,
  public.decision_reviews, public.paper_portfolio, public.paper_position, public.paper_trade,
  public.paper_trade_review, public.paper_learning, public.telegram_config, public.job_run_log,
  public.watchlists, public.watch_alerts, public.weekly_screener_picks
  restrict;
commit;
```

> `restrict`: 셀러 테이블이 이 중 하나를 외래키로 참조하면 삭제가 실패하고 트랜잭션 전체가 롤백된다. 그 경우 멈추고 보고한다(`cascade`로 바꾸지 않는다).

- [ ] **Step 8: 🔴 사용자 최종 승인 후 삭제** — 「셀러 DB에서 투자콕 50개 테이블 삭제. 되돌리려면 SSD 덤프 복원」을 알리고 명시적 승인을 받는다.

Run: `psql "$(grep -E '^SUPABASE_DB_URL=' .env.local | cut -d= -f2- | sed -E "s/^[\"']|[\"']$//g")" -v ON_ERROR_STOP=1 -f scripts/ops/investcock-drop.sql`
Expected: `BEGIN` / `DROP TABLE` / `COMMIT`

- [ ] **Step 9: 셀러 앱 회귀 확인**

Run: `npx vitest run 2>&1 | tail -3` → 실패 13 이하. 운영 앱에서 로그인·주문/매출 화면이 뜨는지 사용자에게 확인받는다.

- [ ] **Step 10: Commit**

```bash
git add scripts/ops/investcock-drop.sql
git commit -m "chore(db): 투자콕 50개 테이블을 무료 조직 Supabase로 이전하고 셀러 DB에서 삭제"
git push origin feature/erp-restructure
```

---

### Task 11: 0단계 마무리

- [ ] **Step 1: 스펙 0단계 완료 기준 대조** — 각 항목에 증거를 붙여 보고한다.

| # | 완료 기준 | 증거 |
|---|---|---|
| 0-1 | 복원본 행 수 = 원본 | Task 10 Step 4 `50/50 일치` |
| 0-2 | 다음 투자콕 실행이 새 DB에 `ok` | Task 10 Step 6 |
| 0-3 | Vercel cron 13 → 6 | Task 5 테스트 + 운영 배포 |
| 0-4 | 24시간 3시간 간격 준수 | Task 8 표 |

- [ ] **Step 2: superpowers:requesting-code-review로 0단계 전체 리뷰**

- [ ] **Step 3: 위키 갱신 요청** — 결과를 사용자에게 보고하고, 위키(`[[스마트셀러스튜디오 ERP 재구성 설계 2026-09-25]]` · `[[판매 채널 API의 아웃바운드 IP 제약]]` · `[[인프라 고정비 원장]]`)와 `log.md` 반영은 메인 세션이 한다.

---

## 실행 중 나온 후속 항목 (0단계 범위 밖 — 다음 단계 계획에 넣는다)

| # | 항목 | 출처 |
|---|---|---|
| F1 | 타임아웃으로 죽은 실행이 `running`으로 남는다 → 다음 `withJobRun` 시작 시 같은 job의 15분 넘은 `running`을 `failed`로 닫고 경보 | Task 3 리뷰 Minor 2 |
| F2 | 쿠팡 조회가 **전부** 실패해도 품절 동기화가 `ok`로 기록되고 경보가 없다(`run.ts`가 조회 실패를 `errors`로만 쌓음) → 「전부 실패」를 `failed`로 올릴지 · 중복 경보(JOB_ALERT vs STOCK_SYNC chat)와 함께 **Task 6에서 사용자 결정** | Task 4 리뷰 Important 1 |
| F3 | A11 「전송 실패」 카드 집계 기준: `status='failed' OR (counts->>'errors')::int > 0` | Task 4 리뷰 |
| F4 | 동기화 성공 뒤 보고 텔레그램 전송이 던지면 route가 500·「실패」 알림을 보내지만 job_runs는 `ok` — 경보 경로 정리 때 함께 | Task 4 재검토 |
| F5 | `sendTelegramMessage` fetch에 타임아웃 없음(`AbortSignal.timeout(5_000)`) | Task 3 리뷰 Minor 4 |
| F6 | `erp.job_runs.trigger`에 check 제약 없음 — 필요 시 새 마이그레이션 | Task 1 리뷰 Minor 6 |
