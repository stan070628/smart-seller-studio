// src/lib/label/label-templates.ts

export type LabelType = 'quality' | 'quality2x3' | 'event' | 'image2x2' | 'image2x3' | 'image3x3' | 'nutrition2x3' | 'cosmetic2x3';

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

export interface CosmeticFields {
  collection: 'floral' | 'creamy';
  soap1En: string; soap1Ko: string; soap1Ingredients: string;
  soap2En: string; soap2Ko: string; soap2Ingredients: string;
  soap3En: string; soap3Ko: string; soap3Ingredients: string;
  soap4En: string; soap4Ko: string; soap4Ingredients: string;
  weight: string;
  lotNumber: string;
  expiryDate: string;
  importer: string;
  importerAddress: string;
  phone: string;
}

export interface LabelTemplate {
  id: string;
  user_id: string;
  name: string;
  image_url: string;
  label_type: LabelType;
  fields: Record<string, unknown>;
  created_at: string;
}

export async function getLabelTemplates(labelType: LabelType): Promise<LabelTemplate[]> {
  try {
    const res = await fetch(`/api/label/templates?type=${encodeURIComponent(labelType)}`);
    if (!res.ok) return [];
    const json = await res.json();
    return json.templates ?? [];
  } catch {
    return [];
  }
}

export async function saveLabelTemplate(
  name: string,
  labelType: LabelType,
  fields: Record<string, unknown>,
): Promise<LabelTemplate> {
  const res = await fetch('/api/label/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, labelType, fields }),
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
