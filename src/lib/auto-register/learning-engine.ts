import { getSupabaseServerClient } from '@/lib/supabase/server';
import type {
  FieldCorrection, FieldTrustStatus, AutoModeStatus, SourceType, MappedCoupangFields,
} from './types';

const ALL_FIELDS: Array<keyof MappedCoupangFields> = [
  'sellerProductName', 'displayCategoryCode', 'brand',
  'salePrice', 'originalPrice', 'stockQuantity',
  'deliveryChargeType', 'deliveryCharge', 'searchTags',
];

const TRUST_THRESHOLD = 0.8;
const MIN_SAMPLES = 5;

/** 순수 함수 — rows는 테이블의 최근 MIN_SAMPLES 행 */
export function computeFieldTrust(
  fieldName: string,
  rows: { was_corrected: boolean }[],
): FieldTrustStatus {
  const recentCount = rows.length;
  const acceptedCount = rows.filter((r) => !r.was_corrected).length;
  const trustScore = recentCount === 0 ? 0 : acceptedCount / recentCount;
  const isTrusted = recentCount >= MIN_SAMPLES && trustScore >= TRUST_THRESHOLD;
  return { fieldName, recentCount, acceptedCount, trustScore, isTrusted };
}

export function computeAutoModeStatus(statuses: FieldTrustStatus[]): AutoModeStatus {
  const untrustedFields = statuses.filter((s) => !s.isTrusted).map((s) => s.fieldName);
  return {
    isAvailable: untrustedFields.length === 0,
    fieldsTrusted: statuses.filter((s) => s.isTrusted).length,
    fieldsTotal: statuses.length,
    untrustedFields,
  };
}

/** DB에서 source_type 기준 모든 필드 최근 행을 단일 쿼리로 조회 후 신뢰도 계산 */
export async function getAutoModeStatus(sourceType: SourceType): Promise<AutoModeStatus> {
  const supabase = await getSupabaseServerClient();

  // 9번 개별 쿼리 대신 단일 쿼리 — created_at DESC 순이므로 필드별 최신 행부터 누적
  const { data } = await supabase
    .from('auto_register_corrections')
    .select('field_name, was_corrected')
    .eq('source_type', sourceType)
    .in('field_name', ALL_FIELDS)
    .order('created_at', { ascending: false })
    .limit(MIN_SAMPLES * ALL_FIELDS.length); // 최대 45행

  // 필드별로 최근 MIN_SAMPLES행 그룹핑 (이미 DESC 정렬이므로 앞에서 자르면 됨)
  const grouped = new Map<string, { was_corrected: boolean }[]>();
  for (const row of data ?? []) {
    const key = row.field_name as string;
    const arr = grouped.get(key) ?? [];
    if (arr.length < MIN_SAMPLES) {
      arr.push({ was_corrected: row.was_corrected as boolean });
      grouped.set(key, arr);
    }
  }

  const statuses = ALL_FIELDS.map((fieldName) =>
    computeFieldTrust(fieldName, grouped.get(fieldName) ?? []),
  );
  return computeAutoModeStatus(statuses);
}

/** 등록 완료 후 수정 이력 저장 */
export async function saveCorrections(corrections: FieldCorrection[]): Promise<void> {
  if (corrections.length === 0) return;
  const supabase = await getSupabaseServerClient();
  await supabase.from('auto_register_corrections').insert(
    corrections.map((c) => ({
      source_type: c.sourceType,
      field_name: c.fieldName,
      ai_value: c.aiValue,
      accepted_value: c.acceptedValue,
      was_corrected: c.wasCorrected,
    })),
  );
}
