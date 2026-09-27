import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { uploadToStorage } from '@/lib/supabase/server';
import { scanImagePath } from '@/lib/sourcing-candidates/storage-path';
import { validateFiles } from '@/lib/sourcing-candidates/upload';

/**
 * POST /api/sourcing-candidates/scans — 네이버 캡처 묶음 업로드.
 * 업로드만 하고 반환한다. 판독은 /scans/[id]/parse (영수증과 같은 분리).
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'FormData 파싱 실패' }, { status: 400 });
  }
  const files = formData.getAll('files').filter((f): f is File => f instanceof File);
  const invalid = validateFiles(files);
  if (invalid) return NextResponse.json({ success: false, error: invalid }, { status: 400 });

  const scanId = randomUUID();
  try {
    const paths = await Promise.all(
      files.map(async (f, i) => {
        const path = scanImagePath(user.userId, scanId, i);
        await uploadToStorage(path, await f.arrayBuffer(), 'image/jpeg', f.size);
        return path;
      }),
    );
    const { rows } = await getSourcingPool().query(
      `INSERT INTO sourcing_scans (id, user_id, image_paths) VALUES ($1, $2, $3)
       RETURNING id, parse_status, created_at`,
      [scanId, user.userId, paths],
    );
    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : '업로드 실패' }, { status: 500 });
  }
}

/** GET /api/sourcing-candidates/scans — 최근 스캔 목록 (상품 수·후보 수 포함) */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { rows } = await getSourcingPool().query(
    `SELECT s.id, s.category_path, s.sort_label, s.parse_status, s.parse_error, s.created_at,
            count(l.id)::int AS listing_count,
            count(l.id) FILTER (WHERE l.starred)::int AS starred_count
     FROM sourcing_scans s
     LEFT JOIN sourcing_listings l ON l.scan_id = s.id
     WHERE s.user_id = $1
     GROUP BY s.id
     ORDER BY s.created_at DESC
     LIMIT 50`,
    [user.userId],
  );
  return NextResponse.json({ success: true, data: rows });
}
