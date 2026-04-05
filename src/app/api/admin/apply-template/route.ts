/**
 * POST /api/admin/apply-template
 *
 * 관리자 레퍼런스 학습: analyze-reference에서 승인된 템플릿 코드를
 * 실제 파일에 반영하고 Supabase에 버전 이력을 저장합니다.
 *
 * 처리 흐름:
 * 1. Zod 요청 바디 검증
 * 2. 각 approval에 대해:
 *    a. 현재 파일 코드 읽기 (previous_code 용)
 *    b. writeTemplateFile 호출 (자동 백업 포함)
 *    c. 파일 write 성공 시 Supabase template_versions 레코드 insert
 *       - 기존 is_current=true 레코드를 false로 업데이트
 *       - version_number는 기존 최대값 + 1
 * 3. ApplyTemplateResponse 반환
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { readTemplateFile, writeTemplateFile } from '@/lib/admin/template-io';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { ApplyTemplateResponse } from '@/types/admin';
import type { FrameType } from '@/types/frames';

// ─────────────────────────────────────────
// Zod 스키마
// ─────────────────────────────────────────

/** 13개 메인 프레임 타입 리터럴 목록 (custom_* 제외) */
const MAIN_FRAME_TYPES = [
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
] as const;

const applyRequestSchema = z.object({
  /** 버전 이력에 기록할 레퍼런스 소스 레이블 */
  referenceSource: z.string().min(1, 'referenceSource가 필요합니다.'),
  approvals: z
    .array(
      z.object({
        frameType: z.enum(MAIN_FRAME_TYPES),
        templateFileName: z.string().min(1, '파일명이 필요합니다.'),
        proposedCode: z.string().min(1, '반영할 코드가 비어있습니다.'),
        /** 버전 이력 저장용 변경 요약 (선택) */
        changeSummary: z.string().optional(),
      })
    )
    .min(1, '최소 1개 이상의 승인 항목이 필요합니다.')
    .max(13, '승인 항목은 최대 13개까지 허용됩니다.'),
});

// ─────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────

/**
 * 특정 frame_type의 다음 version_number를 계산합니다.
 * 기존 레코드가 없으면 1을 반환합니다.
 */
async function getNextVersionNumber(frameType: string): Promise<number> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from('template_versions')
    .select('version_number')
    .eq('frame_type', frameType)
    .order('version_number', { ascending: false })
    .limit(1)
    .single();

  // PGRST116: 결과 없음 (정상 케이스)
  if (error && error.code !== 'PGRST116') {
    throw new Error(
      `[apply-template] version_number 조회 실패 (${frameType}): ${error.message}`
    );
  }

  return data ? data.version_number + 1 : 1;
}

/**
 * Supabase template_versions 테이블에 새 버전 레코드를 insert합니다.
 * insert 전에 동일 frame_type의 기존 is_current=true 레코드를 false로 업데이트합니다.
 */
async function saveVersionRecord(params: {
  referenceSource: string;
  frameType: string;
  previousCode: string;
  appliedCode: string;
  changeSummary: string | null;
}): Promise<void> {
  const supabase = getSupabaseServerClient();

  const { referenceSource, frameType, previousCode, appliedCode, changeSummary } = params;

  // 1단계: 기존 is_current=true 레코드를 false로 업데이트
  const { error: updateError } = await supabase
    .from('template_versions')
    .update({ is_current: false })
    .eq('frame_type', frameType)
    .eq('is_current', true);

  if (updateError) {
    throw new Error(
      `[apply-template] is_current 플래그 업데이트 실패 (${frameType}): ${updateError.message}`
    );
  }

  // 2단계: 다음 version_number 계산
  const versionNumber = await getNextVersionNumber(frameType);

  // 3단계: 새 버전 레코드 insert
  const { error: insertError } = await supabase
    .from('template_versions')
    .insert({
      reference_source: referenceSource,
      frame_type: frameType,
      version_number: versionNumber,
      previous_code: previousCode,
      applied_code: appliedCode,
      change_summary: changeSummary,
      is_current: true,
    });

  if (insertError) {
    throw new Error(
      `[apply-template] 버전 레코드 insert 실패 (${frameType}): ${insertError.message}`
    );
  }
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
  const validated = applyRequestSchema.safeParse(body);
  if (!validated.success) {
    const message = validated.error.issues[0]?.message ?? '입력값 검증 실패';
    return Response.json({ success: false, error: message }, { status: 400 });
  }

  const { referenceSource, approvals } = validated.data;

  // 각 approval에 대해 파일 반영 처리
  const results: ApplyTemplateResponse['results'] = [];

  for (const approval of approvals) {
    const { frameType, proposedCode, changeSummary } = approval;

    // 적용 전 현재 코드 읽기 (Supabase previous_code 저장용)
    let previousCode: string;
    try {
      previousCode = await readTemplateFile(frameType as FrameType);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '알 수 없는 오류';
      console.error(`[apply-template] 원본 코드 읽기 실패 (${frameType}):`, err);
      results.push({
        frameType: frameType as FrameType,
        status: 'failed',
        error: `원본 파일 읽기 실패: ${errorMessage}`,
      });
      continue;
    }

    // 파일 write (자동 백업 포함)
    let backupPath: string;
    try {
      backupPath = await writeTemplateFile(frameType as FrameType, proposedCode);
      console.log(`[apply-template] 반영 완료: ${frameType} → 백업: ${backupPath}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '알 수 없는 오류';
      console.error(`[apply-template] 반영 실패 (${frameType}):`, err);
      results.push({
        frameType: frameType as FrameType,
        status: 'failed',
        error: errorMessage,
      });
      continue;
    }

    // 파일 write 성공 후 Supabase 버전 이력 저장
    // Supabase insert 실패는 경고 로그만 남기고 전체 요청을 실패시키지 않습니다
    try {
      await saveVersionRecord({
        referenceSource,
        frameType,
        previousCode,
        appliedCode: proposedCode,
        changeSummary: changeSummary ?? null,
      });
      console.log(`[apply-template] 버전 이력 저장 완료: ${frameType}`);
    } catch (err) {
      // 이력 저장 실패는 파일 반영 자체를 취소하지 않습니다
      console.error(`[apply-template] 버전 이력 저장 실패 (${frameType}):`, err);
    }

    results.push({
      frameType: frameType as FrameType,
      status: 'applied',
      backupPath,
    });
  }

  const successResponse: ApplyTemplateResponse = {
    success: true,
    results,
  };

  return Response.json(successResponse, { status: 200 });
}
