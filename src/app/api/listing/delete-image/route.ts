/**
 * DELETE /api/listing/delete-image
 *
 * 상품 등록용 이미지를 삭제합니다.
 * - assets 테이블에서 소유권 확인 (user_id 일치)
 * - Supabase Storage에서 원본 파일 삭제
 * - assets 테이블 레코드 삭제
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/supabase/auth"
import { getSupabaseServerClient, STORAGE_BUCKET } from "@/lib/supabase/server"

// ─────────────────────────────────────────
// Zod 스키마
// ─────────────────────────────────────────

const deleteBodySchema = z.object({
  assetId: z.string().uuid("assetId는 올바른 UUID 형식이어야 합니다."),
})

// ─────────────────────────────────────────
// 응답 타입
// ─────────────────────────────────────────

interface ApiSuccessResponse {
  success: true
}

interface ApiErrorResponse {
  success: false
  error: string
  code:
    | "AUTH_REQUIRED"
    | "INVALID_BODY"
    | "ASSET_NOT_FOUND"
    | "STORAGE_DELETE_FAILED"
    | "SERVER_ERROR"
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function DELETE(
  request: NextRequest
): Promise<Response> {
  // 1. 인증 검증
  const auth = await requireAuth(request)
  if (auth instanceof Response) {
    return Response.json(
      {
        success: false,
        error: "인증이 필요합니다. 로그인 후 다시 시도해주세요.",
        code: "AUTH_REQUIRED",
      } satisfies ApiErrorResponse,
      { status: 401 }
    )
  }

  const { userId } = auth

  try {
    // 2. 요청 바디 파싱
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json(
        {
          success: false,
          error: "요청 바디를 JSON으로 파싱할 수 없습니다.",
          code: "INVALID_BODY",
        } satisfies ApiErrorResponse,
        { status: 400 }
      )
    }

    // 3. Zod 검증
    const parsed = deleteBodySchema.safeParse(body)
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "입력값 검증 실패"
      return Response.json(
        {
          success: false,
          error: message,
          code: "INVALID_BODY",
        } satisfies ApiErrorResponse,
        { status: 400 }
      )
    }

    const { assetId } = parsed.data
    const supabase = getSupabaseServerClient()

    // 4. assets 테이블에서 레코드 조회 (user_id 소유권 확인)
    const { data: asset, error: selectError } = await supabase
      .from("assets")
      .select("id, storage_path, user_id")
      .eq("id", assetId)
      .eq("user_id", userId)   // 타 사용자 접근 차단
      .single()

    if (selectError || !asset) {
      return Response.json(
        {
          success: false,
          error: "이미지를 찾을 수 없거나 접근 권한이 없습니다.",
          code: "ASSET_NOT_FOUND",
        } satisfies ApiErrorResponse,
        { status: 404 }
      )
    }

    // 5. Supabase Storage에서 파일 삭제
    const { error: storageError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([asset.storage_path])

    if (storageError) {
      // Storage 파일이 이미 없는 경우(23505 등)는 무시하고 진행 가능하지만
      // 명시적 오류는 기록 후 계속 진행 (DB 레코드는 반드시 삭제)
      console.error(
        "[DELETE /api/listing/delete-image] Storage 삭제 오류 (계속 진행):",
        storageError.message
      )
    }

    // 6. assets 테이블 레코드 삭제
    const { error: deleteError, count } = await supabase
      .from("assets")
      .delete({ count: "exact" })
      .eq("id", assetId)
      .eq("user_id", userId)

    if (deleteError) {
      console.error(
        "[DELETE /api/listing/delete-image] DB 삭제 오류:",
        deleteError
      )
      return Response.json(
        {
          success: false,
          error: "이미지 레코드 삭제 중 오류가 발생했습니다.",
          code: "SERVER_ERROR",
        } satisfies ApiErrorResponse,
        { status: 500 }
      )
    }

    // 삭제된 행이 없으면 이미 삭제된 것으로 간주 (멱등성)
    if (count === 0) {
      return Response.json(
        {
          success: false,
          error: "이미지를 찾을 수 없거나 이미 삭제되었습니다.",
          code: "ASSET_NOT_FOUND",
        } satisfies ApiErrorResponse,
        { status: 404 }
      )
    }

    // 7. 성공 응답
    return Response.json(
      { success: true } satisfies ApiSuccessResponse,
      { status: 200 }
    )
  } catch (error) {
    console.error(
      "[DELETE /api/listing/delete-image] 예기치 않은 오류:",
      error
    )
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "서버 오류가 발생했습니다.",
        code: "SERVER_ERROR",
      } satisfies ApiErrorResponse,
      { status: 500 }
    )
  }
}
