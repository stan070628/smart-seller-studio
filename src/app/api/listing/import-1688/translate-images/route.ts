import { NextRequest } from 'next/server';
import { z } from 'zod';
import pLimit from 'p-limit';
import { requireAuth } from '@/lib/supabase/auth';
import { translateImage } from '@/lib/listing/image-translator';
import type {
  TranslatedImage,
  TranslateImagesResponse,
} from '@/lib/listing/import-1688-types';

export const maxDuration = 120;

const httpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith('https://'), '이미지 URL은 https만 허용됩니다.');

const requestSchema = z.object({
  images: z
    .array(
      z.object({
        url: httpsUrl,
        type: z.enum(['main_product', 'lifestyle', 'infographic', 'size_chart']),
      })
    )
    .min(1)
    .max(20),
});

const CONCURRENCY = 5;

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '잘못된 요청 바디입니다.' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const { images } = parsed.data;
  const limit = pLimit(CONCURRENCY);

  const results: TranslatedImage[] = await Promise.all(
    images.map((img) =>
      limit(async (): Promise<TranslatedImage> => {
        if (img.type === 'lifestyle') {
          return {
            url: img.url,
            type: img.type,
            translatedUrl: null,
            translationStatus: 'skipped',
          };
        }
        const r = await translateImage(img.url);
        return {
          url: img.url,
          type: img.type,
          translatedUrl: r.translatedUrl,
          translationStatus: r.status,
        };
      })
    )
  );

  return Response.json({ images: results } satisfies TranslateImagesResponse);
}
