/**
 * POST /api/ai/cleanup-image-region
 *
 * Replicate FLUX Fill Dev 인페인팅 모델로 선택 영역의 한자/워터마크를 제거합니다.
 * 주변 배경 텍스처를 분석해 자연스럽게 채워줌 — Gemini 방식 대비 왜곡 없음.
 */

import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';

export const maxDuration = 90;

// SSRF 방어: Supabase Storage URL만 허용
const SUPABASE_PATTERN = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\//;

const MAX_DIM = 2000;
const REPLICATE_API = 'https://api.replicate.com/v1';
const FLUX_FILL_MODEL = 'black-forest-labs/flux-fill-dev';
const POLLING_INTERVAL_MS = 500;
const POLLING_TIMEOUT_MS = 70_000;

type ReplicatePrediction = {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed';
  output?: string | string[];
  error?: string;
};

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

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'Replicate API가 설정되지 않았습니다.' }, { status: 500 });
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

    const origBuffer = await img.clone().png().toBuffer();

    // 선택 영역 → 픽셀 좌표 + 패딩
    const px = { x: x * W, y: y * H, w: width * W, h: height * H };
    const pad = Math.max(30, Math.round(Math.min(px.w, px.h) * 0.3));
    const mx = Math.max(0, Math.floor(px.x - pad));
    const my = Math.max(0, Math.floor(px.y - pad));
    const mw = Math.min(W - mx, Math.ceil(px.w + pad * 2));
    const mh = Math.min(H - my, Math.ceil(px.h + pad * 2));

    // 마스크 생성: 검은 배경 + 제거할 영역 흰색
    // LaMa 규약: 흰색 = 채우기(inpaint), 검은색 = 보존
    const maskSvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
      `<rect width="${W}" height="${H}" fill="black"/>` +
      `<rect x="${mx}" y="${my}" width="${mw}" height="${mh}" fill="white"/>` +
      `</svg>`,
    );
    const maskBuffer = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite([{ input: maskSvg, blend: 'over' }])
      .png()
      .toBuffer();

    const imageDataUrl = `data:image/png;base64,${origBuffer.toString('base64')}`;
    const maskDataUrl = `data:image/png;base64,${maskBuffer.toString('base64')}`;

    // Replicate FLUX Fill Dev 예측 시작
    // guidance 낮게 설정 → 창의적 생성 최소화, 주변 컨텍스트 기반으로 채움
    const startRes = await fetch(`${REPLICATE_API}/models/${FLUX_FILL_MODEL}/predictions`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'wait',
      },
      body: JSON.stringify({
        input: {
          image: imageDataUrl,
          mask: maskDataUrl,
          prompt: 'seamless background texture, clean surface',
          guidance: 3,
          megapixels: 'match_input',
          output_format: 'png',
          output_quality: 100,
          disable_safety_checker: true,
        },
      }),
      signal: AbortSignal.timeout(80_000),
    });

    if (!startRes.ok) {
      const errText = await startRes.text().catch(() => '');
      throw new Error(`Replicate 시작 오류: ${startRes.status} ${errText.slice(0, 200)}`);
    }

    let prediction = (await startRes.json()) as ReplicatePrediction;

    // 폴링 (Prefer: wait에서 즉시 완료되지 않은 경우)
    const deadline = Date.now() + POLLING_TIMEOUT_MS;
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
      if (Date.now() > deadline) {
        return NextResponse.json({ error: '시간이 초과됐습니다. 다시 시도해주세요.' }, { status: 500 });
      }
      await new Promise<void>(r => setTimeout(r, POLLING_INTERVAL_MS));

      const pollRes = await fetch(`${REPLICATE_API}/predictions/${prediction.id}`, {
        headers: { Authorization: `Token ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!pollRes.ok) throw new Error(`Replicate 폴링 오류: ${pollRes.status}`);
      prediction = (await pollRes.json()) as ReplicatePrediction;
    }

    if (prediction.status === 'failed' || !prediction.output) {
      throw new Error(prediction.error ?? 'FLUX Fill 처리에 실패했습니다.');
    }

    // 결과 URL 추출 (단일 문자열 또는 배열 모두 처리)
    const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    if (!outputUrl) throw new Error('결과 이미지 URL이 없습니다.');

    // 결과 이미지 다운로드 → JPEG 변환
    const outRes = await fetch(outputUrl, { signal: AbortSignal.timeout(15_000) });
    if (!outRes.ok) throw new Error(`결과 다운로드 실패: ${outRes.status}`);
    const outBuffer = Buffer.from(await outRes.arrayBuffer());

    const resultJpeg = await sharp(outBuffer).jpeg({ quality: 92 }).toBuffer();

    return NextResponse.json({
      imageBase64: resultJpeg.toString('base64'),
      mimeType: 'image/jpeg',
    });
  } catch (err) {
    console.error('[cleanup-image-region]', err);
    const message = err instanceof Error ? err.message : '처리 중 오류가 발생했습니다.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
