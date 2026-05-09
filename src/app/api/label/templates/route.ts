// src/app/api/label/templates/route.ts
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { LabelType } from '@/lib/label/label-templates';

const VALID_TYPES: LabelType[] = ['quality', 'quality2x3', 'event', 'image2x2', 'nutrition2x3'];

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const rawType = request.nextUrl.searchParams.get('type') ?? 'quality';
  const labelType: LabelType = VALID_TYPES.includes(rawType as LabelType)
    ? (rawType as LabelType)
    : 'quality';

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('label_templates')
    .select('*')
    .eq('user_id', auth.userId)
    .eq('label_type', labelType)
    .order('created_at', { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ templates: data ?? [] });
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '잘못된 요청 바디입니다.' }, { status: 400 });
  }

  const { name, labelType, fields } = body as {
    name?: string;
    labelType?: string;
    fields?: Record<string, unknown>;
  };

  if (!name?.trim()) {
    return Response.json({ error: '템플릿 이름을 입력해주세요.' }, { status: 400 });
  }

  const resolvedType: LabelType = VALID_TYPES.includes(labelType as LabelType)
    ? (labelType as LabelType)
    : 'quality';

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('label_templates')
    .insert({
      user_id: auth.userId,
      name: name.trim(),
      image_url: '',
      label_type: resolvedType,
      fields: fields ?? {},
    })
    .select()
    .single();

  if (error || !data) {
    return Response.json({ error: error?.message ?? '저장 실패' }, { status: 500 });
  }

  return Response.json({ template: data }, { status: 201 });
}

export async function DELETE(request: NextRequest): Promise<Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return Response.json({ error: 'id가 필요합니다.' }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from('label_templates')
    .delete()
    .eq('id', id)
    .eq('user_id', auth.userId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}
