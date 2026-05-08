import { createHash } from 'node:crypto';
import { getSupabaseServerClient } from '@/lib/supabase/server';

const TABLE = 'image_translations';

export interface CachedTranslation {
  image_url_hash: string;
  original_url: string;
  translated_url: string | null;
  ocr_blocks: Array<{
    text_zh: string;
    text_ko: string;
    bbox: { x: number; y: number; w: number; h: number };
  }> | null;
  status: 'ok' | 'no_text' | 'failed';
  error_message: string | null;
}

export function hashImageUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}

export async function getCachedTranslation(url: string): Promise<CachedTranslation | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('image_url_hash', hashImageUrl(url))
    .single();

  if (error) {
    if ((error as { code?: string }).code === 'PGRST116') return null; // no rows
    throw new Error(`[translation-cache] 조회 실패: ${error.message ?? error}`);
  }
  return data as CachedTranslation;
}

interface SaveInput {
  original_url: string;
  translated_url: string | null;
  ocr_blocks: CachedTranslation['ocr_blocks'];
  status: CachedTranslation['status'];
  error_message?: string | null;
}

export async function saveTranslation(input: SaveInput): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from(TABLE)
    .upsert(
      {
        image_url_hash: hashImageUrl(input.original_url),
        original_url: input.original_url,
        translated_url: input.translated_url,
        ocr_blocks: input.ocr_blocks,
        status: input.status,
        error_message: input.error_message ?? null,
      },
      { onConflict: 'image_url_hash' }
    );
  if (error) {
    throw new Error(`[translation-cache] 저장 실패: ${error.message}`);
  }
}
