import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { uploadToStorage } from '@/lib/supabase/server';
import { offerImagePath } from '@/lib/sourcing-candidates/storage-path';
import { validateFiles } from '@/lib/sourcing-candidates/upload';
import { parseOffer } from '@/lib/sourcing-candidates/parse-offer';

export const maxDuration = 60;

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

  const { rowCount } = await pool.query(`SELECT 1 FROM sourcing_listings WHERE id = $1 AND user_id = $2`, [listingId, user.userId]);
  if (!rowCount) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'FormData 파싱 실패' }, { status: 400 });
  }
  const files = formData.getAll('files').filter((f): f is File => f instanceof File);
  const invalid = validateFiles(files);
  if (invalid) return NextResponse.json({ success: false, error: invalid }, { status: 400 });
  const url = formData.get('url');

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
      [offerId, listingId, user.userId, paths, typeof url === 'string' && url ? url : null],
    );
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : '업로드 실패' }, { status: 500 });
  }

  const parseError = await parseOffer(pool, offerId, user.userId);
  return NextResponse.json({ success: true, data: { id: offerId, parse_error: parseError } }, { status: 201 });
}
