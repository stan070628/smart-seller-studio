import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '@/lib/ai/claude';
import {
  TRANSLATE_OVERLAY_SYSTEM_PROMPT,
  buildTranslateOverlayUserPrompt,
  parseTranslateOverlayResponse,
} from '@/lib/ai/prompts/translate-overlay';
import { extractTextBlocks, type TextBlock } from '@/lib/listing/gemini-vision-client';
import { composeOverlay, type OverlayBlock } from '@/lib/listing/sharp-overlay';
import {
  getCachedTranslation,
  saveTranslation,
  hashImageUrl,
} from '@/lib/listing/translation-cache';
import { getSupabaseServerClient, STORAGE_BUCKET } from '@/lib/supabase/server';
import { assertSafeUrl } from '@/lib/listing/url-safety';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export interface TranslateImageResult {
  originalUrl: string;
  translatedUrl: string | null;
  status: 'ok' | 'no_text' | 'failed';
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function downloadImage(url: string): Promise<Buffer> {
  assertSafeUrl(url);
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`이미지 다운로드 실패: ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? '0');
  if (len > MAX_IMAGE_BYTES) throw new Error('이미지 크기가 너무 큽니다.');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new Error('이미지 크기가 너무 큽니다.');
  return buf;
}

/** Storage에 idempotent 업로드 (upsert: true). 동시 처리 시 충돌 안 함. */
async function uploadTranslatedImage(path: string, buffer: Buffer): Promise<string> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error(`[image-translator] Storage 업로드 실패: ${error.message}`);
  const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return urlData.publicUrl;
}

async function translateBlocks(blocks: TextBlock[]): Promise<string[]> {
  if (blocks.length === 0) return [];
  const client: Anthropic = getAnthropicClient();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: TRANSLATE_OVERLAY_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildTranslateOverlayUserPrompt(blocks.map((b) => b.text)) },
        ],
      },
    ],
  });
  const rawText =
    response.content.length > 0 && response.content[0].type === 'text'
      ? response.content[0].text
      : '';
  return parseTranslateOverlayResponse(rawText, blocks.length);
}

export async function translateImage(originalUrl: string): Promise<TranslateImageResult> {
  // 1. 캐시 조회 — 'failed' 항목은 일시적 오류일 수 있어 재시도 (캐시 미스로 취급)
  const cached = await getCachedTranslation(originalUrl);
  if (cached && cached.status !== 'failed') {
    return {
      originalUrl,
      translatedUrl: cached.translated_url,
      status: cached.status,
    };
  }

  try {
    // 2. 이미지 다운로드
    const imageBuffer = await downloadImage(originalUrl);

    // 3. OCR (재시도 1회)
    const blocks = await withRetry(() => extractTextBlocks(imageBuffer));
    if (blocks.length === 0) {
      await saveTranslation({
        original_url: originalUrl,
        translated_url: null,
        ocr_blocks: [],
        status: 'no_text',
      });
      return { originalUrl, translatedUrl: null, status: 'no_text' };
    }

    // 4. 번역 (재시도 1회)
    const koreans = await withRetry(() => translateBlocks(blocks));

    // 5. 합성
    const overlayBlocks: OverlayBlock[] = blocks.map((b, i) => ({
      text_ko: koreans[i] ?? '',
      bbox: b.bbox,
    }));
    const composed = await composeOverlay(imageBuffer, overlayBlocks);

    // 6. 업로드 (upsert: true로 동시 처리 충돌 방지)
    const storagePath = `1688-translations/${hashImageUrl(originalUrl)}.jpg`;
    const translatedUrl = await uploadTranslatedImage(storagePath, composed);

    // 7. 캐시 저장
    const ocrBlocks = blocks.map((b, i) => ({
      text_zh: b.text,
      text_ko: koreans[i] ?? '',
      bbox: b.bbox,
    }));
    await saveTranslation({
      original_url: originalUrl,
      translated_url: translatedUrl,
      ocr_blocks: ocrBlocks,
      status: 'ok',
    });

    return { originalUrl, translatedUrl, status: 'ok' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[image-translator]', originalUrl, message);
    try {
      await saveTranslation({
        original_url: originalUrl,
        translated_url: null,
        ocr_blocks: null,
        status: 'failed',
        error_message: message,
      });
    } catch {
      // 캐시 저장 실패는 무시
    }
    return { originalUrl, translatedUrl: null, status: 'failed' };
  }
}
