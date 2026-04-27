/**
 * 쿠팡 이미지 등록 규격 적용 유틸리티
 *
 * 규격:
 *   - 최소 500 × 500 px
 *   - 최대 5000 × 5000 px
 *   - 파일 크기 최대 10 MB
 *
 * 규격을 벗어난 이미지를 Sharp로 보정 후 Supabase Storage에 재업로드하여
 * 새 public URL을 반환합니다. 이미 규격을 만족하면 원본 URL을 그대로 반환합니다.
 */

import sharp from 'sharp';
import { getSupabaseServerClient } from '@/lib/supabase/server';

const MIN_PX = 500;
const MAX_PX = 5000;
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const BUCKET = 'smart-seller-studio';
const FETCH_TIMEOUT_MS = 15_000;

/**
 * 단일 이미지 URL을 쿠팡 규격에 맞게 보정합니다.
 * 보정이 필요 없으면 원본 URL을 반환합니다.
 */
export async function ensureCoupangImage(imageUrl: string): Promise<string> {
  // Supabase Storage에 이미 저장된 이미지는 그대로 사용
  // (생성 시 이미 규격 적용됨)
  if (imageUrl.includes('supabase.co/storage')) {
    // 파일 크기만 확인할 수 없으므로 치수 검사는 생략하고 그대로 사용
    return imageUrl;
  }

  try {
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return imageUrl;

    const inputBuffer = Buffer.from(await res.arrayBuffer());
    const metadata = await sharp(inputBuffer).metadata();
    const w = metadata.width ?? 0;
    const h = metadata.height ?? 0;

    const tooSmall = w < MIN_PX || h < MIN_PX;
    const tooBig = w > MAX_PX || h > MAX_PX;
    const tooHeavy = inputBuffer.length > MAX_BYTES;

    if (!tooSmall && !tooBig && !tooHeavy) return imageUrl;

    let pipeline = sharp(inputBuffer);

    if (tooSmall) {
      // 짧은 쪽을 MIN_PX로 맞춤 (비율 유지)
      const scale = Math.max(MIN_PX / Math.max(w, 1), MIN_PX / Math.max(h, 1));
      const newW = Math.min(Math.round(w * scale), MAX_PX);
      const newH = Math.min(Math.round(h * scale), MAX_PX);
      pipeline = pipeline.resize(newW, newH, { fit: 'fill' });
    } else if (tooBig) {
      // 긴 쪽을 MAX_PX로 맞춤 (비율 유지)
      pipeline = pipeline.resize(MAX_PX, MAX_PX, { fit: 'inside', withoutEnlargement: true });
    }

    const quality = tooHeavy ? 72 : 85;
    const processed = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();

    // 처리 후에도 10MB 초과 시 품질을 더 낮춤
    const finalBuffer =
      processed.length > MAX_BYTES
        ? await sharp(processed).jpeg({ quality: 55, mozjpeg: true }).toBuffer()
        : processed;

    const supabase = getSupabaseServerClient();
    const storagePath = `coupang-images/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, finalBuffer, { contentType: 'image/jpeg' });

    if (uploadError) {
      console.warn('[coupang-constraints] 재업로드 실패:', uploadError.message);
      return imageUrl;
    }

    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    console.log(`[coupang-constraints] ${w}×${h} → 재업로드: ${storagePath}`);
    return publicUrl;
  } catch (err) {
    console.warn('[coupang-constraints] 이미지 처리 실패, 원본 사용:', imageUrl, err);
    return imageUrl;
  }
}

/**
 * 이미지 URL 배열 전체를 쿠팡 규격으로 보정합니다 (병렬 처리).
 */
export async function ensureCoupangImages(imageUrls: string[]): Promise<string[]> {
  return Promise.all(imageUrls.map((url) => ensureCoupangImage(url)));
}
