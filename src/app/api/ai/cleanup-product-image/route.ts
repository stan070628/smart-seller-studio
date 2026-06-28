/**
 * POST /api/ai/cleanup-product-image
 *
 * Supabase Storage에 저장된 상품 이미지에서 한자, 워터마크, 브랜드 로고,
 * 가격 태그, 홍보 텍스트 등을 제거합니다.
 * Gemini 2.5 Flash image 편집 모델을 사용합니다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { getGeminiGenAI } from '@/lib/ai/gemini';
import type { Part } from '@google/genai';

export const maxDuration = 60;

// 분당 6회 제한 (이미지 편집 작업은 토큰 소비가 큼)
const RATE_LIMIT = { windowMs: 60_000, maxRequests: 6 };

// SSRF 방어: Supabase Storage URL만 허용
const SUPABASE_URL_PATTERN = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\//;

const CLEANUP_PROMPT = `Remove all Chinese characters, Chinese text, watermarks, brand logos, price tags, promotional text, and any text overlays from this product image.

CRITICAL CONSTRAINTS:
- Do NOT alter the product itself in any way — preserve the exact shape, color, texture, material, and all visual details of the product
- Fill removed text/watermark areas by blending naturally with the surrounding background
- Output a single clean product photograph with all text and overlays removed`;

export async function POST(req: NextRequest) {
  // 인증 검증
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult as NextResponse;

  // Rate Limiting
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'cleanup-product-image'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 },
    );
  }

  // 요청 body 파싱
  const body = await req.json().catch(() => null);
  const imageUrl: unknown = body?.imageUrl;

  // imageUrl 유효성 검증
  if (typeof imageUrl !== 'string' || !imageUrl) {
    return NextResponse.json({ error: 'imageUrl이 필요합니다.' }, { status: 400 });
  }

  // SSRF 방어: Supabase Storage URL 패턴 검증
  if (!SUPABASE_URL_PATTERN.test(imageUrl)) {
    return NextResponse.json({ error: '허용되지 않은 이미지 URL입니다.' }, { status: 403 });
  }

  try {
    // 이미지 fetch → base64 변환
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      throw new Error(`이미지 fetch 실패: ${imgRes.status}`);
    }
    const arrayBuffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = imgRes.headers.get('content-type') ?? 'image/jpeg';

    // Gemini 이미지 편집 모델로 한자·워터마크 제거
    const ai = getGeminiGenAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      config: { responseModalities: ['Text', 'Image'] },
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { data: base64, mimeType } },
          { text: CLEANUP_PROMPT },
        ],
      }],
    });

    // 결과 이미지 부분 추출
    const parts: Part[] = response?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData != null);

    if (!imagePart?.inlineData?.data) {
      throw new Error('Gemini 응답에 이미지 데이터가 없습니다.');
    }

    return NextResponse.json({
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType ?? 'image/jpeg',
    });
  } catch (err) {
    console.error('[cleanup-product-image] 오류:', err);
    return NextResponse.json(
      { error: '이미지 클린업 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
