import { NextRequest } from 'next/server';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '@/lib/supabase/auth';
import { getAnthropicClient } from '@/lib/ai/claude';
import {
  CLASSIFY_SYSTEM_PROMPT,
  buildClassifyUserPrompt,
  parseClassifyResponse,
} from '@/lib/ai/prompts/import-1688';
import type { ClassifyResponse } from '@/lib/listing/import-1688-types';

export const maxDuration = 60;

const requestSchema = z.object({
  imageUrls: z.array(z.string().url().refine((u) => u.startsWith('https://'), '이미지 URL은 https만 허용됩니다.')).min(1).max(20),
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

  const { imageUrls } = parsed.data;

  try {
    const client: Anthropic = getAnthropicClient();
    const imageBlocks: Anthropic.ImageBlockParam[] = imageUrls.map((url) => ({
      type: 'image',
      source: { type: 'url', url },
    }));

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: CLASSIFY_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            ...imageBlocks,
            { type: 'text', text: buildClassifyUserPrompt(imageUrls.length) },
          ],
        },
      ],
    });

    const rawText =
      response.content.length > 0 && response.content[0].type === 'text'
        ? response.content[0].text
        : '';
    const images = parseClassifyResponse(rawText, imageUrls);

    return Response.json({ images } satisfies ClassifyResponse);
  } catch (err) {
    console.error('[classify] Claude Vision 오류:', err);
    return Response.json({ error: '이미지 분류 중 오류가 발생했습니다.' }, { status: 502 });
  }
}
