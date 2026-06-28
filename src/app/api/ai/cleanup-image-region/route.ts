/**
 * POST /api/ai/cleanup-image-region
 *
 * Gemini 2.5 Flash Image 모델로 선택 영역의 한자/워터마크를 제거합니다.
 * 영역을 crop → Gemini로 텍스트 제거 → Sharp로 원본에 합성
 * 페더링 파이프라인 없음 → 왜곡 최소화
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

const CLEANUP_PROMPT =
  'Remove ALL Chinese characters, text overlays, watermarks, price tags, and dimension labels from this image crop. ' +
  'Fill every removed area seamlessly by blending with the surrounding background colors and textures. ' +
  'Preserve the overall structure and colors of all non-text areas exactly as they are.';

export async function POST(req: NextRequest) {
  // 인증 검증
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult as NextResponse;

  // Rate Limiting: 분당 4회
  const ip =
    req.headers.get('x-forwarded-for') ??
    req.headers.get('x-real-ip') ??
    'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'cleanup-image-region'), {
    windowMs: 60_000,
    maxRequests: 4,
  });
  if (!rl.allowed) {
    return NextResponse.json({ error: '요청이 너무 많습니다.' }, { status: 429 });
  }

  // 요청 body 파싱
  const body = await req.json().catch(() => null);
  const { imageUrl, region } = (body ?? {}) as Record<string, unknown>;

  // imageUrl 검증 (SSRF 방어)
  if (typeof imageUrl !== 'string' || !SUPABASE_PATTERN.test(imageUrl)) {
    return NextResponse.json({ error: '허용되지 않는 이미지 URL입니다.' }, { status: 403 });
  }

  // region 존재 여부 검증
  if (!region || typeof region !== 'object') {
    return NextResponse.json({ error: 'region이 필요합니다.' }, { status: 400 });
  }

  // region 값 검증 (0~1 정규화 좌표)
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
    // 원본 이미지 fetch (15초 타임아웃)
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (!imgRes.ok) {
      return NextResponse.json({ error: '이미지를 불러오지 못했습니다.' }, { status: 422 });
    }
    const arrayBuffer = await imgRes.arrayBuffer();

    // 크기 상한: 20MB 초과 시 거부
    if (arrayBuffer.byteLength > 20 * 1024 * 1024) {
      return NextResponse.json({ error: '이미지 크기가 너무 큽니다.' }, { status: 413 });
    }

    // EXIF 회전 보정 후 크기 파악
    let img = sharp(Buffer.from(arrayBuffer)).rotate();
    const meta = await img.metadata();
    let W = meta.width ?? 0;
    let H = meta.height ?? 0;

    // 최대 크기 초과 시 다운스케일
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

    const cropBase64 = cropBuffer.toString('base64');

    // Gemini 이미지 편집으로 텍스트 제거
    const ai = getGeminiGenAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      config: { responseModalities: ['Text', 'Image'] },
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { data: cropBase64, mimeType: 'image/png' } },
          { text: CLEANUP_PROMPT },
        ] as Part[],
      }],
    });

    const parts: Part[] = response?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData != null);

    if (!imagePart?.inlineData?.data) {
      throw new Error('Gemini 응답에 이미지 데이터가 없습니다.');
    }

    const cleanedCropBuffer = Buffer.from(imagePart.inlineData.data, 'base64');

    // 정제된 crop을 원본 이미지 위에 합성 (페더링 없음 → 왜곡 없음)
    const resultBuffer = await img.clone()
      .composite([{ input: cleanedCropBuffer, left: mx, top: my }])
      .jpeg({ quality: 92 })
      .toBuffer();

    return NextResponse.json({
      imageBase64: resultBuffer.toString('base64'),
      mimeType: 'image/jpeg',
    });
  } catch (err) {
    console.error('[cleanup-image-region]', err);
    const message = err instanceof Error ? err.message : '처리 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
