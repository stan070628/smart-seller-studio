import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import sharp from 'sharp';
import { getAnthropicClient } from '@/lib/ai/claude';
import { uploadToStorage } from '@/lib/supabase/server';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { requireAuth } from '@/lib/supabase/auth';

export const maxDuration = 60;

const RATE_LIMIT = { windowMs: 60_000, maxRequests: 5 };

type SectionType = 'hero' | 'lifestyle' | 'detail' | 'feature';
const SECTIONS: SectionType[] = ['hero', 'lifestyle', 'detail', 'feature'];

const RequestSchema = z.object({
  imageUrls: z.array(z.string().url()).min(1).max(8),
});

interface ProcessedImage {
  originalImageUrl: string;
  croppedImageUrl: string;
  suggestedSectionType: SectionType;
  cropBox?: { x: number; y: number; width: number; height: number };
}

export async function POST(req: NextRequest) {
  // 인증 검사
  const authResult = await requireAuth(req);
  if (authResult instanceof Response) return authResult as NextResponse;

  // Rate Limit 검사
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';
  const rl = checkRateLimit(getRateLimitKey(ip, 'analyze-detail-images'), RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다.' },
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

  const { imageUrls } = parsed.data;
  const client = getAnthropicClient();
  const processedImages: ProcessedImage[] = [];

  for (const imageUrl of imageUrls) {
    try {
      const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
      if (!imgRes.ok) continue;
      const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

      const metadata = await sharp(imgBuffer).metadata();
      const { width = 0, height = 0, format } = metadata;
      // 세로가 가로의 2.5배 초과인 경우 긴 이미지로 판단 → Claude Vision에 cropBox 제안 요청
      const isLongImage = height > 2.5 * width;
      const mediaType = format === 'png' ? 'image/png' : 'image/jpeg';
      const imageBase64 = imgBuffer.toString('base64');

      if (isLongImage) {
        // 긴 이미지: Claude Sonnet으로 구역별 cropBox 좌표 추출
        try {
          const response = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 512,
            messages: [{
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: mediaType as 'image/jpeg' | 'image/png', data: imageBase64 },
                },
                {
                  type: 'text',
                  text: `이 상품상세 이미지에서 히어로(대표 제품), 라이프스타일(생활 연출), 디테일(소재/클로즈업), 특징(기능 강조) 섹션에 쓸 수 있는 영역을 JSON으로 반환하세요. 좌표는 이미지 전체 크기 대비 0~1 비율입니다. {"crops":[{"sectionType":"hero"|"lifestyle"|"detail"|"feature","cropBox":{"x":0~1,"y":0~1,"width":0~1,"height":0~1}}]}. JSON만 반환하세요.`,
                },
              ],
            }],
          });

          const text = response.content[0].type === 'text' ? response.content[0].text : '';
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const claudeResult = JSON.parse(jsonMatch[0]) as {
              crops?: Array<{ sectionType: SectionType; cropBox: { x: number; y: number; width: number; height: number } }>;
            };

            for (const crop of (claudeResult.crops ?? []).slice(0, 4)) {
              const cb = crop.cropBox;
              const x = Math.max(0, Math.min(0.99, cb.x));
              const y = Math.max(0, Math.min(0.99, cb.y));
              const w = Math.max(0.05, Math.min(1 - x, cb.width));
              const h = Math.max(0.05, Math.min(1 - y, cb.height));

              // 너무 작은 크롭 영역(10% 미만)은 의미 없으므로 원본 URL 그대로 사용
              if (w < 0.1 || h < 0.1) {
                processedImages.push({ originalImageUrl: imageUrl, croppedImageUrl: imageUrl, suggestedSectionType: crop.sectionType });
                continue;
              }

              const left = Math.round(x * width);
              const top = Math.round(y * height);
              const cropWidth = Math.round(w * width);
              const cropHeight = Math.round(h * height);

              const croppedBuffer = await sharp(imgBuffer)
                .extract({ left, top, width: cropWidth, height: cropHeight })
                .toBuffer();

              // Buffer → ArrayBuffer 변환 (uploadToStorage 시그니처 맞춤)
              const croppedArrayBuffer = croppedBuffer.buffer.slice(
                croppedBuffer.byteOffset,
                croppedBuffer.byteOffset + croppedBuffer.byteLength,
              );
              const croppedPath = `ai-detail/${Date.now()}-crop-${crop.sectionType}.jpg`;
              const uploadResult = await uploadToStorage(croppedPath, croppedArrayBuffer, 'image/jpeg', croppedBuffer.byteLength);

              processedImages.push({
                originalImageUrl: imageUrl,
                croppedImageUrl: uploadResult.url,
                suggestedSectionType: crop.sectionType,
                cropBox: { x, y, width: w, height: h },
              });
            }
          } else {
            // JSON 파싱 실패 → hero로 폴백
            processedImages.push({ originalImageUrl: imageUrl, croppedImageUrl: imageUrl, suggestedSectionType: 'hero' });
          }
        } catch {
          // Claude Vision 실패 → hero로 폴백
          processedImages.push({ originalImageUrl: imageUrl, croppedImageUrl: imageUrl, suggestedSectionType: 'hero' });
        }
      } else {
        // 일반 이미지: Claude Haiku로 섹션 타입 분류
        let sectionType: SectionType = 'hero';
        try {
          const response = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 10,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/jpeg' | 'image/png', data: imageBase64 } },
                { type: 'text', text: '이 이미지의 역할을 하나만 반환하세요: hero, lifestyle, detail, feature' },
              ],
            }],
          });
          const text = response.content[0].type === 'text' ? response.content[0].text.trim().toLowerCase() : 'hero';
          if (SECTIONS.includes(text as SectionType)) sectionType = text as SectionType;
        } catch {
          // Claude 분류 실패 → 기본값 hero 유지
        }
        processedImages.push({ originalImageUrl: imageUrl, croppedImageUrl: imageUrl, suggestedSectionType: sectionType });
      }
    } catch {
      // 이미지 fetch 실패 시 건너뜀
    }
  }

  // 처리된 이미지가 없으면 원본 URL로 4개 섹션 모두 채움
  if (processedImages.length === 0) {
    const fallbackUrl = imageUrls[0] ?? '';
    SECTIONS.forEach((s) => processedImages.push({ originalImageUrl: fallbackUrl, croppedImageUrl: fallbackUrl, suggestedSectionType: s }));
  }

  // 4개 섹션 모두 채우기: 부족한 섹션은 circular reuse
  const crops = SECTIONS.map((sectionType, idx) => {
    const existing = processedImages.find(p => p.suggestedSectionType === sectionType);
    const fallback = processedImages[idx % processedImages.length];
    const source = existing ?? fallback;
    return {
      id: `crop-${sectionType}-${Date.now()}-${idx}`,
      originalImageUrl: source.originalImageUrl,
      croppedImageUrl: source.croppedImageUrl,
      sectionType,
      ...(source.cropBox ? { cropBox: source.cropBox } : {}),
    };
  });

  return NextResponse.json({ success: true, crops });
}
