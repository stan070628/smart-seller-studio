# 인스타 댓글→DM Edge Function 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인스타 댓글 키워드 웹훅을 Supabase Edge Function으로 받아 비공개 답장 DM을 보내고 로그를 남긴다. Vercel(Next.js 라우트)은 폐기한다.

**Architecture:** 순수 로직(`dm.ts`) → 요청 처리(`handler.ts`, 의존성 주입) → Deno 진입점(`index.ts`) 3층. `handler.ts`까지는 Web 표준 API만 써서 Node 24 vitest로 검증하고, Supabase 클라이언트는 `store.ts`에 격리해 Deno에서만 로드한다. 스펙: `docs/superpowers/specs/2026-09-25-ig-dm-edge-function-design.md`.

**Tech Stack:** Supabase Edge Functions (Deno, TypeScript), Web Crypto HMAC-SHA256, `@supabase/supabase-js` (npm: specifier), vitest, psql.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `supabase/functions/ig-webhook/dm.ts` | 서명 검증·이벤트 추출·규칙 매칭·문구 생성·발송 호출. 순수 함수 + fetch 1개 |
| `supabase/functions/ig-webhook/handler.ts` | `handle(req, deps)`. GET 검증·POST 처리 흐름. `Store` 인터페이스 정의 |
| `supabase/functions/ig-webhook/store.ts` | `Store`의 Supabase 구현. Deno 전용 (`npm:` import) |
| `supabase/functions/ig-webhook/index.ts` | `Deno.serve`. 환경변수 읽어 `handle`에 주입 |
| `supabase/config.toml` | `verify_jwt = false` 고정 |
| `src/__tests__/lib/instagram-dm.test.ts` | dm.ts 단위 테스트 (기존 15개, import 경로와 async만 수정) |
| `src/__tests__/lib/instagram-webhook-handler.test.ts` | handler.ts 테스트 (가짜 Store·fetch) |
| `tsconfig.json` | `supabase/functions`를 Next 타입체크에서 제외 |
| 삭제: `src/app/api/instagram/`, `src/lib/instagram/` | Vercel 라우트 폐기 |

---

### Task 1: dm.ts 이식 (Web Crypto)

**Files:**
- Create: `supabase/functions/ig-webhook/dm.ts`
- Modify: `src/__tests__/lib/instagram-dm.test.ts`
- Modify: `tsconfig.json`

- [ ] **Step 1: tsconfig에서 Edge Function 디렉토리 제외**

`tsconfig.json`의 `exclude` 배열에 `"supabase/functions"` 추가. Deno 전역과 `npm:` 지정자가 Next 타입체크에 걸리지 않게 한다.

- [ ] **Step 2: 기존 테스트를 새 위치로 돌리고 서명 검증을 async로 바꾼다**

`src/__tests__/lib/instagram-dm.test.ts` 첫 줄에 환경 지정을 넣고 import 경로를 바꾼다. jsdom에서는 `crypto.subtle`이 보장되지 않는다.

```ts
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import {
  verifySignature, extractComments, matchRule, isOwnComment, buildMessage, sendPrivateReply,
  normalize, DISCLOSURE, DEFAULT_HEAD, type DmRule, type CommentEvent,
} from '../../../supabase/functions/ig-webhook/dm';
```

`verifySignature` 블록을 async로:

```ts
describe('verifySignature', () => {
  const secret = 's3cret';
  const raw = '{"object":"instagram"}';
  const good = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  it('맞는 서명은 통과', async () => expect(await verifySignature(raw, good, secret)).toBe(true));
  it('바디가 1바이트라도 다르면 실패', async () => expect(await verifySignature(raw + ' ', good, secret)).toBe(false));
  it('헤더 없음·형식 틀림은 실패', async () => {
    expect(await verifySignature(raw, null, secret)).toBe(false);
    expect(await verifySignature(raw, 'sha1=abc', secret)).toBe(false);
    expect(await verifySignature(raw, 'sha256=zz', secret)).toBe(false);
  });
});
```

`sendPrivateReply` 테스트의 기본 버전 기대값이 `v23.0`이면 `v25.0`으로 바꾼다.

- [ ] **Step 3: 테스트 실행 → 실패 확인**

Run: `npx vitest run src/__tests__/lib/instagram-dm.test.ts`
Expected: FAIL — 모듈을 찾을 수 없음

- [ ] **Step 4: dm.ts 작성**

