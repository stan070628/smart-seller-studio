import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getCurrentUser } from '@/lib/auth';
import { getSourcingPool } from '@/lib/sourcing/db';
import { uploadToStorage } from '@/lib/supabase/server';
import { receiptImagePath } from '@/lib/receipt/storage-path';
import { ALLOWED_MIME_TYPES, type AllowedMimeType } from '@/lib/ai/claude-vision';

/** 장당 최대 크기. 아이폰 원본이 6MB 안팎이다 */
const MAX_FILE_SIZE = 15 * 1024 * 1024;
/** 긴 영수증은 나눠 찍으므로 여러 장을 받는다 */
const MAX_FILES = 5;

/**
 * POST /api/receipts — 영수증 이미지 업로드
 *
 * 업로드만 하고 즉시 반환한다. 판독은 POST /api/receipts/[id]/parse가 한다.
 * 매장에서 12~14초를 기다리게 하지 않기 위한 분리다.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json(
      { success: false, error: 'Content-Type은 multipart/form-data여야 합니다.' },
      { status: 400 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'FormData 파싱 실패' }, { status: 400 });
  }

  const files = formData.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ success: false, error: 'files 필드가 비어 있습니다.' }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { success: false, error: `이미지는 최대 ${MAX_FILES}장까지입니다.` },
      { status: 400 },
    );
  }

  for (const f of files) {
    if (!ALLOWED_MIME_TYPES.includes(f.type as AllowedMimeType)) {
      return NextResponse.json(
        { success: false, error: `지원하지 않는 형식: ${f.type}` },
        { status: 415 },
      );
    }
    if (f.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: `파일이 너무 큽니다: ${f.name}` },
        { status: 413 },
      );
    }
  }

  // draft id를 먼저 만든다 — 저장 경로에 들어가야 하기 때문이다
  const draftId = randomUUID();

  let imagePaths: string[];
  try {
    imagePaths = await Promise.all(
      files.map(async (f, i) => {
        const mime = f.type as AllowedMimeType;
        const path = receiptImagePath(user.userId, draftId, i, mime);
        const buf = await f.arrayBuffer();
        await uploadToStorage(path, buf, mime, f.size);
        return path;
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : '업로드 실패';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }

  try {
    const pool = getSourcingPool();
    const { rows } = await pool.query(
      `INSERT INTO receipt_drafts (id, user_id, image_paths, ocr_status, status)
       VALUES ($1, $2, $3, 'pending', 'draft')
       RETURNING id, ocr_status, status, created_at`,
      [draftId, user.userId, imagePaths],
    );

    return NextResponse.json({ success: true, data: rows[0] }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
