/**
 * POST /api/image/flux-lifestyle
 *
 * 제품 누끼 이미지 + 씬 힌트 → FLUX Kontext Pro → 라이프스타일 씬 이미지
 * 실패 시 원본 이미지 URL을 fallback으로 반환합니다.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';

export const maxDuration = 120;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 2 };
const REPLICATE_API_BASE = 'https://api.replicate.com/v1';
const FLUX_KONTEXT_MODEL = 'black-forest-labs/flux-kontext-pro';
const POLLING_INTERVAL_MS = 2500;
const POLLING_TIMEOUT_MS = 90_000;
// SSRF 방어: Supabase Storage URL만 허용
const SUPABASE_PATTERN = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\//;
const BUCKET = 'product-images';

const RequestSchema = z.object({
  productImageUrl: z.string().url(),
  promptHint: z.string().max(300),
  sectionContext: z.string().max(100).optional(),
});

type ReplicatePrediction = {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string | string[];
  error?: string;
};

async function pollPrediction(id: string, token: string): Promise<string | null> {
  const deadline = Date.now() + POLLING_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, POLLING_INTERVAL_MS));
    const res = await fetch(`${REPLICATE_API_BASE}/predictions/${id}`, {
      headers: { Authorization: `Token ${token}` },
    });
    if (!res.ok) return null;
    const pred = (await res.json()) as ReplicatePrediction;
    if (pred.status === 'succeeded') {
      const output = Array.isArray(pred.output) ? pred.output[0] : pred.output;
      return output ?? null;
    }
    if (pred.status === 'failed' || pred.status === 'canceled') return null;
  }
  return null;
}

async function uploadToSupabase(imageUrl: string): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseKey);
    const path = `ai-detail/${Date.now()}-flux-lifestyle.jpg`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
    if (error) return null;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  // 인증 검사
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;

  // Rate Limit 검사
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'flux-lifestyle'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: '요청이 너무 많습니다.' }, { status: 429 });
  }

  // 요청 바디 검증
  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? '잘못된 요청' },
      { status: 400 },
    );
  }

  const { productImageUrl, promptHint, sectionContext } = parsed.data;

  // SSRF 방어: Supabase Storage URL만 허용
  if (!SUPABASE_PATTERN.test(productImageUrl)) {
    return NextResponse.json(
      { success: false, error: '허용되지 않는 이미지 URL' },
      { status: 400 },
    );
  }

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    // Replicate 미설정 시 원본 fallback
    return NextResponse.json({ success: true, url: productImageUrl, fallback: true });
  }

  // FLUX Kontext Pro 프롬프트 조합
  const prompt = [
    `Product photography: ${promptHint}`,
    sectionContext ? `Context: ${sectionContext}` : '',
    'Clean background, no people, no text overlay, premium studio lighting, Korean e-commerce style',
  ]
    .filter(Boolean)
    .join('. ');

  try {
    // Replicate 예측 시작 (Prefer: wait 으로 즉시 완료 시도)
    const startRes = await fetch(
      `${REPLICATE_API_BASE}/models/${FLUX_KONTEXT_MODEL}/predictions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'wait',
        },
        body: JSON.stringify({
          input: {
            prompt,
            input_image: productImageUrl,
            output_format: 'jpg',
            output_quality: 90,
          },
        }),
      },
    );

    if (!startRes.ok) {
      return NextResponse.json({ success: true, url: productImageUrl, fallback: true });
    }

    const pred = (await startRes.json()) as ReplicatePrediction;
    let outputUrl: string | null = null;

    if (pred.status === 'succeeded') {
      // Prefer: wait 헤더로 즉시 완료된 경우
      outputUrl = Array.isArray(pred.output) ? (pred.output[0] ?? null) : (pred.output ?? null);
    } else if (pred.status !== 'failed' && pred.status !== 'canceled') {
      // 아직 처리 중이면 폴링
      outputUrl = await pollPrediction(pred.id, token);
    }

    if (!outputUrl) {
      return NextResponse.json({ success: true, url: productImageUrl, fallback: true });
    }

    // Replicate 출력 이미지를 Supabase Storage에 저장
    const savedUrl = await uploadToSupabase(outputUrl);
    return NextResponse.json({ success: true, url: savedUrl ?? outputUrl, fallback: false });
  } catch {
    return NextResponse.json({ success: true, url: productImageUrl, fallback: true });
  }
}
