/**
 * POST /api/admin/versions/rollback
 *
 * 특정 버전의 previous_code를 템플릿 파일에 복원합니다.
 *
 * 처리 흐름:
 * 1. Zod 요청 바디 검증 (versionId: UUID)
 * 2. Supabase에서 해당 버전 레코드 조회 (previous_code, frame_type 포함)
 * 3. writeTemplateFile로 previous_code 파일에 복원
 * 4. is_current 플래그 업데이트:
 *    - 해당 frame_type의 모든 is_current → false
 *    - 롤백 대상 버전의 이전 버전(version_number - 1)이 존재하면 → true
 *      (previous_code가 적용되던 시점의 버전이 현재 버전이 됨)
 *
 * Response:
 *   { success: true }
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { writeTemplateFile } from '@/lib/admin/template-io';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { FrameType } from '@/types/frames';

// ─────────────────────────────────────────
// Zod 스키마
// ─────────────────────────────────────────

const RollbackRequestSchema = z.object({
  /** 롤백 기준 버전의 UUID */
  versionId: z.string().uuid('유효한 UUID 형식이어야 합니다.'),
});

// ─────────────────────────────────────────
// template_versions DB 행 타입
// ─────────────────────────────────────────

interface TemplateVersionRow {
  id: string;
  frame_type: string;
  version_number: number;
  previous_code: string;
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 요청 바디 파싱
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, error: '요청 바디를 JSON으로 파싱할 수 없습니다.' },
      { status: 400 }
    );
  }

  // Zod 검증
  const validated = RollbackRequestSchema.safeParse(body);
  if (!validated.success) {
    const message = validated.error.issues[0]?.message ?? '입력값 검증 실패';
    return Response.json({ success: false, error: message }, { status: 400 });
  }

  const { versionId } = validated.data;

  // Supabase 클라이언트 초기화
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

  // 롤백 대상 버전 레코드 조회
  const { data: targetVersion, error: fetchError } = await supabase
    .from('template_versions')
    .select('id, frame_type, version_number, previous_code')
    .eq('id', versionId)
    .single();

  if (fetchError || !targetVersion) {
    if (fetchError?.code === 'PGRST116') {
      return Response.json(
        { success: false, error: `버전 ID "${versionId}"를 찾을 수 없습니다.` },
        { status: 404 }
      );
    }
    return Response.json(
      {
        success: false,
        error: fetchError
          ? `버전 조회 실패: ${fetchError.message}`
          : '버전 조회 결과가 없습니다.',
      },
      { status: 500 }
    );
  }

  const { frame_type, version_number, previous_code } = targetVersion as TemplateVersionRow;

  // previous_code를 템플릿 파일에 복원
  try {
    const backupPath = await writeTemplateFile(frame_type as FrameType, previous_code);
    console.log(
      `[rollback] 복원 완료: ${frame_type} v${version_number} → previous_code 적용, 백업: ${backupPath}`
    );
  } catch (err) {
    return Response.json(
      {
        success: false,
        error: err instanceof Error
          ? `파일 복원 실패: ${err.message}`
          : '파일 복원 중 알 수 없는 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }

  // is_current 플래그 업데이트:
  // 1. 해당 frame_type의 모든 is_current → false
  const { error: clearError } = await supabase
    .from('template_versions')
    .update({ is_current: false })
    .eq('frame_type', frame_type)
    .eq('is_current', true);

  if (clearError) {
    // 플래그 업데이트 실패는 파일 복원을 취소하지 않으나 경고 로그를 남깁니다
    console.error('[rollback] is_current 초기화 실패:', clearError);
  }

  // 2. 롤백 대상보다 version_number가 하나 작은 버전(이전 버전) → is_current=true
  //    previous_code가 적용되던 시점의 버전이 현재 최신 상태입니다
  if (version_number > 1) {
    const { error: prevUpdateError } = await supabase
      .from('template_versions')
      .update({ is_current: true })
      .eq('frame_type', frame_type)
      .eq('version_number', version_number - 1);

    if (prevUpdateError) {
      console.error('[rollback] 이전 버전 is_current 업데이트 실패:', prevUpdateError);
    }
  }

  return Response.json({ success: true }, { status: 200 });
}
