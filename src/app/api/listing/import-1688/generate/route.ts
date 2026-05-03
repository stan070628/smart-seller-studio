import { NextRequest } from 'next/server';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '@/lib/supabase/auth';
import { getAnthropicClient } from '@/lib/ai/claude';
import {
  GENERATE_SYSTEM_PROMPT,
  buildGenerateUserPrompt,
  parseGenerateContent,
} from '@/lib/ai/prompts/import-1688';
import { buildDetailPageHtml } from '@/lib/detail-page/html-builder';
import { generateAndUploadThumbnail } from '@/lib/listing/import-1688-thumbnail';
import type { GenerateResponse } from '@/lib/listing/import-1688-types';

const classifiedImageSchema = z.object({
  url: z.string().url(),
  type: z.enum(['main_product', 'lifestyle', 'infographic', 'size_chart']),
});

const requestSchema = z.object({
  images: z.array(classifiedImageSchema).min(1).max(20),
  thumbnailUrl: z.string().url(),
  sessionId: z.string().min(1).max(64),
});

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

  const { images, thumbnailUrl, sessionId } = parsed.data;

  // 1. Claude Vision — 한국어 콘텐츠 생성
  let detailPageHtml: string;
  let headlineForThumbnail: string;
  try {
    const client: Anthropic = getAnthropicClient();
    const imageBlocks: Anthropic.ImageBlockParam[] = images.map((img) => ({
      type: 'image',
      source: { type: 'url', url: img.url },
    }));

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: GENERATE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            ...imageBlocks,
            { type: 'text', text: buildGenerateUserPrompt() },
          ],
        },
      ],
    });

    const rawText =
      response.content[0].type === 'text' ? response.content[0].text : '';
    const content = parseGenerateContent(rawText);
    headlineForThumbnail = content.headline;

    const imageInputs = images.map((img) => ({
      imageBase64: '',
      mimeType: 'image/jpeg' as const,
      publicUrl: img.url,
    }));

    detailPageHtml = buildDetailPageHtml(content, imageInputs);
  } catch (err) {
    console.error('[generate] Claude Vision 오류:', err);
    return Response.json({ error: '콘텐츠 생성 중 오류가 발생했습니다.' }, { status: 502 });
  }

  // 2. Sharp — 썸네일 생성 + Supabase 업로드
  let generatedThumbnailUrl: string;
  try {
    generatedThumbnailUrl = await generateAndUploadThumbnail(
      thumbnailUrl,
      headlineForThumbnail,
      sessionId
    );
  } catch (err) {
    console.error('[generate] 썸네일 생성 오류:', err);
    return Response.json({ error: '썸네일 생성 중 오류가 발생했습니다.' }, { status: 502 });
  }

  return Response.json({
    thumbnailUrl: generatedThumbnailUrl,
    detailPageHtml,
  } satisfies GenerateResponse);
}
