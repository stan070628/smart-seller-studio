/**
 * projects.test.ts
 * 프로젝트 CRUD API Route Handler 단위 테스트
 *
 * 실제 구현:
 *   src/app/api/projects/route.ts         → GET, POST
 *   src/app/api/projects/[id]/route.ts    → GET, PATCH, DELETE
 *   src/app/api/projects/[id]/canvas/route.ts → PATCH
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mock: requireAuth
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Mock: getSupabaseServerClient
// ---------------------------------------------------------------------------

// 내부 mock 함수들 — 각 테스트에서 .mockResolvedValueOnce() 로 제어
const mockSingle = vi.fn()
const mockOrder = vi.fn()
const mockRange = vi.fn()
const mockEq = vi.fn()
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()
const mockFrom = vi.fn()

// count 조회(head: true) 를 위한 별도 체인 mock
// 실제 route는 .select("*", { count: "exact", head: true }).eq().{count, error} 형태로 호출
// fluent 체인에서 마지막에 구조분해 가능한 값을 반환하도록 구성

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

// ---------------------------------------------------------------------------
// import 대상 (mock 설정 이후)
// ---------------------------------------------------------------------------

import { requireAuth } from '@/lib/supabase/auth'
import { GET as listProjects, POST as createProject } from '@/app/api/projects/route'
import {
  GET as getProject,
  PATCH as updateProject,
  DELETE as deleteProject,
} from '@/app/api/projects/[id]/route'
import { PATCH as saveCanvas } from '@/app/api/projects/[id]/canvas/route'

// ---------------------------------------------------------------------------
// 타입 단언
// ---------------------------------------------------------------------------

const mockRequireAuth = requireAuth as ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// 픽스처
// ---------------------------------------------------------------------------

const MOCK_USER_ID = 'user-test-123'
const MOCK_PROJECT_ID = 'proj-abc-456'

const MOCK_PROJECT = {
  id: MOCK_PROJECT_ID,
  user_id: MOCK_USER_ID,
  name: '테스트 프로젝트',
  canvas_state: null,
  thumbnail_url: null,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
}

// ---------------------------------------------------------------------------
// 헬퍼: NextRequest 생성
// ---------------------------------------------------------------------------

function makeRequest(
  url: string,
  options: {
    method?: string
    body?: unknown
    headers?: Record<string, string>
  } = {}
): NextRequest {
  const { method = 'GET', body, headers = {} } = options
  const init: RequestInit = { method, headers }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json', ...headers }
  }
  return new NextRequest(url, init)
}

function makeRouteContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

// ---------------------------------------------------------------------------
// 공통 beforeEach: 인증 성공 설정 + fluent 체인 리셋
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()

  // 기본: 인증 성공
  mockRequireAuth.mockResolvedValue({ userId: MOCK_USER_ID, email: 'test@example.com' })

  // fluent 체인 기본 설정 (각 테스트에서 override 가능)
  mockSingle.mockResolvedValue({ data: MOCK_PROJECT, error: null })
  mockRange.mockResolvedValue({ data: [MOCK_PROJECT], error: null })
  mockOrder.mockReturnValue({ range: mockRange })
  mockEq.mockReturnValue({
    eq: mockEq,
    order: mockOrder,
    single: mockSingle,
    select: mockSelect,
  })
  mockSelect.mockReturnValue({
    eq: mockEq,
    order: mockOrder,
    single: mockSingle,
    count: 1,
    error: null,
  })
  mockInsert.mockReturnValue({ select: mockSelect })
  mockUpdate.mockReturnValue({ eq: mockEq })
  mockDelete.mockReturnValue({ eq: mockEq })
  mockFrom.mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
    eq: mockEq,
  })
})

// ===========================================================================
// GET /api/projects
// ===========================================================================

describe('GET /api/projects', () => {
  // ── 테스트 1: 인증 없음 → 401 ────────────────────────────────────────────
  it('인증 없음 → 401을 반환한다', async () => {
    mockRequireAuth.mockResolvedValue(
      Response.json(
        { success: false, error: '인증이 필요합니다', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    )

    const request = makeRequest('http://localhost:3000/api/projects')
    const response = await listProjects(request)

    expect(response.status).toBe(401)
    const json = await response.json()
    expect(json.success).toBe(false)
  })

  // ── 테스트 2: 정상 목록 조회 → 200 + projects 배열 ───────────────────────
  it('정상 목록 조회 → 200과 projects 배열을 반환한다', async () => {
    // count 조회(head:true) 체인
    let callCount = 0
    mockEq.mockImplementation(() => {
      callCount++
      if (callCount <= 2) {
        // 첫 번째 eq 체인 = count 조회
        return {
          eq: mockEq,
          count: 1,
          error: null,
          order: mockOrder,
          single: mockSingle,
          select: mockSelect,
        }
      }
      return {
        eq: mockEq,
        order: mockOrder,
        single: mockSingle,
        select: mockSelect,
        count: 1,
        error: null,
      }
    })

    mockSelect.mockImplementation((_fields?: string, opts?: { count?: string; head?: boolean }) => {
      if (opts?.head) {
        // count 전용 쿼리
        return { eq: mockEq, count: 2, error: null }
      }
      return { eq: mockEq, order: mockOrder }
    })

    mockRange.mockResolvedValue({ data: [MOCK_PROJECT], error: null })

    const request = makeRequest('http://localhost:3000/api/projects')
    const response = await listProjects(request)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveProperty('projects')
    expect(Array.isArray(json.data.projects)).toBe(true)
    expect(json.data).toHaveProperty('total')
    expect(json.data).toHaveProperty('page')
  })

  // ── 테스트 3: 빈 목록 → 200 + 빈 배열 ───────────────────────────────────
  it('빈 목록 → 200과 빈 배열을 반환한다', async () => {
    mockSelect.mockImplementation((_fields?: string, opts?: { count?: string; head?: boolean }) => {
      if (opts?.head) {
        return { eq: mockEq, count: 0, error: null }
      }
      return { eq: mockEq, order: mockOrder }
    })
    mockRange.mockResolvedValue({ data: [], error: null })

    const request = makeRequest('http://localhost:3000/api/projects')
    const response = await listProjects(request)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.success).toBe(true)
    expect(json.data.projects).toEqual([])
    expect(json.data.total).toBe(0)
  })

  // ── 테스트 4: page=2, limit=5 파라미터 적용 ─────────────────────────────
  it('page=2, limit=5 파라미터 → offset 5부터 5개 조회를 요청한다', async () => {
    mockSelect.mockImplementation((_fields?: string, opts?: { count?: string; head?: boolean }) => {
      if (opts?.head) {
        return { eq: mockEq, count: 10, error: null }
      }
      return { eq: mockEq, order: mockOrder }
    })
    mockRange.mockResolvedValue({ data: [MOCK_PROJECT], error: null })

    const request = makeRequest('http://localhost:3000/api/projects?page=2&limit=5')
    const response = await listProjects(request)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.success).toBe(true)
    expect(json.data.page).toBe(2)
    // range(5, 9) 이 호출되었는지 확인 (offset=5, limit=5)
    expect(mockRange).toHaveBeenCalledWith(5, 9)
  })

  // ── 테스트 5: Supabase 오류 → 500 ────────────────────────────────────────
  it('Supabase 오류 → 500을 반환한다', async () => {
    // count 조회: .from().select(..., {head:true}).eq() → { count: null, error: {...} }
    // 실제 라우트: const { count, error: countError } = await supabase.from(...).select(...).eq(...)
    // await 가 적용되므로 eq()가 Promise를 반환해야 합니다.
    const mockEqWithError = vi.fn().mockResolvedValue({
      count: null,
      error: { message: 'DB 연결 오류' },
    })
    mockSelect.mockImplementation((_fields?: string, opts?: { count?: string; head?: boolean }) => {
      if (opts?.head) {
        return { eq: mockEqWithError }
      }
      return { eq: mockEq, order: mockOrder }
    })

    const request = makeRequest('http://localhost:3000/api/projects')
    const response = await listProjects(request)

    expect(response.status).toBe(500)
    const json = await response.json()
    expect(json.success).toBe(false)
  })

  // ── 테스트 6: 기본 정렬(created_at DESC) 적용 확인 ───────────────────────
  it('기본 정렬 created_at DESC 가 적용된다', async () => {
    mockSelect.mockImplementation((_fields?: string, opts?: { count?: string; head?: boolean }) => {
      if (opts?.head) {
        return { eq: mockEq, count: 1, error: null }
      }
      return { eq: mockEq, order: mockOrder }
    })
    mockRange.mockResolvedValue({ data: [MOCK_PROJECT], error: null })

    const request = makeRequest('http://localhost:3000/api/projects')
    await listProjects(request)

    expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false })
  })
})

// ===========================================================================
// POST /api/projects
// ===========================================================================

describe('POST /api/projects', () => {
  // ── 테스트 1: 인증 없음 → 401 ────────────────────────────────────────────
  it('인증 없음 → 401을 반환한다', async () => {
    mockRequireAuth.mockResolvedValue(
      Response.json(
        { success: false, error: '인증이 필요합니다', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    )

    const request = makeRequest('http://localhost:3000/api/projects', { method: 'POST' })
    const response = await createProject(request)

    expect(response.status).toBe(401)
  })

  // ── 테스트 2: name 없이 요청 → "새 프로젝트"로 생성 ─────────────────────
  it('name 없이 요청 → "새 프로젝트" 이름으로 201 생성된다', async () => {
    const createdProject = { ...MOCK_PROJECT, name: '새 프로젝트' }
    mockSingle.mockResolvedValue({ data: createdProject, error: null })
    mockSelect.mockReturnValue({ single: mockSingle })
    mockInsert.mockReturnValue({ select: mockSelect })

    const request = makeRequest('http://localhost:3000/api/projects', {
      method: 'POST',
      body: {},
    })
    const response = await createProject(request)

    expect(response.status).toBe(201)
    const json = await response.json()
    expect(json.success).toBe(true)
    expect(json.data.project.name).toBe('새 프로젝트')
    // insert가 name: '새 프로젝트' 로 호출되었는지 확인
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: '새 프로젝트', user_id: MOCK_USER_ID })
    )
  })

  // ── 테스트 3: 유효한 name으로 생성 → 201 + project 반환 ─────────────────
  it('유효한 name으로 생성 → 201과 project 객체를 반환한다', async () => {
    const createdProject = { ...MOCK_PROJECT, name: '내 쇼핑몰 배너' }
    mockSingle.mockResolvedValue({ data: createdProject, error: null })
    mockSelect.mockReturnValue({ single: mockSingle })
    mockInsert.mockReturnValue({ select: mockSelect })

    const request = makeRequest('http://localhost:3000/api/projects', {
      method: 'POST',
      body: { name: '내 쇼핑몰 배너' },
    })
    const response = await createProject(request)

    expect(response.status).toBe(201)
    const json = await response.json()
    expect(json.success).toBe(true)
    expect(json.data.project).toMatchObject({ name: '내 쇼핑몰 배너' })
  })

  // ── 테스트 4: Supabase INSERT 오류 → 500 ─────────────────────────────────
  it('Supabase INSERT 오류 → 500을 반환한다', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'Insert failed' } })
    mockSelect.mockReturnValue({ single: mockSingle })
    mockInsert.mockReturnValue({ select: mockSelect })

    const request = makeRequest('http://localhost:3000/api/projects', {
      method: 'POST',
      body: { name: '오류 테스트 프로젝트' },
    })
    const response = await createProject(request)

    expect(response.status).toBe(500)
    const json = await response.json()
    expect(json.success).toBe(false)
  })
})

// ===========================================================================
// GET /api/projects/[id]
// ===========================================================================

describe('GET /api/projects/[id]', () => {
  // ── 테스트 1: 인증 없음 → 401 ────────────────────────────────────────────
  it('인증 없음 → 401을 반환한다', async () => {
    mockRequireAuth.mockResolvedValue(
      Response.json(
        { success: false, error: '인증이 필요합니다', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    )

    const request = makeRequest(`http://localhost:3000/api/projects/${MOCK_PROJECT_ID}`)
    const context = makeRouteContext(MOCK_PROJECT_ID)
    const response = await getProject(request, context)

    expect(response.status).toBe(401)
  })

  // ── 테스트 2: 존재하는 id → 200 + project ────────────────────────────────
  it('존재하는 id → 200과 project 객체를 반환한다', async () => {
    mockSingle.mockResolvedValue({ data: MOCK_PROJECT, error: null })
    mockEq.mockReturnValue({ eq: mockEq, single: mockSingle })

    const request = makeRequest(`http://localhost:3000/api/projects/${MOCK_PROJECT_ID}`)
    const context = makeRouteContext(MOCK_PROJECT_ID)
    const response = await getProject(request, context)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.success).toBe(true)
    expect(json.data.project).toMatchObject({ id: MOCK_PROJECT_ID })
  })

  // ── 테스트 3: 존재하지 않는 id → 404 ─────────────────────────────────────
  it('존재하지 않는 id → 404를 반환한다', async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    })
    mockEq.mockReturnValue({ eq: mockEq, single: mockSingle })

    const request = makeRequest('http://localhost:3000/api/projects/non-existent-id')
    const context = makeRouteContext('non-existent-id')
    const response = await getProject(request, context)

    expect(response.status).toBe(404)
    const json = await response.json()
    expect(json.success).toBe(false)
    expect(json.error).toContain('찾을 수 없습니다')
  })
})

// ===========================================================================
// PATCH /api/projects/[id]
// ===========================================================================

describe('PATCH /api/projects/[id]', () => {
  // ── 테스트 1: 인증 없음 → 401 ────────────────────────────────────────────
  it('인증 없음 → 401을 반환한다', async () => {
    mockRequireAuth.mockResolvedValue(
      Response.json(
        { success: false, error: '인증이 필요합니다', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    )

    const request = makeRequest(`http://localhost:3000/api/projects/${MOCK_PROJECT_ID}`, {
      method: 'PATCH',
      body: { name: '수정된 이름' },
    })
    const context = makeRouteContext(MOCK_PROJECT_ID)
    const response = await updateProject(request, context)

    expect(response.status).toBe(401)
  })

  // ── 테스트 2: 수정 필드 없음 → 400 ──────────────────────────────────────
  it('수정 필드 없음 → 400을 반환한다', async () => {
    const request = makeRequest(`http://localhost:3000/api/projects/${MOCK_PROJECT_ID}`, {
      method: 'PATCH',
      body: {},
    })
    const context = makeRouteContext(MOCK_PROJECT_ID)
    const response = await updateProject(request, context)

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.success).toBe(false)
    expect(json.error).toContain('수정할 필드')
  })

  // ── 테스트 3: name 수정 → 200 ────────────────────────────────────────────
  it('name 수정 → 200과 수정된 project를 반환한다', async () => {
    const updatedProject = { ...MOCK_PROJECT, name: '수정된 프로젝트 이름' }
    mockSingle.mockResolvedValue({ data: updatedProject, error: null })
    mockEq.mockReturnValue({ eq: mockEq, select: mockSelect, single: mockSingle })
    mockSelect.mockReturnValue({ single: mockSingle })
    mockUpdate.mockReturnValue({ eq: mockEq })

    const request = makeRequest(`http://localhost:3000/api/projects/${MOCK_PROJECT_ID}`, {
      method: 'PATCH',
      body: { name: '수정된 프로젝트 이름' },
    })
    const context = makeRouteContext(MOCK_PROJECT_ID)
    const response = await updateProject(request, context)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.success).toBe(true)
    expect(json.data.project.name).toBe('수정된 프로젝트 이름')
  })

  // ── 테스트 4: canvas_state 수정 → 200 ────────────────────────────────────
  it('canvas_state 수정 → 200과 수정된 project를 반환한다', async () => {
    const canvasData = { version: '5.3.0', objects: [] }
    const updatedProject = { ...MOCK_PROJECT, canvas_state: canvasData }
    mockSingle.mockResolvedValue({ data: updatedProject, error: null })
    mockEq.mockReturnValue({ eq: mockEq, select: mockSelect, single: mockSingle })
    mockSelect.mockReturnValue({ single: mockSingle })
    mockUpdate.mockReturnValue({ eq: mockEq })

    const request = makeRequest(`http://localhost:3000/api/projects/${MOCK_PROJECT_ID}`, {
      method: 'PATCH',
      body: { canvas_state: canvasData },
    })
    const context = makeRouteContext(MOCK_PROJECT_ID)
    const response = await updateProject(request, context)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.success).toBe(true)
    expect(json.data.project.canvas_state).toEqual(canvasData)
  })
})

// ===========================================================================
// DELETE /api/projects/[id]
// ===========================================================================

describe('DELETE /api/projects/[id]', () => {
  // ── 테스트 1: 인증 없음 → 401 ────────────────────────────────────────────
  it('인증 없음 → 401을 반환한다', async () => {
    mockRequireAuth.mockResolvedValue(
      Response.json(
        { success: false, error: '인증이 필요합니다', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    )

    const request = makeRequest(`http://localhost:3000/api/projects/${MOCK_PROJECT_ID}`, {
      method: 'DELETE',
    })
    const context = makeRouteContext(MOCK_PROJECT_ID)
    const response = await deleteProject(request, context)

    expect(response.status).toBe(401)
  })

  // ── 테스트 2: 성공 삭제 → 200 ────────────────────────────────────────────
  it('성공 삭제 → 200을 반환한다', async () => {
    // delete().eq().eq() 체인이 { error: null, count: 1 } 반환
    const mockDeleteChain = { error: null, count: 1 }
    const mockEqForDelete = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue(mockDeleteChain),
    })
    mockDelete.mockReturnValue({ eq: mockEqForDelete })

    const request = makeRequest(`http://localhost:3000/api/projects/${MOCK_PROJECT_ID}`, {
      method: 'DELETE',
    })
    const context = makeRouteContext(MOCK_PROJECT_ID)
    const response = await deleteProject(request, context)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.success).toBe(true)
  })

  // ── 테스트 3: 존재하지 않는 id → 404 ─────────────────────────────────────
  it('존재하지 않는 id → 404를 반환한다', async () => {
    // count === 0 이면 404
    const mockDeleteChain = { error: null, count: 0 }
    const mockEqForDelete = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue(mockDeleteChain),
    })
    mockDelete.mockReturnValue({ eq: mockEqForDelete })

    const request = makeRequest('http://localhost:3000/api/projects/non-existent-id', {
      method: 'DELETE',
    })
    const context = makeRouteContext('non-existent-id')
    const response = await deleteProject(request, context)

    expect(response.status).toBe(404)
    const json = await response.json()
    expect(json.success).toBe(false)
    expect(json.error).toContain('찾을 수 없습니다')
  })
})

// ===========================================================================
// PATCH /api/projects/[id]/canvas
// ===========================================================================

describe('PATCH /api/projects/[id]/canvas', () => {
  // ── 테스트 1: 인증 없음 → 401 ────────────────────────────────────────────
  it('인증 없음 → 401을 반환한다', async () => {
    mockRequireAuth.mockResolvedValue(
      Response.json(
        { success: false, error: '인증이 필요합니다', code: 'UNAUTHORIZED' },
        { status: 401 }
      )
    )

    const request = makeRequest(
      `http://localhost:3000/api/projects/${MOCK_PROJECT_ID}/canvas`,
      {
        method: 'PATCH',
        body: { canvasState: { version: '5.3.0', objects: [] } },
      }
    )
    const context = makeRouteContext(MOCK_PROJECT_ID)
    const response = await saveCanvas(request, context)

    expect(response.status).toBe(401)
  })

  // ── 테스트 2: canvasState 누락 → 400 ─────────────────────────────────────
  it('canvasState 누락 → 400을 반환한다', async () => {
    const request = makeRequest(
      `http://localhost:3000/api/projects/${MOCK_PROJECT_ID}/canvas`,
      {
        method: 'PATCH',
        body: {},
      }
    )
    const context = makeRouteContext(MOCK_PROJECT_ID)
    const response = await saveCanvas(request, context)

    expect(response.status).toBe(400)
    const json = await response.json()
    expect(json.success).toBe(false)
  })

  // ── 테스트 3: Content-Length 5MB 초과 → 413 ──────────────────────────────
  it('Content-Length 5MB 초과 → 413을 반환한다', async () => {
    const oversizeBytes = 5 * 1024 * 1024 + 1 // 5MB + 1 byte

    const request = new NextRequest(
      `http://localhost:3000/api/projects/${MOCK_PROJECT_ID}/canvas`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(oversizeBytes),
        },
        body: JSON.stringify({ canvasState: { version: '5.3.0', objects: [] } }),
      }
    )
    const context = makeRouteContext(MOCK_PROJECT_ID)
    const response = await saveCanvas(request, context)

    expect(response.status).toBe(413)
    const json = await response.json()
    expect(json.success).toBe(false)
    expect(json.error).toContain('크기')
  })

  // ── 테스트 4: 정상 저장 → 200 + savedAt ─────────────────────────────────
  it('정상 저장 → 200과 savedAt 타임스탬프를 반환한다', async () => {
    // update().eq().eq() 체인이 { error: null, count: 1 } 반환
    const mockUpdateChain = { error: null, count: 1 }
    const mockEqForUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue(mockUpdateChain),
    })
    mockUpdate.mockReturnValue({ eq: mockEqForUpdate })

    const request = makeRequest(
      `http://localhost:3000/api/projects/${MOCK_PROJECT_ID}/canvas`,
      {
        method: 'PATCH',
        body: { canvasState: { version: '5.3.0', objects: [] } },
      }
    )
    const context = makeRouteContext(MOCK_PROJECT_ID)
    const response = await saveCanvas(request, context)

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveProperty('savedAt')
    expect(typeof json.data.savedAt).toBe('string')
    // ISO 8601 형식인지 확인
    expect(new Date(json.data.savedAt).toISOString()).toBe(json.data.savedAt)
  })
})
