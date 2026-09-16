/**
 * 비-JSON 응답 처리.
 *
 * Vercel 함수는 본문이 4.5MB를 넘으면 **함수가 실행되기도 전에** 413을
 * text/plain으로 돌려준다. 그 응답에 res.json()을 걸면 사파리가
 * "The string did not match the expected pattern."을 던지고, 그 영문이
 * 그대로 사용자 화면에 찍혔다(2026-09-16 아이폰 홈화면 앱에서 발생).
 */

import { describe, it, expect } from 'vitest';
import { readJsonOrThrow } from '../http';

function res(body: string, status: number, contentType: string) {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

describe('readJsonOrThrow', () => {
  it('JSON이면 그대로 파싱한다 — 상태코드가 4xx여도 서버 메시지를 살린다', async () => {
    const parsed = await readJsonOrThrow(
      res(JSON.stringify({ success: false, error: '지원하지 않는 형식' }), 415, 'application/json'),
    );
    expect(parsed).toEqual({ success: false, error: '지원하지 않는 형식' });
  });

  it('🔴 413 text/plain은 용량 문제임을 한국어로 알린다', async () => {
    await expect(
      readJsonOrThrow(res('Request Entity Too Large\n\nFUNCTION_PAYLOAD_TOO_LARGE', 413, 'text/plain')),
    ).rejects.toThrow(/용량/);
  });

  it('🔴 브라우저 내부 문구를 사용자에게 흘리지 않는다', async () => {
    // 사파리는 비-JSON 본문에 .json()을 걸면 영문 DOMException을 던진다.
    // 그 예외가 화면까지 올라오면 사용자는 무엇을 해야 할지 알 수 없다.
    const err = await readJsonOrThrow(res('Request Entity Too Large', 413, 'text/plain'))
      .then(() => null)
      .catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/did not match the expected pattern/i);
    expect((err as Error).message).toContain('413');
  });

  it('인증이 풀린 비-JSON 응답은 재로그인을 안내한다', async () => {
    await expect(readJsonOrThrow(res('<html>login</html>', 401, 'text/html'))).rejects.toThrow(/로그인/);
  });

  it('content-type이 없어도 죽지 않고 상태코드를 알린다', async () => {
    const r = new Response('boom', { status: 502 });
    r.headers.delete('content-type');
    await expect(readJsonOrThrow(r)).rejects.toThrow(/502/);
  });
});
