// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import {
  verifySignature, extractComments, matchRule, isOwnComment, buildMessage, sendPrivateReply,
  normalize, DISCLOSURE, DEFAULT_HEAD, type DmRule, type CommentEvent,
} from '../../../supabase/functions/ig-webhook/dm';

const rule = (o: Partial<DmRule>): DmRule => ({
  id: 1, keyword: '텐트', media_id: null, link_url: 'https://link.coupang.com/a/x',
  link_type: 'partners', message: null, label: null, active: true, ...o,
});
const ev = (o: Partial<CommentEvent>): CommentEvent => ({
  accountId: '100', commentId: 'c1', mediaId: 'm1', commenterId: '200',
  commenterUsername: 'buyer', text: '텐트', ...o,
});

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

describe('extractComments', () => {
  const body = {
    object: 'instagram',
    entry: [{
      id: '100', time: 1,
      changes: [
        { field: 'comments', value: { from: { id: '200', username: 'buyer' }, media: { id: 'm1', media_product_type: 'REELS' }, id: 'c1', text: '텐트 링크 주세요' } },
        { field: 'mentions', value: { id: 'x' } },
      ],
    }],
  };
  it('comments 필드만 뽑는다', () => {
    const r = extractComments(body);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ accountId: '100', commentId: 'c1', mediaId: 'm1', commenterId: '200', commenterUsername: 'buyer' });
  });
  it('instagram 객체가 아니면 빈 배열', () => {
    expect(extractComments({ object: 'page', entry: body.entry })).toEqual([]);
    expect(extractComments(null)).toEqual([]);
  });
});

describe('matchRule', () => {
  it('공백·대소문자 무시', () => {
    expect(normalize(' 텐 트 ')).toBe('텐트');
    expect(matchRule(ev({ text: 'TENT 주세요' }), [rule({ keyword: 'tent' })])?.keyword).toBe('tent');
    expect(matchRule(ev({ text: '텐 트 요' }), [rule({})])).not.toBeNull();
  });
  it('안 맞으면 null · 비활성 규칙 무시', () => {
    expect(matchRule(ev({ text: '예뻐요' }), [rule({})])).toBeNull();
    expect(matchRule(ev({}), [rule({ active: false })])).toBeNull();
  });
  it('다른 게시물 전용 규칙은 안 걸린다', () => {
    expect(matchRule(ev({ mediaId: 'm2' }), [rule({ media_id: 'm1' })])).toBeNull();
  });
  it('게시물 전용 규칙이 전체 규칙보다 우선', () => {
    const r = matchRule(ev({}), [rule({ id: 1 }), rule({ id: 2, media_id: 'm1' })]);
    expect(r?.id).toBe(2);
  });
  it('긴 키워드 우선', () => {
    const r = matchRule(ev({ text: '원터치텐트 링크' }), [rule({ id: 1 }), rule({ id: 2, keyword: '원터치텐트' })]);
    expect(r?.id).toBe(2);
  });
});

describe('isOwnComment', () => {
  it('내 계정 댓글은 제외', () => {
    expect(isOwnComment(ev({ commenterId: '100' }))).toBe(true);
    expect(isOwnComment(ev({}))).toBe(false);
  });
});

describe('buildMessage', () => {
  it('파트너스는 대가성 문구가 붙는다', () => {
    const m = buildMessage(rule({}));
    expect(m).toContain(DEFAULT_HEAD);
    expect(m).toContain('https://link.coupang.com/a/x');
    expect(m).toContain(DISCLOSURE.partners!);
  });
  it('내 스토어는 판매자 표기, other는 문구 없음', () => {
    expect(buildMessage(rule({ link_type: 'own' }))).toContain(DISCLOSURE.own!);
    const o = buildMessage(rule({ link_type: 'other', message: '안녕하세요' }));
    expect(o).toBe('안녕하세요\n\nhttps://link.coupang.com/a/x');
  });
});

describe('sendPrivateReply', () => {
  it('comment_id로 비공개 답장 요청을 만든다', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{"recipient_id":"1"}', { status: 200 }));
    const r = await sendPrivateReply('c1', 'hi', { token: 'T', igUserId: '100', version: 'v25.0', fetchImpl: f as any });
    expect(r.ok).toBe(true);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://graph.instagram.com/v25.0/100/messages');
    expect(init.headers.Authorization).toBe('Bearer T');
    expect(JSON.parse(init.body)).toEqual({ recipient: { comment_id: 'c1' }, message: { text: 'hi' } });
  });
  it('실패는 상태와 본문을 돌려준다', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{"error":{"message":"already replied"}}', { status: 400 }));
    const r = await sendPrivateReply('c1', 'hi', { token: 'T', fetchImpl: f as any });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(r.error).toContain('already replied');
  });
});
