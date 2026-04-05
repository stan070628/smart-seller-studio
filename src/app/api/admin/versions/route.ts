/**
 * GET /api/admin/versions?frameType=hero
 *
 * 특정 frame_type의 버전 이력을 최신순으로 최대 20개 반환합니다.
 *
 * Query Parameters:
 *   frameType: string (필수) — 조회할 프레임 타입
 *
 * Response:
 *   { success: true, data: TemplateVersionRecord[] }
 */

import { NextRequest } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { TemplateVersionRecord } from '@/types/admin';
import type { FrameType } from '@/types/frames';

/** 조회 가능한 메인 프레임 타입 목록 */
const MAIN_FRAME_TYPES = new Set([
  'hero',
  'pain_point',
  'solution',
  'usp',
  'detail_1',
  'detail_2',
  'how_to_use',
  'before_after',
  'target',
  'spec',
  'faq',
  'social_proof',
  'cta',
]);

/** template_versions DB 행 타입 */
interface TemplateVersionRow {
  id: string;
  created_at: string;
  reference_source: string;
  frame_type: string;
  version_number: number;
  change_summary: string | null;
  is_current: boolean;
}

/**
 * DB 행을 클라이언트 응답 형식으로 변환합니다.
 * previous_code, applied_code는 목록 조회에서 제외합니다 (대용량 필드).
 */
function rowToRecord(row: TemplateVersionRow): TemplateVersionRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    referenceSource: row.reference_source,
    frameType: row.frame_type as FrameType,
    versionNumber: row.version_number,
    changeSummary: row.change_summary,
    isCurrent: row.is_current,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const frameType = searchParams.get('frameType');

  // frameType 파라미터 검증
  if (!frameType) {
    return Response.json(
      { success: false, error: 'frameType 쿼리 파라미터가 필요합니다.' },
      { status: 400 }
    );
  }

  if (!MAIN_FRAME_TYPES.has(frameType)) {
    return Response.json(
      {
        success: false,
        error: `유효하지 않은 frameType: "${frameType}". 13개 메인 프레임 타입만 허용됩니다.`,
      },
      { status: 400 }
    );
  }

  // Supabase 조회: 최신순, 최대 20개, 코드 필드 제외
  let supabase: ReturnType<typeof getSupabaseServerClient>;
  try {
    supabase = getSupabaseServerClient();
  } catch (err) {
    return Response.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Supabase 클라이언트 초기화 실패',
      },
      { status: 503 }
    );
  }

  const { data, error } = await supabase
    .from('template_versions')
    .select('id, created_at, reference_source, frame_type, version_number, change_summary, is_current')
    .eq('frame_type', frameType)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('[versions] 이력 조회 실패:', error);
    return Response.json(
      { success: false, error: `이력 조회 중 오류가 발생했습니다: ${error.message}` },
      { status: 500 }
    );
  }

  const records: TemplateVersionRecord[] = (data ?? []).map((row) =>
    rowToRecord(row as TemplateVersionRow)
  );

  return Response.json({ success: true, data: records }, { status: 200 });
}
