/**
 * POST /api/image/merge-vertical
 *
 * 여러 이미지를 동일 너비로 맞추고 위아래로 합쳐 하나의 이미지로 반환합니다.
 * 옵션/사이즈 비교 이미지를 한 장에 모아 보여줄 때 사용합니다.
 */

import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { requireAuth } from '@/lib/supabase/auth';
import { uploadToStorage } from '@/lib/supabase/server';

export const maxDuration = 60;

const SUPABASE_PATTERN = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\//;
const MAX_IMAGES = 6;
const MAX_WIDTH = 2000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult as NextResponse;

  const body = await req.json().catch(() => null);
  const { imageUrls } = (body ?? {}) as { imageUrls?: unknown };

  if (!Array.isArray(imageUrls) || imageUrls.length < 2 || imageUrls.length > MAX_IMAGES) {
    return NextResponse.json({ error: `이미지는 2~${MAX_IMAGES}장이어야 합니다.` }, { status: 400 });
  }

  for (const url of imageUrls) {
    if (typeof url !== 'string' || !SUPABASE_PATTERN.test(url)) {
      return NextResponse.json({ error: '허용되지 않는 이미지 URL입니다.' }, { status: 403 });
    }
  }

  try {
    // 이미지 fetch
    const buffers = await Promise.all(
      imageUrls.map(async (url: string) => {
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`이미지 fetch 실패 (${res.status}): ${url}`);
        return Buffer.from(await res.arrayBuffer());
      }),
    );

    // 원본 해상도 확인 후 최대 너비 결정
    const metas = await Promise.all(buffers.map((b) => sharp(b).rotate().metadata()));
    const maxWidth = Math.min(MAX_WIDTH, Math.max(...metas.map((m) => m.width ?? 0)));

    // 모두 동일 너비로 리사이즈 (비율 유지, 흰 배경 패딩)
    const resized = await Promise.all(
      buffers.map((b) =>
        sharp(b)
          .rotate()
          .resize(maxWidth, null, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
          .png()
          .toBuffer(),
      ),
    );

    // 리사이즈 후 각 이미지 높이 확인
    const resizedMetas = await Promise.all(resized.map((b) => sharp(b).metadata()));
    const totalHeight = resizedMetas.reduce((sum, m) => sum + (m.height ?? 0), 0);

    // 수직 합성
    let offsetY = 0;
    const composites: sharp.OverlayOptions[] = [];
    for (let i = 0; i < resized.length; i++) {
      composites.push({ input: resized[i], top: offsetY, left: 0 });
      offsetY += resizedMetas[i].height ?? 0;
    }

    const merged = await sharp({
      create: { width: maxWidth, height: totalHeight, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite(composites)
      .jpeg({ quality: 92 })
      .toBuffer();

    // Supabase Storage 업로드
    const path = `merged/${authResult.userId}/${Date.now()}.jpg`;
    const arrayBuffer = merged.buffer.slice(
      merged.byteOffset,
      merged.byteOffset + merged.byteLength,
    ) as ArrayBuffer;

    const { url } = await uploadToStorage(path, arrayBuffer, 'image/jpeg', merged.byteLength);

    return NextResponse.json({ url }, { status: 200 });
  } catch (err) {
    console.error('[merge-vertical]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '이미지 합치기 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
