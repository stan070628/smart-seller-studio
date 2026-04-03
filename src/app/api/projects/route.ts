/**
 * GET  /api/projects — 사용자의 프로젝트 목록 조회 (페이지네이션)
 * POST /api/projects — 새 프로젝트 생성
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth } from "@/lib/supabase/auth"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import type { Project } from "@/types/project"

// ─────────────────────────────────────────
// Zod 스키마
// ─────────────────────────────────────────

/** POST 요청 바디 스키마 */
const createProjectSchema = z.object({
  name: z.string().max(100, "프로젝트 이름은 최대 100자까지 허용됩니다.").optional(),
})

// ─────────────────────────────────────────
// GET /api/projects
// ─────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    // 인증 검증
    const auth = await requireAuth(request)
    if (auth instanceof Response) return auth

    const { userId } = auth

    // 쿼리 파라미터 파싱
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "12", 10) || 12))
    const offset = (page - 1) * limit

    const supabase = getSupabaseServerClient()

    // 전체 개수 조회
    const { count, error: countError } = await supabase
      .from("projects")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)

    if (countError) {
      console.error("[GET /api/projects] 개수 조회 오류:", countError)
      return Response.json(
        { success: false, error: "프로젝트 목록 조회 중 오류가 발생했습니다." },
        { status: 500 }
      )
    }

    // 프로젝트 목록 조회 (created_at DESC 정렬, 페이지네이션)
    const { data: projects, error } = await supabase
      .from("projects")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error("[GET /api/projects] 목록 조회 오류:", error)
      return Response.json(
        { success: false, error: "프로젝트 목록 조회 중 오류가 발생했습니다." },
        { status: 500 }
      )
    }

    return Response.json({
      success: true,
      data: {
        projects: (projects ?? []) as Project[],
        total: count ?? 0,
        page,
      },
    })
  } catch (error) {
    console.error("[GET /api/projects] 서버 오류:", error)
    return Response.json({ success: false, error: "서버 오류" }, { status: 500 })
  }
}

// ─────────────────────────────────────────
// POST /api/projects
// ─────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // 인증 검증
    const auth = await requireAuth(request)
    if (auth instanceof Response) return auth

    const { userId } = auth

    // 요청 바디 파싱 (바디 없는 경우 허용)
    let body: unknown = {}
    const contentType = request.headers.get("content-type") ?? ""
    if (contentType.includes("application/json")) {
      try {
        body = await request.json()
      } catch {
        return Response.json(
          { success: false, error: "요청 바디를 JSON으로 파싱할 수 없습니다." },
          { status: 400 }
        )
      }
    }

    // Zod 검증
    const parsed = createProjectSchema.safeParse(body)
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "입력값 검증 실패"
      return Response.json({ success: false, error: message }, { status: 400 })
    }

    // 프로젝트명: 입력값 없으면 기본값 사용
    const name = parsed.data.name?.trim() || "새 프로젝트"

    const supabase = getSupabaseServerClient()

    const { data: project, error } = await supabase
      .from("projects")
      .insert({ user_id: userId, name })
      .select()
      .single()

    if (error) {
      console.error("[POST /api/projects] 생성 오류:", error)
      return Response.json(
        { success: false, error: "프로젝트 생성 중 오류가 발생했습니다." },
        { status: 500 }
      )
    }

    return Response.json(
      { success: true, data: { project: project as Project } },
      { status: 201 }
    )
  } catch (error) {
    console.error("[POST /api/projects] 서버 오류:", error)
    return Response.json({ success: false, error: "서버 오류" }, { status: 500 })
  }
}
