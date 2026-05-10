import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSupabaseServerClient } from '@/lib/supabase/server';

type UsageContext = 'editor' | 'listing_thumbnail' | 'listing_detail';

interface ImageItem {
  id: string;
  url: string;
  fileName: string | null;
  usageContext: UsageContext | null;
  createdAt: string;
}

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const usageContext = searchParams.get('usageContext') as UsageContext | null;
  const limitParam = Number(searchParams.get('limit') ?? 60);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 60;

  const supabase = getSupabaseServerClient();
  let query = supabase
    .from('assets')
    .select('id, public_url, file_name, usage_context, created_at')
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (usageContext === 'listing_thumbnail' || usageContext === 'listing_detail' || usageContext === 'editor') {
    query = query.eq('usage_context', usageContext);
  }

  const { data, error } = await query;
  if (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }

  const items: ImageItem[] = (data ?? [])
    .filter((row) => typeof row.public_url === 'string' && row.public_url.length > 0)
    .map((row) => ({
      id: row.id as string,
      url: row.public_url as string,
      fileName: (row.file_name as string | null) ?? null,
      usageContext: (row.usage_context as UsageContext | null) ?? null,
      createdAt: row.created_at as string,
    }));

  return Response.json({ success: true, items });
}