`src/lib/instagram/dm.ts`를 복사해 `verifySignature`만 교체하고 기본 버전을 `v25.0`으로 올린다.

```ts
// ─── 서명 검증 ────────────────────────────────────────

const enc = new TextEncoder();

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 길이가 같을 때만 상수 시간 비교. 길이가 다르면 즉시 false. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(원문 바디, 앱 시크릿).
 * JSON 파싱 전 원문 문자열로 검증해야 한다 — 재직렬화하면 바이트가 달라진다.
 */
export async function verifySignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = await hmacSha256Hex(appSecret, rawBody);
  return constantTimeEqual(header.slice('sha256='.length).toLowerCase(), expected);
}
```

나머지(`extractComments`·`normalize`·`matchRule`·`isOwnComment`·`DISCLOSURE`·`DEFAULT_HEAD`·`buildMessage`·`sendPrivateReply`·타입)는 원본 그대로. `import crypto from 'node:crypto'` 줄은 지운다. `sendPrivateReply`의 `opts.version || 'v23.0'`을 `'v25.0'`으로.

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `npx vitest run src/__tests__/lib/instagram-dm.test.ts`
Expected: 15 passed

- [ ] **Step 6: 커밋**

```bash
git add tsconfig.json supabase/functions/ig-webhook/dm.ts src/__tests__/lib/instagram-dm.test.ts
git commit -m "feat(ig-dm): 순수 로직을 Edge Function 디렉토리로 이식하고 Web Crypto로 서명 검증"
```

---

### Task 2: handler.ts (요청 처리, 의존성 주입)

**Files:**
- Create: `supabase/functions/ig-webhook/handler.ts`
- Test: `src/__tests__/lib/instagram-webhook-handler.test.ts`

- [ ] **Step 1: 테스트 작성**

