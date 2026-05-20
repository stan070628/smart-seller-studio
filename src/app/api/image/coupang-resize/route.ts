import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { z } from 'zod';

const BUCKET = 'smart-seller-studio';
const FOLDER = 'coupang-resized';
const MIN_PX = 1000;
const MAX_PX = 5000;
const MAX_BYTES = 10 * 1024 * 1024;

const Schema = z.object({ imageUrl: z.string().url() });

export async function POST(req: Request) {
  try {
    const body = Schema.parse(await req.json());
    const { imageUrl } = body;

    // 이미 처리된 URL이면 재처리 없이 반환
    if (imageUrl.includes(`/${FOLDER}/`)) {
      return NextResponse.json({ url: imageUrl });
    }

    const fetchRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (!fetchRes.ok) {
      return NextResponse.json({ error: `이미지 fetch 실패 (${fetchRes.status})` }, { status: 502 });
    }
    const inputBuf = Buffer.from(await fetchRes.arrayBuffer());

    const meta = await sharp(inputBuf).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    const shortest = Math.min(w, h);
    const longest = Math.max(w, h);

    let pipeline = sharp(inputBuf);
    if (shortest < MIN_PX) {
      // shortest side를 MIN_PX로 맞추면서 비율 유지
      pipeline = pipeline.resize(MIN_PX, MIN_PX, { fit: 'outside' });
    } else if (longest > MAX_PX) {
      pipeline = pipeline.resize(MAX_PX, MAX_PX, { fit: 'inside', withoutEnlargement: true });
    }
    let outBuf = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    if (outBuf.length > MAX_BYTES) {
      outBuf = await sharp(outBuf).jpeg({ quality: 55, mozjpeg: true }).toBuffer();
    }

    const supabase = getSupabaseServerClient();
    const fileName = `${FOLDER}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(fileName, outBuf, {
      contentType: 'image/jpeg',
      upsert: false,
    });
    if (uploadError) {
      return NextResponse.json({ error: `저장 실패: ${uploadError.message}` }, { status: 500 });
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
    return NextResponse.json({ url: data.publicUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
