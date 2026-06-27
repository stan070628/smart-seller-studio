/**
 * POST /api/ai/cleanup-image-region
 *
 * 이미지의 특정 영역(region)을 Gemini 2.5 Flash로 클린업합니다.
 * 한자, 워터마크, 가격 태그 등을 제거하고 Sharp로 페더링 합성 처리합니다.
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

// 리사이즈 최대 크기 (픽셀)
const MAX_DIM = 2000;

// Gemini 프롬프트: 중앙 영역 한자/워터마크 제거, 테두리 보존
const CLEANUP_PROMPT =
  'Remove all Chinese text, watermarks, and price tags in the CENTRAL area of this image crop. ' +
  'DO NOT modify the outer border region — keep its colors and textures identical to the input. ' +
  'Fill removed areas by blending with the surrounding background.';

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
    // 원본 이미지 fetch
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      return NextResponse.json({ error: '이미지를 불러오지 못했습니다.' }, { status: 422 });
    }
    const arrayBuffer = await imgRes.arrayBuffer();

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

    // 전처리된 원본 버퍼 (PNG, 무손실)
    const origBuffer = await img.clone().png().toBuffer();

    // region → 픽셀 좌표 변환
    const px = { x: x * W, y: y * H, w: width * W, h: height * H };

    // 패딩: region 크기의 35% 또는 최소 40px
    const pad = Math.max(40, Math.round(Math.min(px.w, px.h) * 0.35));

    // 크롭 영역 계산 (이미지 경계 clamp)
    const cx = Math.max(0, Math.floor(px.x - pad));
    const cy = Math.max(0, Math.floor(px.y - pad));
    const cw = Math.min(W - cx, Math.ceil(px.w + pad * 2));
    const ch = Math.min(H - cy, Math.ceil(px.h + pad * 2));

    // 크롭 추출 → base64 인코딩
    const cropBuffer = await sharp(origBuffer)
      .extract({ left: cx, top: cy, width: cw, height: ch })
      .png()
      .toBuffer();
    const cropBase64 = cropBuffer.toString('base64');

    // Gemini 이미지 편집 호출 (70초 타임아웃)
    const ai = getGeminiGenAI();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 70_000);

    let geminiBuffer: Buffer;
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-05-20',
        config: { responseModalities: ['Image', 'Text'], abortSignal: controller.signal },
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { data: cropBase64, mimeType: 'image/png' } } as Part,
            { text: CLEANUP_PROMPT } as Part,
          ],
        }],
      });

      // 응답에서 이미지 파트 추출
      const parts: Part[] = response?.candidates?.[0]?.content?.parts ?? [];
      const imagePart = parts.find(p => p.inlineData != null);
      if (!imagePart?.inlineData?.data) {
        return NextResponse.json(
          { error: '결과가 없습니다. 다시 실행해주세요.' },
          { status: 500 },
        );
      }
      geminiBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        return NextResponse.json(
          { error: '시간이 초과됐습니다. 다시 실행해주세요.' },
          { status: 500 },
        );
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }

    // Gemini 결과를 크롭 크기에 맞게 리사이즈
    const resizedGemini = await sharp(geminiBuffer).resize(cw, ch).png().toBuffer();

    // 밝기 보정: 원본과 Gemini 결과의 채널별 평균 차이를 linear 보정
    const origStats = await sharp(origBuffer)
      .extract({ left: cx, top: cy, width: cw, height: ch })
      .stats();
    const geminiStats = await sharp(resizedGemini).stats();
    const offsets = origStats.channels.map(
      (c, i) => c.mean - (geminiStats.channels[i]?.mean ?? c.mean),
    );
    const tonedGemini = await sharp(resizedGemini)
      .linear([1, 1, 1], offsets.slice(0, 3))
      .png()
      .toBuffer();

    // 페더링 마스크: 내부 영역(패드 절반 여백)을 흰색으로, 테두리는 블러 페이드
    const innerX = Math.round(pad / 2);
    const innerY = Math.round(pad / 2);
    const innerW = Math.max(1, cw - pad);
    const innerH = Math.max(1, ch - pad);

    const maskSvg = Buffer.from(
      `<svg width="${cw}" height="${ch}">` +
      `<rect x="${innerX}" y="${innerY}" width="${innerW}" height="${innerH}" fill="white"/>` +
      `</svg>`,
    );

    // 투명 배경 위에 SVG 마스크 합성 후 블러 → 부드러운 페더 경계
    const mask = await sharp({
      create: { width: cw, height: ch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: maskSvg, blend: 'over' }])
      .blur(12)
      .toBuffer();

    // 마스크를 Gemini 결과에 적용 (테두리 투명 처리)
    const maskedPatch = await sharp(tonedGemini)
      .ensureAlpha()
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();

    // 원본에 패치 합성 → JPEG 출력
    const result = await sharp(origBuffer)
      .composite([{ input: maskedPatch, left: cx, top: cy }])
      .jpeg({ quality: 92 })
      .toBuffer();

    return NextResponse.json({
      imageBase64: result.toString('base64'),
      mimeType: 'image/jpeg',
    });
  } catch (err) {
    console.error('[cleanup-image-region]', err);
    return NextResponse.json({ error: '처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
