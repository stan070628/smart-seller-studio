/**
 * GET|POST|PUT|DELETE /api/proxy
 *
 * Fly.io 프록시를 대체하는 Vercel 내장 프록시 엔드포인트.
 * x-target-url 헤더로 지정된 외부 API에 요청을 중계합니다.
 * preferredRegion을 도쿄(hnd1)로 고정해 쿠팡 API IP 요구사항을 충족합니다.
 */

import { NextRequest } from 'next/server';

export const preferredRegion = ['hnd1']; // Tokyo — Coupang API IP 요구사항

const PROXY_SECRET = process.env.PROXY_SECRET ?? '';

const STRIP_REQUEST_HEADERS = new Set([
  'x-proxy-secret',
  'x-target-url',
  'host',
  'connection',
  'transfer-encoding',
]);

const STRIP_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'transfer-encoding',
  'connection',
]);

async function handleProxy(req: NextRequest): Promise<Response> {
  if (!PROXY_SECRET) {
    return Response.json({ error: 'proxy not configured' }, { status: 500 });
  }

  if (req.headers.get('x-proxy-secret') !== PROXY_SECRET) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const targetUrl = req.headers.get('x-target-url');
  if (!targetUrl) {
    return Response.json({ error: 'missing x-target-url' }, { status: 400 });
  }

  const forwardHeaders = new Headers();
  req.headers.forEach((value, key) => {
    if (!STRIP_REQUEST_HEADERS.has(key)) {
      forwardHeaders.set(key, value);
    }
  });

  const method = req.method;
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const body = hasBody ? await req.arrayBuffer() : undefined;

  const upstream = await fetch(targetUrl, {
    method,
    headers: forwardHeaders,
    body: body && body.byteLength > 0 ? body : undefined,
  });

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!STRIP_RESPONSE_HEADERS.has(key)) {
      responseHeaders.set(key, value);
    }
  });

  const responseBody = await upstream.arrayBuffer();
  return new Response(responseBody, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = handleProxy;
export const POST = handleProxy;
export const PUT = handleProxy;
export const DELETE = handleProxy;
export const PATCH = handleProxy;
