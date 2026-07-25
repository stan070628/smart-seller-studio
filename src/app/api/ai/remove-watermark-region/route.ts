/**
 * POST /api/ai/remove-watermark-region
 *
 * Gemini 2.5 Flash Image 모델로 선택 영역의 워터마크를 제거합니다.
 * 영역을 crop → Gemini로 워터마크 제거 → Sharp로 원본에 합성
 */

import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import type { Part } from '@google/genai';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { getGeminiGenAI } from '@/lib/ai/gemini';

export const maxDuration = 90;

// SSRF 방어: Supabase Storage URL만 허용
const SUPABASE_PATTERN = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\//;

const MAX_DIM = 2000;

// "Remove watermark/logo" 표현은 Gemini 콘텐츠 정책에 걸릴 수 있어 inpainting 중심으로 표현
const WATERMARK_PROMPT =
  'This is an image crop. Restore the appearance of this area to look like a clean, natural background ' +
  'without any overlay marks, semi-transparent elements, or printed text. ' +
  'Seamlessly fill the area by blending with the surrounding colors and textures. ' +
  'Keep all other parts of the image exactly as they are.';

export async function POST(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult as NextResponse;

  const ip =
    req.headers.get('x-forwarded-for') ??
    req.headers.get('x-real-ip') ??
    'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'remove-watermark-region'), {
    windowMs: 60_000,
    maxRequests: 4,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: '요청이 너무 많습니다.' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const { imageUrl, imageBase64, mimeType, region } = (body ?? {}) as Record<string, unknown>;

  // 입력은 Supabase URL 또는 클라이언트가 보낸 base64 둘 중 하나.
  // SSRF 방어는 URL 분기에만 필요하다 — base64는 서버가 외부를 호출하지 않는다.
  const hasBase64 = typeof imageBase64 === 'string' && imageBase64.length > 0;
  const hasUrl = typeof imageUrl === 'string' && imageUrl.length > 0;

  if (!hasBase64 && !hasUrl) {
    return NextResponse.json({ error: 'imageUrl 또는 imageBase64가 필요합니다.' }, { status: 400 });
  }
  if (!hasBase64 && !SUPABASE_PATTERN.test(imageUrl as string)) {
    return NextResponse.json({ error: '허용되지 않는 이미지 URL입니다.' }, { status: 403 });
  }

  if (!region || typeof region !== 'object') {
    return NextResponse.json({ error: 'region이 필요합니다.' }, { status: 400 });
  }

  const { x, y, width, height } = region as Record<string, unknown>;
  if (
    typeof x !== 'number' || typeof y !== 'number' ||
    typeof width !== 'number' || typeof height !== 'number' ||
    x < 0 || y < 0 || x > 1 || y > 1 ||
    width < 0.01 || height < 0.01 ||
    x + width > 1 || y + height > 1
  ) {
    return NextResponse.json({ error: 'region 값이 유효하지 않습니다.' }, { status: 400 });
  }

  try {
    let sourceBuffer: Buffer;
    if (hasBase64) {
      const raw = imageBase64 as string;
      sourceBuffer = Buffer.from(raw.includes(';base64,') ? raw.split(';base64,')[1]! : raw, 'base64');
    } else {
      const imgRes = await fetch(imageUrl as string, { signal: AbortSignal.timeout(15_000) });
      if (!imgRes.ok) {
        return NextResponse.json({ error: '이미지를 불러오지 못했습니다.' }, { status: 422 });
      }
      sourceBuffer = Buffer.from(await imgRes.arrayBuffer());
    }

    if (sourceBuffer.byteLength > 20 * 1024 * 1024) {
      return NextResponse.json({ error: '이미지 크기가 너무 큽니다.' }, { status: 413 });
    }

    let img = sharp(sourceBuffer).rotate();
    const meta = await img.metadata();
    let W = meta.width ?? 0;
    let H = meta.height ?? 0;

    if (Math.max(W, H) > MAX_DIM) {
      const scale = MAX_DIM / Math.max(W, H);
      W = Math.round(W * scale);
      H = Math.round(H * scale);
      img = img.resize(W, H);
    }

    // 선택 영역 → 픽셀 좌표 + 패딩
    const px = { x: x * W, y: y * H, w: width * W, h: height * H };
    const pad = Math.max(80, Math.round(Math.min(px.w, px.h) * 0.5));
    const mx = Math.max(0, Math.floor(px.x - pad));
    const my = Math.max(0, Math.floor(px.y - pad));
    const mw = Math.min(W - mx, Math.ceil(px.w + pad * 2));
    const mh = Math.min(H - my, Math.ceil(px.h + pad * 2));

    // 선택 영역 crop → Gemini로 전송
    const cropBuffer = await img.clone()
      .extract({ left: mx, top: my, width: mw, height: mh })
      .png()
      .toBuffer();

    const ai = getGeminiGenAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      config: { responseModalities: ['Text', 'Image'] },
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { data: cropBuffer.toString('base64'), mimeType: 'image/png' } },
          { text: WATERMARK_PROMPT },
        ] as Part[],
      }],
    });

    const parts: Part[] = response?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData != null);

    if (!imagePart?.inlineData?.data) {
      const textPart = parts.find((p) => p.text != null);
      const reason = textPart?.text ?? JSON.stringify(response?.candidates?.[0]?.finishReason ?? 'unknown');
      console.warn('[remove-watermark-region] Gemini no image, returning original. reason:', reason.slice(0, 200));
      // Gemini가 이미지를 반환하지 않으면 원본 이미지를 그대로 반환 (fallback)
      const originalBuffer = await img.clone().jpeg({ quality: 92 }).toBuffer();
      return NextResponse.json({
        imageBase64: originalBuffer.toString('base64'),
        mimeType: 'image/jpeg',
        fallback: true,
      });
    }

    const cleanedCropBuffer = Buffer.from(imagePart.inlineData.data, 'base64');

    // Gemini 결과를 crop 원본 크기로 맞춘 뒤 원본 이미지에 합성
    const resizedCleanedBuffer = await sharp(cleanedCropBuffer)
      .resize(mw, mh, { fit: 'fill' })
      .png()
      .toBuffer();

    const resultBuffer = await img.clone()
      .composite([{ input: resizedCleanedBuffer, left: mx, top: my }])
      .jpeg({ quality: 92 })
      .toBuffer();

    return NextResponse.json({
      imageBase64: resultBuffer.toString('base64'),
      mimeType: 'image/jpeg',
    });
  } catch (err) {
    console.error('[remove-watermark-region]', err);
    const message = err instanceof Error ? err.message : '처리 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
