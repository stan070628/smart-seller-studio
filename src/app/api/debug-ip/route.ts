import { NextResponse } from 'next/server';
import { proxyFetch } from '@/lib/proxy-fetch';

export async function GET() {
  const directRes = await fetch('https://api.ipify.org?format=json');
  const directData = await directRes.json();

  const proxyRes = await proxyFetch('https://api.ipify.org?format=json');
  const proxyData = await proxyRes.json();

  return NextResponse.json({
    vercelDirectIp: directData.ip,
    throughProxyIp: proxyData.ip,
    proxyUrl: process.env.PROXY_URL ?? null,
    proxySecretSet: !!process.env.PROXY_SECRET,
  });
}
