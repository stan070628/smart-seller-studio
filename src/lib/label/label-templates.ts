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

export async function getLabelTemplates(): Promise<LabelTemplate[]> {
  const res = await fetch('/api/label/templates');
  if (!res.ok) return [];
  const json = await res.json();
  return json.templates ?? [];
}

export async function saveLabelTemplate(
  name: string,
  imageUrl: string,
  fields: QualityFields,
): Promise<LabelTemplate> {
  const res = await fetch('/api/label/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, imageUrl, fields }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? '템플릿 저장 실패');
  return json.template as LabelTemplate;
}

export async function deleteLabelTemplate(id: string): Promise<void> {
  const res = await fetch(`/api/label/templates?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? '삭제 실패');
  }
}