```ts
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import { handle, type Store, type Env } from '../../../supabase/functions/ig-webhook/handler';
import type { DmRule } from '../../../supabase/functions/ig-webhook/dm';

const env: Env = { IG_APP_SECRET: 'sec', IG_VERIFY_TOKEN: 'vt', IG_ACCESS_TOKEN: 'tok', IG_USER_ID: '100' };
const URL_ = 'https://x.supabase.co/functions/v1/ig-webhook';

const rule = (o: Partial<DmRule> = {}): DmRule => ({
  id: 1, keyword: '텐트', media_id: null, link_url: 'https://link.coupang.com/a/x',
  link_type: 'partners', message: null, label: null, active: true, ...o,
});

/** 메모리 Store. claimed에 이미 있으면 PK 충돌을 흉내 낸다 */
function fakeStore(rules: DmRule[], claimed: string[] = []) {
  const logs: Record<string, any> = {};
  for (const c of claimed) logs[c] = { status: 'sent' };
  const store: Store = {
    loadActiveRules: async () => ({ data: rules, error: null }),
    claimLog: async (row) => {
      if (logs[row.comment_id]) return { error: { code: '23505', message: 'duplicate key' } };
      logs[row.comment_id] = row; return { error: null };
    },
    updateLog: async (id, patch) => { Object.assign(logs[id], patch); return { error: null }; },
  };
  return { store, logs };
}

function commentBody(text: string, o: { commenter?: string; media?: string; comment?: string } = {}) {
  return JSON.stringify({
    object: 'instagram',
    entry: [{ id: '100', time: 1, changes: [{ field: 'comments', value: {
      from: { id: o.commenter ?? '200', username: 'buyer' },
      media: { id: o.media ?? 'm1', media_product_type: 'REELS' },
      id: o.comment ?? 'c1', text,
    } }] }],
  });
}

function signed(body: string, secret = 'sec') {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function post(body: string, sig: string | null) {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (sig) h['x-hub-signature-256'] = sig;
  return new Request(URL_, { method: 'POST', headers: h, body });
}

const okFetch = () => vi.fn(async () => new Response('{"recipient_id":"200"}', { status: 200 }));

describe('GET 검증', () => {
  it('토큰이 맞으면 challenge를 돌려준다', async () => {
    const req = new Request(`${URL_}?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=12345`);
    const res = await handle(req, { env, store: fakeStore([]).store, fetch: okFetch() });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('12345');
  });
  it('토큰이 틀리면 403', async () => {
    const req = new Request(`${URL_}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`);
    const res = await handle(req, { env, store: fakeStore([]).store, fetch: okFetch() });
    expect(res.status).toBe(403);
  });
});

describe('POST', () => {
  it('서명이 틀리면 401이고 아무것도 기록하지 않는다', async () => {
    const { store, logs } = fakeStore([rule()]);
    const body = commentBody('텐트');
    const res = await handle(post(body, signed(body, 'wrong')), { env, store, fetch: okFetch() });
    expect(res.status).toBe(401);
    expect(Object.keys(logs)).toHaveLength(0);
  });

  it('키워드 댓글이면 DM을 보내고 sent로 기록한다', async () => {
    const { store, logs } = fakeStore([rule()]);
    const f = okFetch();
    const body = commentBody('텐트 링크 주세요');
    const res = await handle(post(body, signed(body)), { env, store, fetch: f });
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe('https://graph.instagram.com/v25.0/100/messages');
    const sent = JSON.parse(init.body);
    expect(sent.recipient).toEqual({ comment_id: 'c1' });
    expect(sent.message.text).toContain('https://link.coupang.com/a/x');
    expect(sent.message.text).toContain('쿠팡 파트너스');
    expect(logs.c1.status).toBe('sent');
    expect(logs.c1.rule_id).toBe(1);
    expect(logs.c1.commenter_username).toBe('buyer');
  });

  it('규칙에 안 맞는 댓글은 기록도 발송도 없다', async () => {
    const { store, logs } = fakeStore([rule()]);
    const f = okFetch();
    const body = commentBody('예뻐요');
    await handle(post(body, signed(body)), { env, store, fetch: f });
    expect(f).not.toHaveBeenCalled();
    expect(Object.keys(logs)).toHaveLength(0);
  });

  it('이미 처리한 댓글(재전송)은 다시 보내지 않는다', async () => {
    const { store } = fakeStore([rule()], ['c1']);
    const f = okFetch();
    const body = commentBody('텐트');
    const res = await handle(post(body, signed(body)), { env, store, fetch: f });
    expect(res.status).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });

  it('내 계정이 단 댓글은 무시한다', async () => {
    const { store, logs } = fakeStore([rule()]);
    const f = okFetch();
    const body = commentBody('텐트', { commenter: '100' });
    await handle(post(body, signed(body)), { env, store, fetch: f });
    expect(f).not.toHaveBeenCalled();
    expect(Object.keys(logs)).toHaveLength(0);
  });

  it('발송 실패는 failed와 오류 본문으로 남긴다', async () => {
    const { store, logs } = fakeStore([rule()]);
    const f = vi.fn(async () => new Response('{"error":{"message":"(#100) Invalid comment"}}', { status: 400 }));
    const body = commentBody('텐트');
    const res = await handle(post(body, signed(body)), { env, store, fetch: f });
    expect(res.status).toBe(200);
    expect(logs.c1.status).toBe('failed');
    expect(logs.c1.error).toContain('400');
    expect(logs.c1.error).toContain('Invalid comment');
  });

  it('비밀값이 없으면 500', async () => {
    const body = commentBody('텐트');
    const res = await handle(post(body, signed(body)), {
      env: { ...env, IG_ACCESS_TOKEN: '' }, store: fakeStore([]).store, fetch: okFetch(),
    });
    expect(res.status).toBe(500);
  });

  it('JSON이 아니면 200으로 끊는다 (재전송 방지)', async () => {
    const body = 'not-json';
    const res = await handle(post(body, signed(body)), { env, store: fakeStore([]).store, fetch: okFetch() });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx vitest run src/__tests__/lib/instagram-webhook-handler.test.ts`
Expected: FAIL — handler 모듈 없음

- [ ] **Step 3: handler.ts 작성**

