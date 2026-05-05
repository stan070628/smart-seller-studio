import { getBrowserClient } from '@/lib/supabase/client';

export interface QualityFields {
  productName: string;
  material: string;
  size: string;
  country: string;
  importer: string;
  address: string;
  phone: string;
  extra: string;
}

export interface LabelTemplate {
  id: string;
  user_id: string;
  name: string;
  image_url: string;
  fields: QualityFields;
  created_at: string;
}

async function getUserId(): Promise<string | null> {
  const supabase = getBrowserClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function getLabelTemplates(): Promise<LabelTemplate[]> {
  const userId = await getUserId();
  if (!userId) return [];

  const supabase = getBrowserClient();
  const { data, error } = await supabase
    .from('label_templates')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data as LabelTemplate[];
}

export async function saveLabelTemplate(
  name: string,
  imageUrl: string,
  fields: QualityFields,
): Promise<LabelTemplate> {
  const userId = await getUserId();
  if (!userId) throw new Error('로그인이 필요합니다.');

  const supabase = getBrowserClient();
  const { data, error } = await supabase
    .from('label_templates')
    .insert({ user_id: userId, name, image_url: imageUrl, fields })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? '템플릿 저장 실패');
  return data as LabelTemplate;
}

export async function deleteLabelTemplate(id: string): Promise<void> {
  const supabase = getBrowserClient();
  const { error } = await supabase.from('label_templates').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
