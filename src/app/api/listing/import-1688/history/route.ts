import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export interface HistoryItem {
  id: string;
  thumbnailUrl: string;
  detailPageHtml: string;
  createdAt: string;
}

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('generated_assets')
    .select('id, detail_image, detail_html, created_at')
    .eq('user_id', auth.userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const items: HistoryItem[] = (data ?? []).map((row) => ({
    id: row.id as string,
    thumbnailUrl: (row.detail_image as string | null) ?? '',
    detailPageHtml: (row.detail_html as string | null) ?? '',
    createdAt: row.created_at as string,
  }));

  return Response.json({ items });
}
