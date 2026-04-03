/**
 * PATCH /api/projects/[id]/canvas — 캔버스 상태 자동저장
 *
 * Fabric.js canvas.toJSON() 결과를 projects 테이블의 canvas_state 컬럼에 저장합니다.
 * 자동저장(debounce) 용도로 설계되어 빠른 응답을 우선합니다.
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/supabase/auth"
import { getSupabaseServerClient } from "@/lib/supabase/server"

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

/** 요청 바디 최대 크기: 5MB */
const MAX_BODY_SIZE = 5 * 1024 * 1024

// ─────────────────────────────────────────
// Zod 스키마
// ─────────────────────────────────────────

/** PATCH 요청 바디 스키마 */
const saveCanvasSchema = z.object({
  // Fabric.js toJSON() 결과는 객체 (버전, objects 배열 등 포함)
  canvasState: z.record(z.string(), z.unknown()),
})

// ─────────────────────────────────────────
// 타입
// ─────────────────────────────────────────

interface RouteContext {
  params: Promise<{ id: string }>
}

// ─────────────────────────────────────────
// PATCH /api/projects/[id]/canvas
// ─────────────────────────────────────────

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    // 인증 검증
    const auth = await requireAuth(request)
    if (auth instanceof Response) return auth

    const { userId } = auth
    const { id } = await context.params

    // Content-Length 헤더로 요청 크기 사전 확인 (5MB 초과 시 즉시 거부)
    const contentLength = request.headers.get("content-length")
    if (contentLength !== null) {
      const bodySize = parseInt(contentLength, 10)
      if (!isNaN(bodySize) && bodySize > MAX_BODY_SIZE) {
        return Response.json(
          {
            success: false,
            error: `요청 크기가 너무 큽니다. 최대 ${MAX_BODY_SIZE / 1024 / 1024}MB까지 허용됩니다.`,
          },
          { status: 413 }
        )
      }
    }

    // 요청 바디 파싱
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json(
        { success: false, error: "요청 바디를 JSON으로 파싱할 수 없습니다." },
        { status: 400 }
      )
    }

    // Zod 검증
    const parsed = saveCanvasSchema.safeParse(body)
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "입력값 검증 실패"
      return Response.json({ success: false, error: message }, { status: 400 })
    }

    const { canvasState } = parsed.data

    const supabase = getSupabaseServerClient()

    // canvas_state 업데이트 (updated_at은 DB 트리거가 자동 갱신)
    const { error, count } = await supabase
      .from("projects")
      .update({ canvas_state: canvasState })
      .eq("id", id)
      .eq("user_id", userId)

    if (error) {
      console.error("[PATCH /api/projects/[id]/canvas] 저장 오류:", error)
      return Response.json(
        { success: false, error: "캔버스 상태 저장 중 오류가 발생했습니다." },
        { status: 500 }
      )
    }

    // 업데이트된 행이 없으면 해당 프로젝트가 존재하지 않거나 권한 없음
    if (count === 0) {
      return Response.json(
        { success: false, error: "프로젝트를 찾을 수 없습니다." },
        { status: 404 }
      )
    }

    return Response.json({
      success: true,
      data: { savedAt: new Date().toISOString() },
    })
  } catch (error) {
    console.error("[PATCH /api/projects/[id]/canvas] 서버 오류:", error)
    return Response.json({ success: false, error: "서버 오류" }, { status: 500 })
  }
}
