import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { uploadToStorage } from '@/lib/supabase/server';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return NextResponse.json(await auth.json(), { status: auth.status });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid form data' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ success: false, error: 'file required' }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.includes(file.type as AllowedMimeType)) {
    return NextResponse.json({ success: false, error: 'unsupported file type' }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ success: false, error: 'file too large' }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `labels/${auth.userId}/${timestamp}_${safeName}`;

  const result = await uploadToStorage(storagePath, buffer, file.type, file.size);

  return NextResponse.json(
    { success: true, data: { url: result.url, fileName: file.name } },
    { status: 201 },
  );
}