```ts
/**
 * 인스타 댓글 키워드 → 자동 DM webhook 처리.
 *
 * GET  : Meta 구독 검증 (hub.challenge 반환)
 * POST : 댓글 이벤트 → 규칙 매칭 → 비공개 답장 → 로그
 *
 * 환경·저장소·fetch를 인자로 받는다. Deno 전역을 쓰지 않으므로 Node 테스트에서 그대로 돈다.
 */
import {
  verifySignature, extractComments, matchRule, isOwnComment, buildMessage, sendPrivateReply,
  type DmRule,
} from './dm.ts';

export interface Env {
  IG_APP_SECRET: string;
  IG_VERIFY_TOKEN: string;
  IG_ACCESS_TOKEN: string;
  IG_USER_ID?: string;
  IG_GRAPH_VERSION?: string;
}

export interface LogRow {
  comment_id: string;
  rule_id: number;
  media_id: string | null;
  commenter_id: string | null;
  commenter_username: string | null;
  comment_text: string;
  status: 'pending' | 'sent' | 'failed';
}

export interface StoreError { code?: string; message: string }

/** DB 접근 최소 인터페이스. store.ts가 Supabase로 구현하고 테스트는 메모리로 흉내 낸다 */
export interface Store {
  loadActiveRules(): Promise<{ data: DmRule[] | null; error: StoreError | null }>;
  /** PK(comment_id) 충돌이면 error.code === '23505' */
  claimLog(row: LogRow): Promise<{ error: StoreError | null }>;
  updateLog(commentId: string, patch: { status: 'sent' | 'failed'; sent_at?: string; error?: string }): Promise<{ error: StoreError | null }>;
}

export interface Deps { env: Env; store: Store; fetch: typeof fetch }

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'GET') return handleVerify(req, deps.env);
  if (req.method === 'POST') return handleEvent(req, deps);
  return text('method not allowed', 405);
}

function handleVerify(req: Request, env: Env): Response {
  const p = new URL(req.url).searchParams;
  const ok = p.get('hub.mode') === 'subscribe' &&
    !!env.IG_VERIFY_TOKEN && p.get('hub.verify_token') === env.IG_VERIFY_TOKEN;
  if (!ok) return text('forbidden', 403);
  return text(p.get('hub.challenge') ?? '', 200);
}

async function handleEvent(req: Request, { env, store, fetch }: Deps): Promise<Response> {
  if (!env.IG_APP_SECRET || !env.IG_ACCESS_TOKEN) {
    console.error('[ig-dm] IG_APP_SECRET / IG_ACCESS_TOKEN 미설정');
    return json({ ok: false }, 500);
  }

  // 서명은 원문으로 검증한다 — JSON 파싱 후 재직렬화하면 바이트가 달라진다
  const raw = await req.text();
  if (!(await verifySignature(raw, req.headers.get('x-hub-signature-256'), env.IG_APP_SECRET))) {
    return json({ ok: false }, 401);
  }

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ ok: true }); }

  const events = extractComments(body).filter((e) => !isOwnComment(e));
  if (!events.length) return json({ ok: true });

  const { data: rules, error: rulesErr } = await store.loadActiveRules();
  if (rulesErr) {
    console.error('[ig-dm] 규칙 조회 실패', rulesErr.message);
    return json({ ok: true }); // 재전송돼도 같은 실패라 200으로 끊는다
  }

  const results: Array<{ comment: string; result: string }> = [];
  for (const ev of events) {
    const rule = matchRule(ev, rules ?? []);
    if (!rule) continue; // 규칙에 안 맞는 댓글은 기록하지 않는다

    // 선점: Meta 재전송·동시 요청에서 같은 댓글에 두 번 보내지 않도록 PK(comment_id)로 막는다
    const { error: claimErr } = await store.claimLog({
      comment_id: ev.commentId, rule_id: rule.id, media_id: ev.mediaId,
      commenter_id: ev.commenterId, commenter_username: ev.commenterUsername,
      comment_text: ev.text.slice(0, 500), status: 'pending',
    });
    if (claimErr) {
      results.push({ comment: ev.commentId, result: claimErr.code === '23505' ? 'duplicate' : `claim-error:${claimErr.message}` });
      continue;
    }

    const sent = await sendPrivateReply(ev.commentId, buildMessage(rule), {
      token: env.IG_ACCESS_TOKEN, igUserId: env.IG_USER_ID, version: env.IG_GRAPH_VERSION, fetchImpl: fetch,
    });
    await store.updateLog(ev.commentId,
      sent.ok ? { status: 'sent', sent_at: new Date().toISOString() }
              : { status: 'failed', error: `${sent.status} ${sent.error ?? ''}`.slice(0, 500) });
    results.push({ comment: ev.commentId, result: sent.ok ? 'sent' : `failed:${sent.status}` });
  }

  if (results.length) console.log('[ig-dm]', JSON.stringify(results));
  return json({ ok: true });
}
```

