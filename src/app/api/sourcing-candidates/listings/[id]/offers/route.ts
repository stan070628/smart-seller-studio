import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { uploadToStorage } from '@/lib/supabase/server';
import { offerImagePath } from '@/lib/sourcing-candidates/storage-path';
import { validateFiles, OFFER_URL_SCHEMA } from '@/lib/sourcing-candidates/upload';
import { parseOffer } from '@/lib/sourcing-candidates/parse-offer';

export const maxDuration = 300;

/** 업체 한 곳은 캡처가 짧다 — 화면 전체가 아니라 가격·옵션 구간만 찍는다 */
const MAX_OFFER_FILES = 4;

/**
 * POST /api/sourcing-candidates/listings/[id]/offers — 1688 업체 1곳 추가.
 * 한 번 올린 묶음 = 업체 1곳. 업체 하나는 판독이 짧아(이미지 1~3장) 업로드와 판독을 한 번에 한다.
 * 판독이 실패해도 업체 행은 남는다 — /offers/[id]/parse로 재시도한다.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const { id: listingId } = await params;
  const pool = getSourcingPool();

  let rowCount: number | null;
  try {
    ({ rowCount } = await pool.query(`SELECT 1 FROM sourcing_listings WHERE id = $1 AND user_id = $2`, [listingId, user.userId]));
  } catch (err) {
    if ((err as { code?: string }).code === '22P02') {
      return NextResponse.json({ success: false, error: '잘못된 id입니다.' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 });
  }
  if (!rowCount) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'FormData 파싱 실패' }, { status: 400 });
  }
  const files = formData.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length > MAX_OFFER_FILES) {
    return NextResponse.json({ success: false, error: `업체 한 곳은 캡처 ${MAX_OFFER_FILES}조각까지입니다.` }, { status: 400 });
  }
  const invalid = validateFiles(files);
  if (invalid) return NextResponse.json({ success: false, error: invalid }, { status: 400 });

  const urlRaw = formData.get('url');
  let url: string | null = null;
  if (typeof urlRaw === 'string' && urlRaw.trim() !== '') {
    const parsedUrl = OFFER_URL_SCHEMA.safeParse(urlRaw);
    if (!parsedUrl.success) {
      return NextResponse.json(
        { success: false, error: parsedUrl.error.issues[0]?.message ?? 'URL이 올바르지 않습니다.' },
        { status: 400 },
      );
    }
    url = parsedUrl.data;
  }

  const offerId = randomUUID();
  try {
    const paths = await Promise.all(
      files.map(async (f, i) => {
        const path = offerImagePath(user.userId, offerId, i);
        await uploadToStorage(path, await f.arrayBuffer(), 'image/jpeg', f.size);
        return path;
      }),
    );
    await pool.query(
      `INSERT INTO sourcing_offers (id, listing_id, user_id, image_paths, url) VALUES ($1, $2, $3, $4, $5)`,
      [offerId, listingId, user.userId, paths, url],
    );
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : '업로드 실패' }, { status: 500 });
  }

  const result = await parseOffer(pool, offerId, user.userId);
  return NextResponse.json({ success: true, data: { id: offerId, parse_error: result?.message ?? null } }, { status: 201 });
}
