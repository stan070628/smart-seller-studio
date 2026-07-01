import { NextRequest, NextResponse } from 'next/server';
import { enforceCoupangPolicy } from '@/lib/image/coupang-policy';

const DOWNLOAD_TIMEOUT_MS = 10_000;

export async function POST(req: NextRequest) {
  let imageUrl: string;
  try {
    const body = await req.json() as { imageUrl?: unknown };
    if (typeof body.imageUrl !== 'string' || !body.imageUrl.startsWith('http')) {
      return NextResponse.json({ error: 'imageUrl이 필요합니다.' }, { status: 400 });
    }
    imageUrl = body.imageUrl;
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  let inputBuffer: Buffer;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    const res = await fetch(imageUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return NextResponse.json({ error: `이미지 다운로드 실패 (${res.status})` }, { status: 502 });
    }
    inputBuffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    const msg = err instanceof Error ? err.message : '이미지 다운로드 중 오류';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const { buffer } = await enforceCoupangPolicy(inputBuffer);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Disposition': 'attachment; filename="thumbnail-coupang.jpg"',
      'Cache-Control': 'no-store',
    },
  });
}