⚠️ import 경로에 `.ts` 확장자를 붙인다. Deno는 확장자가 필수이고, vitest도 `.ts` 확장자 import를 받아들인다.

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npx vitest run src/__tests__/lib/instagram-webhook-handler.test.ts src/__tests__/lib/instagram-dm.test.ts`
Expected: 25 passed (10 + 15)

- [ ] **Step 5: 커밋**

```bash
git add supabase/functions/ig-webhook/handler.ts src/__tests__/lib/instagram-webhook-handler.test.ts
git commit -m "feat(ig-dm): 웹훅 핸들러를 의존성 주입 방식으로 작성"
```

---

### Task 3: store.ts + index.ts + config.toml, Vercel 라우트 삭제

**Files:**
- Create: `supabase/functions/ig-webhook/store.ts`
- Create: `supabase/functions/ig-webhook/index.ts`
- Create: `supabase/config.toml`
- Delete: `src/app/api/instagram/webhook/route.ts`, `src/lib/instagram/dm.ts`

- [ ] **Step 1: store.ts**

```ts
/**
 * Store의 Supabase 구현. Deno 전용 — npm: 지정자 때문에 Node 테스트에서는 import하지 않는다.
 * RLS는 켜져 있고 정책이 없으므로 service role 키로 접근한다 (106 마이그레이션 주석 참조).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { Store } from './handler.ts';

export function supabaseStore(url: string, serviceRoleKey: string): Store {
  const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  return {
    async loadActiveRules() {
      const { data, error } = await db.from('ig_dm_rules').select('*').eq('active', true);
      return { data, error: error ? { code: error.code, message: error.message } : null };
    },
    async claimLog(row) {
      const { error } = await db.from('ig_dm_log').insert(row);
      return { error: error ? { code: error.code, message: error.message } : null };
    },
    async updateLog(commentId, patch) {
      const { error } = await db.from('ig_dm_log').update(patch).eq('comment_id', commentId);
      return { error: error ? { code: error.code, message: error.message } : null };
    },
  };
}
```

- [ ] **Step 2: index.ts**

```ts
/**
 * Edge Function 진입점. 비밀값은 `supabase secrets set`으로 넣는다.
 * SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY는 Supabase가 자동 주입한다.
 */
import { handle, type Env } from './handler.ts';
import { supabaseStore } from './store.ts';

const env: Env = {
  IG_APP_SECRET: Deno.env.get('IG_APP_SECRET') ?? '',
  IG_VERIFY_TOKEN: Deno.env.get('IG_VERIFY_TOKEN') ?? '',
  IG_ACCESS_TOKEN: Deno.env.get('IG_ACCESS_TOKEN') ?? '',
  IG_USER_ID: Deno.env.get('IG_USER_ID') || undefined,
  IG_GRAPH_VERSION: Deno.env.get('IG_GRAPH_VERSION') || undefined,
};

