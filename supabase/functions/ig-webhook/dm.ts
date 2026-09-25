/**
 * 인스타 댓글 키워드 → 자동 DM(비공개 답장).
 *
 * 경로: Instagram API with Instagram Login — 페이스북 페이지 연결이 필요 없다.
 * 발송: POST graph.instagram.com/{ver}/{IG_ID}/messages  { recipient: { comment_id }, message: { text } }
 * 제약(Meta 공식): 댓글 1건당 1회 · 댓글 작성 후 7일 이내 · 자동 발송 시간당 200건.
 *
 * 순수 함수(서명 검증·파싱·매칭·문구)와 I/O(발송)를 나눠 테스트한다.
 * 실행 위치: Supabase Edge Function (supabase/functions/ig-webhook). Node 전용 API를 쓰지 않는다.
 */
// ─── 타입 ─────────────────────────────────────────────

export type LinkType = 'partners' | 'own' | 'other';

export interface DmRule {
  id: number;
  keyword: string;
  media_id: string | null;
  link_url: string;
  link_type: LinkType;
  message: string | null;
  label: string | null;
  active: boolean;
}

export interface CommentEvent {
  accountId: string;        // 내 인스타 계정 ID (webhook entry.id)
  commentId: string;
  mediaId: string | null;
  commenterId: string | null;
  commenterUsername: string | null;
  text: string;
}

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
 * Web Crypto만 쓰므로 Deno(Edge Function)와 Node(vitest) 양쪽에서 같은 코드가 돈다.
 */
export async function verifySignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = await hmacSha256Hex(appSecret, rawBody);
  return constantTimeEqual(header.slice('sha256='.length).toLowerCase(), expected);
}

// ─── 파싱 ─────────────────────────────────────────────

/** webhook 본문에서 댓글 이벤트만 뽑는다. 다른 필드(messages 등)는 무시한다. */
export function extractComments(body: unknown): CommentEvent[] {
  const out: CommentEvent[] = [];
  const b = body as { object?: string; entry?: unknown[] };
  if (b?.object !== 'instagram' || !Array.isArray(b.entry)) return out;
  for (const e of b.entry as Array<{ id?: string; changes?: Array<{ field?: string; value?: any }> }>) {
    for (const ch of e.changes ?? []) {
      if (ch.field !== 'comments' || !ch.value) continue;
      const v = ch.value;
      if (!v.id || typeof v.text !== 'string') continue;
      out.push({
        accountId: String(e.id ?? ''),
        commentId: String(v.id),
        mediaId: v.media?.id ? String(v.media.id) : null,
        commenterId: v.from?.id ? String(v.from.id) : null,
        commenterUsername: v.from?.username ?? null,
        text: v.text,
      });
    }
  }
  return out;
}

// ─── 매칭 ─────────────────────────────────────────────

/** 공백 제거 + 소문자. "텐 트"·"TENT"도 잡히게 한다. */
export const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/**
 * 댓글에 키워드가 들어 있으면 매칭. 여러 규칙이 맞으면
 * ① 이 게시물 전용 규칙 > 전체 규칙 ② 긴 키워드 우선 (「텐트」보다 「원터치텐트」).
 */
export function matchRule(ev: CommentEvent, rules: DmRule[]): DmRule | null {
  const text = normalize(ev.text);
  const hits = rules.filter(
    (r) => r.active && normalize(r.keyword) && text.includes(normalize(r.keyword)) &&
      (r.media_id === null || r.media_id === ev.mediaId),
  );
  if (!hits.length) return null;
  hits.sort((a, b) =>
    (Number(b.media_id !== null) - Number(a.media_id !== null)) ||
    (normalize(b.keyword).length - normalize(a.keyword).length));
  return hits[0];
}

/** 내 계정이 단 댓글(대댓글 포함)에는 반응하지 않는다 — 자기 자신에게 DM이 간다. */
export const isOwnComment = (ev: CommentEvent) => !!ev.commenterId && ev.commenterId === ev.accountId;

// ─── 문구 ─────────────────────────────────────────────

export const DISCLOSURE: Record<LinkType, string | null> = {
  // 공정위 추천·보증 심사지침. 누락 시 파트너스 수익이 인정되지 않는다(쿠팡 파트너스 운영정책)
  partners: '이 메시지는 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',
  own: '제가 운영하는 스토어에서 판매하는 상품이에요.',
  other: null,
};

export const DEFAULT_HEAD = '요청하신 상품 링크예요.';

export function buildMessage(rule: DmRule): string {
  const parts = [rule.message?.trim() || DEFAULT_HEAD, rule.link_url];
  const d = DISCLOSURE[rule.link_type];
  if (d) parts.push(d);
  return parts.join('\n\n');
}

// ─── 발송 ─────────────────────────────────────────────

export interface SendResult { ok: boolean; status: number; error?: string }

export async function sendPrivateReply(
  commentId: string, text: string,
  opts: { token: string; igUserId?: string; version?: string; fetchImpl?: typeof fetch },
): Promise<SendResult> {
  const ver = opts.version || 'v25.0';
  const who = opts.igUserId || 'me';
  const f = opts.fetchImpl ?? fetch;
  const r = await f(`https://graph.instagram.com/${ver}/${who}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }),
  });
  if (r.ok) return { ok: true, status: r.status };
  const t = await r.text().catch(() => '');
  return { ok: false, status: r.status, error: t.slice(0, 500) };
}
