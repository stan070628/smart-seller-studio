/**
 * POST /api/ai/generate-compare-image
 *
 * compare 섹션용 좌우 대비 이미지 한 장을 만든다.
 * 좌 = 기존 방식의 어질러진 씬(Gemini 단독 생성)
 * 우 = 우리 제품이 놓인 정돈된 씬(배경 Gemini + 제품 누끼 Sharp 합성)
 *
 * 설계: docs/superpowers/specs/2026-07-26-pro-compare-pair-image-design.md
 *
 * 응답은 설계 문서의 { url } 대신 sibling(generate-scene-image)과 같은
 * { imageBase64, mimeType }다. 클라이언트가 이미 /api/image/upload-ai로
 * 업로드하는 경로를 갖고 있어, 여기에 Storage 코드를 새로 두면 업로드·권한
 * 처리가 두 곳으로 갈라진다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import sharp from 'sharp';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { generateFrameImage } from '@/lib/ai/imagen';
import { loadReferenceImages } from '@/lib/ai/reference-images';
import { removeBackgroundTransparent } from '@/lib/ai/remove-background';
import { DEFAULT_THEME } from '@/lib/detail-page/palette-config';
import {
  buildBeforePrompt,
  buildAfterBackgroundPrompt,
} from '@/lib/detail-page/compare-image-prompts';
import { composeComparePair } from '@/lib/detail-page/compare-image-compose';

// Gemini 2회 + rembg 1회 + Sharp 결합.
export const maxDuration = 120;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 10 };

const RequestSchema = z.object({
  beforeHint: z.string().min(1).max(600),
  afterHint: z.string().min(1).max(600),
  productImageUrls: z.array(z.string().url()).max(3).default([]),
  category: z.string().max(40).optional(),
  productName: z.string().max(200).optional(),
});

/**
 * 제품 누끼를 배경 바닥에 얹는다. 실패하면 배경만 반환한다.
 *
 * 배치·그림자는 generate-scene-image의 compositeProductOnBackground와 같은 방식이다.
 * 처음에는 세로 62% 지점에 중앙 정렬했는데 실물 확인에서 제품이 공중에 뜬 것처럼
 * 보였다 — 바닥선 기준으로 내리고 접지 그림자를 깔아야 "놓여 있는" 느낌이 난다.
 */
async function compositeProduct(background: Buffer, productPng: Buffer): Promise<Buffer> {
  const bg = await sharp(background).metadata();
  const bw = bg.width ?? 0;
  const bh = bg.height ?? 0;
  if (bw === 0 || bh === 0) return background;

  // 여백을 잘라내 실제 피사체 크기를 기준으로 배치한다.
  const trimmed = await sharp(productPng).trim().png().toBuffer();
  const tm = await sharp(trimmed).metadata();
  const tw = tm.width ?? 0;
  const th = tm.height ?? 0;
  if (tw === 0 || th === 0) return background;

  // 배경 폭의 46%를 차지하게. 좌측의 여러 물건과 대비되도록 하나만 크게 놓는다.
  const targetW = Math.round(bw * 0.46);
  const scale = targetW / tw;
  const resized = await sharp(trimmed)
    .resize(targetW, Math.max(1, Math.round(th * scale)), { fit: 'inside' })
    .png()
    .toBuffer();
  const rm = await sharp(resized).metadata();
  const rw = rm.width ?? targetW;
  const rh = rm.height ?? targetW;

  const groundLine = Math.round(bh * 0.88);
  const left = Math.max(0, Math.round((bw - rw) / 2));
  const top = Math.max(0, groundLine - rh);

  // 접지 그림자: 제품 실루엣(알파)을 세로로 눌러 블러 + 반투명 검정으로 깔면
  // 붙어있는 느낌이 생겨 잘라 붙인 듯한 티가 줄어든다.
  const shadowH = Math.max(8, Math.round(rh * 0.16));
  const shadowMask = await sharp(resized)
    .ensureAlpha()
    .extractChannel('alpha')
    .resize(rw, shadowH, { fit: 'fill' })
    .blur(16)
    .linear(0.5, 0)
    .toBuffer();
  const shadow = await sharp({
    create: { width: rw, height: shadowH, channels: 3, background: { r: 15, g: 15, b: 18 } },
  })
    .joinChannel(shadowMask)
    .png()
    .toBuffer();
  const shadowTop = Math.min(bh - shadowH, Math.round(groundLine - shadowH / 2));

  return sharp(background)
    .composite([
      { input: shadow, left, top: shadowTop },
      { input: resized, left, top },
    ])
    .png()
    .toBuffer();
}

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'generate-compare-image'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429, headers: { 'X-RateLimit-Reset': rl.resetAt.toString() } },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? '잘못된 요청' },
      { status: 400 },
    );
  }

  const { beforeHint, afterHint, productImageUrls, category, productName } = parsed.data;
  // PRO 경로에는 팔레트 지정이 없어 항상 DEFAULT_THEME을 쓴다. 팔레트 선택 기능이
  // 생기면 요청에서 받아 여기만 바꾸면 된다.
  const palette = DEFAULT_THEME.palette;

  try {
    // 순차로 생성한다. 병렬이 빠르지만, 두 이미지를 독립적으로 만들면 색보정이 같아도
    // 가구가 갈려서 다른 방으로 읽힌다(실물 확인: 좌측 무지 크림 의자 / 우측 플로럴
    // 패턴 의자). 좌측을 먼저 만들고 그것을 레퍼런스로 넘겨야 한 장면이 된다.
    const beforeRes = await generateFrameImage({
      imagePrompt: buildBeforePrompt({ beforeHint, category, productName, palette }),
    });
    const beforeBuf: Buffer = Buffer.from(beforeRes.imageBase64, 'base64');

    const afterBgRes = await generateFrameImage({
      imagePrompt: buildAfterBackgroundPrompt({ afterHint, palette, withReference: true }),
      referenceImages: [{ base64: beforeRes.imageBase64, mimeType: beforeRes.mimeType }],
    });
    let afterBuf: Buffer = Buffer.from(afterBgRes.imageBase64, 'base64');

    // 우측에 제품 합성. 누끼가 실패하면 배경만 쓴다(설계 §8) — 대비 자체는 유지된다.
    if (productImageUrls.length > 0) {
      try {
        const refs = await loadReferenceImages({ productImageUrls });
        if (refs.length > 0) {
          const cutout = await removeBackgroundTransparent(refs[0]!);
          if (cutout) afterBuf = await compositeProduct(afterBuf, cutout);
        }
      } catch (e) {
        console.warn('[generate-compare-image] 제품 합성 실패, 배경만 사용:', e);
      }
    }

    const combined = await composeComparePair(beforeBuf, afterBuf);

    return NextResponse.json({
      success: true,
      data: {
        imageBase64: combined.toString('base64'),
        mimeType: 'image/jpeg',
      },
    });
  } catch (error) {
    console.error('[/api/ai/generate-compare-image] 오류:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: `대비 이미지 생성 실패: ${msg}` },
      { status: 500 },
    );
  }
}
