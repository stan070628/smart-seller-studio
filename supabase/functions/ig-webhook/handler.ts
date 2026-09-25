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
  updateLog(
    commentId: string,
    patch: { status: 'sent' | 'failed'; sent_at?: string; error?: string },
  ): Promise<{ error: StoreError | null }>;
  /** 진단용 수신 기록 (ig_dm_webhook_log). 실패해도 본 처리에 영향을 주지 않는다 */
  logRequest?(row: RequestLogRow): Promise<void>;
}

export interface RequestLogRow {
  sig_ok: boolean;
  http_status: number;
  events: number;
  matched: number;
  note: string | null;
  body_head: string | null;
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

async function handleEvent(req: Request, deps: Deps): Promise<Response> {
  const raw = await req.text();
  const trace: RequestLogRow = { sig_ok: false, http_status: 0, events: 0, matched: 0, note: null, body_head: raw.slice(0, 1000) };
  const res = await processEvent(raw, req.headers.get('x-hub-signature-256'), deps, trace);
  trace.http_status = res.status;
  try { await deps.store.logRequest?.(trace); } catch (e) { console.error('[ig-dm] 수신 기록 실패', e); }
  return res;
}

async function processEvent(
  raw: string, sigHeader: string | null, { env, store, fetch }: Deps, trace: RequestLogRow,
): Promise<Response> {
  if (!env.IG_APP_SECRET || !env.IG_ACCESS_TOKEN) {
    console.error('[ig-dm] IG_APP_SECRET / IG_ACCESS_TOKEN 미설정');
    trace.note = 'env-missing';
    return json({ ok: false }, 500);
  }

  // 서명은 원문으로 검증한다 — JSON 파싱 후 재직렬화하면 바이트가 달라진다
  if (!(await verifySignature(raw, sigHeader, env.IG_APP_SECRET))) {
    trace.note = sigHeader ? 'bad-signature' : 'no-signature-header';
    return json({ ok: false }, 401);
  }
  trace.sig_ok = true;

  let body: unknown;
  try { body = JSON.parse(raw); } catch { trace.note = 'not-json'; return json({ ok: true }); }

  const all = extractComments(body);
  trace.events = all.length;
  const events = all.filter((e) => !isOwnComment(e));
  if (!events.length) { trace.note = all.length ? 'own-comments-only' : 'no-comment-events'; return json({ ok: true }); }

  const { data: rules, error: rulesErr } = await store.loadActiveRules();
  if (rulesErr) {
    console.error('[ig-dm] 규칙 조회 실패', rulesErr.message);
    trace.note = `rules-error:${rulesErr.message}`;
    return json({ ok: true }); // 재전송돼도 같은 실패라 200으로 끊는다
  }

  const results: Array<{ comment: string; result: string }> = [];
  for (const ev of events) {
    const rule = matchRule(ev, (rules ?? []) as DmRule[]);
    if (!rule) continue; // 규칙에 안 맞는 댓글은 기록하지 않는다

    // 선점: Meta 재전송·동시 요청에서 같은 댓글에 두 번 보내지 않도록 PK(comment_id)로 막는다
    const { error: claimErr } = await store.claimLog({
      comment_id: ev.commentId, rule_id: rule.id, media_id: ev.mediaId,
      commenter_id: ev.commenterId, commenter_username: ev.commenterUsername,
      comment_text: ev.text.slice(0, 500), status: 'pending',
    });
    if (claimErr) {
      results.push({
        comment: ev.commentId,
        result: claimErr.code === '23505' ? 'duplicate' : `claim-error:${claimErr.message}`,
      });
      continue;
    }

    const sent = await sendPrivateReply(ev.commentId, buildMessage(rule), {
      token: env.IG_ACCESS_TOKEN, igUserId: env.IG_USER_ID, version: env.IG_GRAPH_VERSION, fetchImpl: fetch,
    });
    await store.updateLog(
      ev.commentId,
      sent.ok ? { status: 'sent', sent_at: new Date().toISOString() }
              : { status: 'failed', error: `${sent.status} ${sent.error ?? ''}`.slice(0, 500) },
    );
    results.push({ comment: ev.commentId, result: sent.ok ? 'sent' : `failed:${sent.status}` });
  }

  trace.matched = results.length;
  trace.note = results.length ? results.map((r) => r.result).join(',') : 'no-rule-match';
  if (results.length) console.log('[ig-dm]', JSON.stringify(results));
  return json({ ok: true });
}
