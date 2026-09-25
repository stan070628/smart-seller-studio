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
    const res = await handle(req, { env, store: fakeStore([]).store, fetch: okFetch() as any });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('12345');
  });
  it('토큰이 틀리면 403', async () => {
    const req = new Request(`${URL_}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`);
    const res = await handle(req, { env, store: fakeStore([]).store, fetch: okFetch() as any });
    expect(res.status).toBe(403);
  });
});

describe('POST', () => {
  it('서명이 틀리면 401이고 아무것도 기록하지 않는다', async () => {
    const { store, logs } = fakeStore([rule()]);
    const body = commentBody('텐트');
    const res = await handle(post(body, signed(body, 'wrong')), { env, store, fetch: okFetch() as any });
    expect(res.status).toBe(401);
    expect(Object.keys(logs)).toHaveLength(0);
  });

  it('키워드 댓글이면 DM을 보내고 sent로 기록한다', async () => {
    const { store, logs } = fakeStore([rule()]);
    const f = okFetch();
    const body = commentBody('텐트 링크 주세요');
    const res = await handle(post(body, signed(body)), { env, store, fetch: f as any });
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
    await handle(post(body, signed(body)), { env, store, fetch: f as any });
    expect(f).not.toHaveBeenCalled();
    expect(Object.keys(logs)).toHaveLength(0);
  });

  it('이미 처리한 댓글(재전송)은 다시 보내지 않는다', async () => {
    const { store } = fakeStore([rule()], ['c1']);
    const f = okFetch();
    const body = commentBody('텐트');
    const res = await handle(post(body, signed(body)), { env, store, fetch: f as any });
    expect(res.status).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });

  it('내 계정이 단 댓글은 무시한다', async () => {
    const { store, logs } = fakeStore([rule()]);
    const f = okFetch();
    const body = commentBody('텐트', { commenter: '100' });
    await handle(post(body, signed(body)), { env, store, fetch: f as any });
    expect(f).not.toHaveBeenCalled();
    expect(Object.keys(logs)).toHaveLength(0);
  });

  it('발송 실패는 failed와 오류 본문으로 남긴다', async () => {
    const { store, logs } = fakeStore([rule()]);
    const f = vi.fn(async () => new Response('{"error":{"message":"(#100) Invalid comment"}}', { status: 400 }));
    const body = commentBody('텐트');
    const res = await handle(post(body, signed(body)), { env, store, fetch: f as any });
    expect(res.status).toBe(200);
    expect(logs.c1.status).toBe('failed');
    expect(logs.c1.error).toContain('400');
    expect(logs.c1.error).toContain('Invalid comment');
  });

  it('비밀값이 없으면 500', async () => {
    const body = commentBody('텐트');
    const res = await handle(post(body, signed(body)), {
      env: { ...env, IG_ACCESS_TOKEN: '' }, store: fakeStore([]).store, fetch: okFetch() as any,
    });
    expect(res.status).toBe(500);
  });

  it('수신 기록: 서명 실패는 sig_ok=false, 정상 발송은 matched=1로 남긴다', async () => {
    const { store } = fakeStore([rule()]);
    const rows: any[] = [];
    store.logRequest = async (r) => { rows.push(r); };
    const body = commentBody('텐트');
    await handle(post(body, signed(body, 'wrong')), { env, store, fetch: okFetch() as any });
    await handle(post(body, signed(body)), { env, store, fetch: okFetch() as any });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sig_ok: false, http_status: 401, events: 0, note: 'bad-signature' });
    expect(rows[1]).toMatchObject({ sig_ok: true, http_status: 200, events: 1, matched: 1, note: 'sent' });
    expect(rows[1].body_head).toContain('텐트');
  });

  it('두 번째 시크릿으로 서명된 요청도 통과하고 note에 secret2가 남는다', async () => {
    const { store, logs } = fakeStore([rule()]);
    const rows: any[] = [];
    store.logRequest = async (r) => { rows.push(r); };
    const body = commentBody('텐트');
    const res = await handle(post(body, signed(body, 'second')), { env: { ...env, IG_APP_SECRET_2: 'second' }, store, fetch: okFetch() as any });
    expect(res.status).toBe(200);
    expect(logs.c1.status).toBe('sent');
    expect(rows[0]).toMatchObject({ sig_ok: true, note: 'secret2;sent' });
  });

  it('JSON이 아니면 200으로 끊는다 (재전송 방지)', async () => {
    const body = 'not-json';
    const res = await handle(post(body, signed(body)), { env, store: fakeStore([]).store, fetch: okFetch() as any });
    expect(res.status).toBe(200);
  });
});
