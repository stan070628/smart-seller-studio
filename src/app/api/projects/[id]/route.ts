/**
 * GET    /api/projects/[id] — 단건 조회
 * PATCH  /api/projects/[id] — 수정 (name, canvas_state, thumbnail_url)
 * DELETE /api/projects/[id] — 하드 삭제
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/supabase/auth"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import type { Project } from "@/types/project"

// ─────────────────────────────────────────
// Zod 스키마
// ─────────────────────────────────────────

/** PATCH 요청 바디 스키마 */
const updateProjectSchema = z.object({
  name: z.string().max(100, "프로젝트 이름은 최대 100자까지 허용됩니다.").optional(),
  canvas_state: z.record(z.string(), z.unknown()).optional(),
  thumbnail_url: z.string().url("올바른 URL 형식이 아닙니다.").optional(),
})

// ─────────────────────────────────────────
// 타입
// ─────────────────────────────────────────

interface RouteContext {
  params: Promise<{ id: string }>
}

// ─────────────────────────────────────────
// GET /api/projects/[id]
// ─────────────────────────────────────────

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    // 인증 검증
    const auth = await requireAuth(request)
    if (auth instanceof Response) return auth

    const { userId } = auth
    const { id } = await context.params

    const supabase = getSupabaseServerClient()

    const { data: project, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .single()

    if (error || !project) {
      return Response.json(
        { success: false, error: "프로젝트를 찾을 수 없습니다." },
        { status: 404 }
      )
    }

    return Response.json({ success: true, data: { project: project as Project } })
  } catch (error) {
    console.error("[GET /api/projects/[id]] 서버 오류:", error)
    return Response.json({ success: false, error: "서버 오류" }, { status: 500 })
  }
}

// ─────────────────────────────────────────
// PATCH /api/projects/[id]
// ─────────────────────────────────────────

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    // 인증 검증
    const auth = await requireAuth(request)
    if (auth instanceof Response) return auth

    const { userId } = auth
    const { id } = await context.params

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
    const parsed = updateProjectSchema.safeParse(body)
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "입력값 검증 실패"
      return Response.json({ success: false, error: message }, { status: 400 })
    }

    const { name, canvas_state, thumbnail_url } = parsed.data

    // 수정할 필드가 하나도 없으면 400
    if (name === undefined && canvas_state === undefined && thumbnail_url === undefined) {
      return Response.json(
        { success: false, error: "수정할 필드(name, canvas_state, thumbnail_url)를 하나 이상 포함해야 합니다." },
        { status: 400 }
      )
    }

    // 업데이트할 필드만 포함 (undefined 제외)
    const updateFields: Record<string, unknown> = {}
    if (name !== undefined) updateFields.name = name
    if (canvas_state !== undefined) updateFields.canvas_state = canvas_state
    if (thumbnail_url !== undefined) updateFields.thumbnail_url = thumbnail_url

    const supabase = getSupabaseServerClient()

    // updated_at은 DB 트리거(trg_projects_updated_at)가 자동으로 갱신
    const { data: project, error } = await supabase
      .from("projects")
      .update(updateFields)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single()

    if (error || !project) {
      // 업데이트 대상 없음 = 해당 user의 프로젝트가 아니거나 존재하지 않음
      if (error?.code === "PGRST116" || !project) {
        return Response.json(
          { success: false, error: "프로젝트를 찾을 수 없습니다." },
          { status: 404 }
        )
      }
      console.error("[PATCH /api/projects/[id]] 수정 오류:", error)
      return Response.json(
        { success: false, error: "프로젝트 수정 중 오류가 발생했습니다." },
        { status: 500 }
      )
    }

    return Response.json({ success: true, data: { project: project as Project } })
  } catch (error) {
    console.error("[PATCH /api/projects/[id]] 서버 오류:", error)
    return Response.json({ success: false, error: "서버 오류" }, { status: 500 })
  }
}

// ─────────────────────────────────────────
// DELETE /api/projects/[id]
// ─────────────────────────────────────────

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    // 인증 검증
    const auth = await requireAuth(request)
    if (auth instanceof Response) return auth

    const { userId } = auth
    const { id } = await context.params

    const supabase = getSupabaseServerClient()

    // user_id 조건을 함께 걸어 타 사용자 데이터 삭제 방지
    // assets, ai_results는 CASCADE로 자동 삭제됨
    const { error, count } = await supabase
      .from("projects")
      .delete({ count: "exact" })
      .eq("id", id)
      .eq("user_id", userId)

    if (error) {
      console.error("[DELETE /api/projects/[id]] 삭제 오류:", error)
      return Response.json(
        { success: false, error: "프로젝트 삭제 중 오류가 발생했습니다." },
        { status: 500 }
      )
    }

    // 삭제된 행이 0개 = 해당 user의 프로젝트가 아니거나 이미 삭제됨
    if (count === 0) {
      return Response.json(
        { success: false, error: "프로젝트를 찾을 수 없습니다." },
        { status: 404 }
      )
    }

    return Response.json({ success: true })
  } catch (error) {
    console.error("[DELETE /api/projects/[id]] 서버 오류:", error)
    return Response.json({ success: false, error: "서버 오류" }, { status: 500 })
  }
}