const store = supabaseStore(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

Deno.serve((req) => handle(req, { env, store, fetch }));
```

- [ ] **Step 3: supabase/config.toml (최소)**

```toml
project_id = "smart_seller_studio"

[functions.ig-webhook]
# Meta 웹훅은 Authorization 헤더 없이 온다. 서명(X-Hub-Signature-256) 검증이 문지기다.
verify_jwt = false
```

- [ ] **Step 4: Vercel 라우트 삭제**

```bash
git rm -q src/app/api/instagram/webhook/route.ts src/lib/instagram/dm.ts 2>/dev/null || rm -rf src/app/api/instagram src/lib/instagram
```

(두 파일은 미추적 상태라 `rm`으로 지운다.) `src/app/api/instagram`·`src/lib/instagram` 디렉토리가 비면 함께 지운다.

- [ ] **Step 5: 타입체크·전체 관련 테스트**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "supabase/functions"`
Expected: `0` (제외됐으므로 Edge Function 파일에서 나온 오류가 없다)

Run: `npx vitest run src/__tests__/lib/instagram-`
Expected: 25 passed

- [ ] **Step 6: 커밋**

```bash
git add supabase/functions/ig-webhook supabase/config.toml
git commit -m "feat(ig-dm): Deno 진입점·Supabase store·config 추가, Vercel 라우트 폐기"
```

---

### Task 4: 마이그레이션 적용 + 배포 + curl 검증

**Files:**
- 실행만. 코드 변경 없음 (106 마이그레이션은 이미 존재)

- [ ] **Step 1: 106 마이그레이션 적용**

```bash
cd ~/dev/smart_seller_studio
DBURL=$(awk -F= '/^SUPABASE_DB_URL=/{sub(/^[^=]*=/,""); print}' .env.local | tr -d '"\r')
psql "$DBURL" -v ON_ERROR_STOP=1 -f supabase/migrations/106_ig_dm.sql
psql "$DBURL" -Atc "select table_name from information_schema.tables where table_name like 'ig_dm_%' order by 1"
```
Expected: `ig_dm_log` / `ig_dm_rules`

- [ ] **Step 2: 임시 비밀값으로 배포 (Meta 앱 만들기 전 배포 검증용)**

```bash
supabase secrets set --project-ref mvergrjqfjuwndveztts \
  IG_APP_SECRET=tmp-secret IG_VERIFY_TOKEN=tmp-verify IG_ACCESS_TOKEN=tmp-token IG_USER_ID=0
supabase functions deploy ig-webhook --project-ref mvergrjqfjuwndveztts --no-verify-jwt
```
Expected: `Deployed Functions on project mvergrjqfjuwndveztts: ig-webhook`

- [ ] **Step 3: curl 검증 3종**

```bash
U=https://mvergrjqfjuwndveztts.supabase.co/functions/v1/ig-webhook
# ① GET 검증
curl -s "$U?hub.mode=subscribe&hub.verify_token=tmp-verify&hub.challenge=4242"; echo
# 기대: 4242
curl -s -o /dev/null -w "%{http_code}\n" "$U?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1"
# 기대: 403
# ② 잘못된 서명
BODY='{"object":"instagram","entry":[{"id":"0","time":1,"changes":[{"field":"comments","value":{"from":{"id":"9","username":"t"},"media":{"id":"m"},"id":"curl-1","text":"텐트"}}]}]}'
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$U" -H 'content-type: application/json' -H 'x-hub-signature-256: sha256=00' --data "$BODY"
# 기대: 401
# ③ 올바른 서명 + 규칙 1건 → 가짜 댓글이라 발송은 실패하지만 로그가 남아야 한다
psql "$DBURL" -c "insert into ig_dm_rules (keyword, link_url, link_type, label) values ('텐트','https://example.com/x','other','curl 검증용')"
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac tmp-secret | awk '{print $2}')
curl -s -X POST "$U" -H 'content-type: application/json' -H "x-hub-signature-256: sha256=$SIG" --data "$BODY"; echo
# 기대: {"ok":true}
psql "$DBURL" -Atc "select comment_id, status, left(error,80) from ig_dm_log"
# 기대: curl-1 | failed | 400 ... (토큰이 가짜라 Meta가 거부)
```

- [ ] **Step 4: 검증 데이터 정리**

```bash
psql "$DBURL" -c "delete from ig_dm_log where comment_id='curl-1'; delete from ig_dm_rules where label='curl 검증용'"
```

- [ ] **Step 5: 위키 log 초안 메모 (커밋은 Task 6에서)**

여기까지의 실측(배포 URL·응답 코드·failed 오류 본문)을 메모해 둔다.

---

### Task 5: Meta 앱 설정 (브라우저 · 사용자와 함께)

**Files:** 없음. 결과값을 secrets로 넣는다.

- [ ] **Step 1: 개인정보처리방침 URL 준비** — 사용자에게 네이버 블로그(발굴템 연구소) 글 하나를 요청하거나 대신 초안을 준다. 내용: 앱 이름·운영자 청연코퍼레이션·용도(자기 계정 댓글 자동 답장)·수집 항목(댓글 작성자 ID·사용자명·댓글 텍스트, 발송 로그 용도)·제3자 제공 없음·문의처.

- [ ] **Step 2: developers.facebook.com** — 개발자 등록 → 앱 만들기 → 사용 사례 「Instagram」 또는 앱 타입 **Business** → 앱 이름 예: `청연 댓글 DM`.

- [ ] **Step 3: Instagram 제품 설정** — 「Instagram API with Instagram Login」 → `cheongyeon.corp` 로그인해 연결 → **Generate token** → 토큰과 Instagram 계정 ID 복사.

- [ ] **Step 4: 인스타 앱** — 설정 → 메시지 및 스토리 답장 → 메시지 관리 → 연결된 도구 → **메시지 접근 허용** 켜기.

- [ ] **Step 5: 앱 시크릿** — 앱 설정 → 기본 설정 → 앱 시크릿 표시. 개인정보처리방침 URL도 여기에 입력.

- [ ] **Step 6: 진짜 비밀값 넣고 재배포**

```bash
supabase secrets set --project-ref mvergrjqfjuwndveztts \
  IG_APP_SECRET='<앱 시크릿>' IG_VERIFY_TOKEN='<임의 문자열>' IG_ACCESS_TOKEN='<60일 토큰>' IG_USER_ID='<계정 ID>'
supabase functions deploy ig-webhook --project-ref mvergrjqfjuwndveztts --no-verify-jwt
```

- [ ] **Step 7: 웹훅 등록** — 대시보드 Instagram → Webhooks (또는 제품 설정 안 Webhooks) → 콜백 URL `https://mvergrjqfjuwndveztts.supabase.co/functions/v1/ig-webhook`, 확인 토큰 = `IG_VERIFY_TOKEN` → 「확인 및 저장」 → `comments` 필드 구독.

- [ ] **Step 8: 계정 구독**

```bash
curl -s -X POST "https://graph.instagram.com/v25.0/me/subscribed_apps?subscribed_fields=comments&access_token=<토큰>"
# 기대: {"success":true}
curl -s "https://graph.instagram.com/v25.0/me?fields=id,username&access_token=<토큰>"
# 기대: {"id":"<IG_USER_ID>","username":"cheongyeon.corp"}
```

- [ ] **Step 9: 앱 모드 Live** 전환. 웹훅이 개발 모드에서도 오는지 먼저 1회 시험해 보고(Task 6 Step 2), 안 오면 Live로 켠다. 어느 쪽이었는지 기록한다.

---

### Task 6: 실전 테스트 + 위키 기록

- [ ] **Step 1: 규칙 등록** — 사용자와 키워드·링크를 정해 넣는다. 예:

```sql
insert into ig_dm_rules (keyword, link_url, link_type, label, message)
values ('테스트', 'https://link.coupang.com/a/<파트너스>', 'partners', '2026-09-25 실전 테스트', null);
```

- [ ] **Step 2: 댓글** — `cheongyeon.corp`가 아닌 계정으로 최근 릴스에 `테스트` 댓글. 사용자에게 어떤 계정으로 달지 확인한다.

- [ ] **Step 3: 확인**

```bash
psql "$DBURL" -Atc "select comment_id, commenter_username, status, sent_at, left(error,120) from ig_dm_log order by created_at desc limit 5"
supabase functions logs ig-webhook --project-ref mvergrjqfjuwndveztts 2>/dev/null | tail -20
```
Expected: `sent` 행 1개, 댓글 단 계정의 DM함에 링크 도착.

- [ ] **Step 4: 실패 시 분기**
  - 로그에 행이 없다 → 웹훅이 안 왔다. 앱 모드(Live)·`subscribed_apps`·콜백 URL 확인
  - `failed 400 ... (#3) ... permission` → 메시지 접근 허용 토글 또는 권한 누락
  - `failed 400 ... Invalid comment` → 댓글 ID 형식 문제. 웹훅 payload를 함수 로그에서 확인

- [ ] **Step 5: 위키 기록**
  - `40-projects/쿠팡파트너스 영상 제작.md`: 전환 설계 절에 「자체 구현 Edge Function」 상태·토큰 만료일(발급일 + 60일)·운영 절차 링크. 보류 중인 Open Question "ManyChat 자동 DM이 정책상 위험한가"를 「공식 API 직접 구현으로 해소」로 닫는다
  - `20-wiki/outputs/인스타 DM 자동화 도구 비교 2026-08-29.md`: TL;DR·summary에 2026-09-25 결정(소셜비즈 → 직접 구현) 반영. 7-1-1절 5단계
  - `log.md`: `## [2026-09-25] work | 인스타 댓글→DM 자동화 Edge Function 배포`
  - 새 output 문서 `20-wiki/outputs/인스타 자동 DM 직접 구현 2026-09-25.md`: 운영 방법(규칙 넣는 법·로그 보는 법·토큰 갱신)·실측(개발 모드에서 웹훅이 왔는가·첫 DM 도착까지 초)
  - `lint.py --fix`로 index 동기화

- [ ] **Step 6: 커밋 (코드 저장소)**

```bash
git add -A supabase/functions supabase/config.toml docs/superpowers
git commit -m "feat(ig-dm): 실전 검증 완료"
```
