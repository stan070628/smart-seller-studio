/**
 * upload.test.ts
 * POST /api/storage/upload Route Handler 단위 테스트
 *
 * 실제 구현: src/app/api/storage/upload/route.ts
 * 현재 구현은 Supabase Storage 없이 Base64 data URL로 변환만 수행합니다.
 *
 * 주의: jsdom 환경에서 실제 multipart 파싱이 불가하므로
 * NextRequest.formData() 메서드를 vi.spyOn으로 stub합니다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/storage/upload/route'

// ---------------------------------------------------------------------------
// 헬퍼: NextRequest 생성 + formData() stub
// ---------------------------------------------------------------------------

interface MockFileOptions {
  name?: string
  type?: string
  /** 논리적 파일 크기 (File.size를 오버라이드) */
  size?: number
}

interface MockRequestOptions {
  fileOptions?: MockFileOptions
  /** false 로 설정하면 Content-Type을 application/json으로 설정 */
  setMultipartHeader?: boolean
  /** true 로 설정하면 FormData에 file 필드를 추가하지 않음 */
  omitFile?: boolean
}

/**
 * NextRequest를 생성하고 formData()를 stub하여 반환합니다.
 * jsdom 환경에서 실제 multipart 파싱 없이 FormData를 제어합니다.
 */
function makeUploadRequest(opts: MockRequestOptions = {}): NextRequest {
  const {
    fileOptions = {},
    setMultipartHeader = true,
    omitFile = false,
  } = opts

  const {
    name = 'test.jpg',
    type = 'image/jpeg',
    size = 1024 * 1024, // 기본 1MB
  } = fileOptions

  const formData = new FormData()

  if (!omitFile) {
    // 실제 바이트는 최소화하되 File.size는 원하는 값으로 오버라이드
    const content = new Uint8Array(Math.min(size, 100)).fill(0xff)
    const file = new File([content], name, { type })
    Object.defineProperty(file, 'size', { value: size, writable: false })
    // arrayBuffer()는 실제 content(100바이트) 기반으로 동작하므로 별도 stub 불필요
    formData.append('file', file)
  }

  const headers: Record<string, string> = {}
  if (setMultipartHeader) {
    headers['content-type'] = 'multipart/form-data; boundary=----TestBoundary'
  } else {
    headers['content-type'] = 'application/json'
  }

  const request = new NextRequest('http://localhost:3000/api/storage/upload', {
    method: 'POST',
    headers,
    body: 'stub', // 실제 body는 사용하지 않음 — formData()를 stub으로 대체
  })

  vi.spyOn(request, 'formData').mockResolvedValue(formData)

  return request
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe('POST /api/storage/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Content-Type 검증 ──────────────────────────────────────────────────

  it('Content-Type이 multipart/form-data가 아니면 400을 반환한다', async () => {
    const request = makeUploadRequest({ setMultipartHeader: false })
    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.success).toBe(false)
    expect(json.error).toContain('multipart/form-data')
  })

  // ── 파일 필드 검증 ─────────────────────────────────────────────────────

  it('FormData에 file 필드가 없으면 400을 반환한다', async () => {
    const request = makeUploadRequest({ omitFile: true })
    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(400)
    expect(json.success).toBe(false)
    expect(json.error).toContain('file')
  })

  // ── MIME 타입 검증 ─────────────────────────────────────────────────────

  it('image/jpeg, image/png, image/webp는 허용 MIME 타입이므로 201을 반환한다', async () => {
    const allowedTypes = [
      { name: 'photo.jpg', type: 'image/jpeg' },
      { name: 'image.png', type: 'image/png' },
      { name: 'image.webp', type: 'image/webp' },
    ]

    for (const fileOpts of allowedTypes) {
      const request = makeUploadRequest({
        fileOptions: { ...fileOpts, size: 512 * 1024 },
      })
      const response = await POST(request)
      const json = await response.json()

      expect(response.status, `${fileOpts.type} 은 201이어야 함`).toBe(201)
      expect(json.success).toBe(true)
    }
  })

  it('image/gif, application/pdf 등 허용되지 않는 MIME 타입은 415를 반환한다', async () => {
    const disallowedTypes = [
      { name: 'animation.gif', type: 'image/gif' },
      { name: 'document.pdf', type: 'application/pdf' },
    ]

    for (const fileOpts of disallowedTypes) {
      const request = makeUploadRequest({
        fileOptions: { ...fileOpts, size: 1024 },
      })
      const response = await POST(request)
      const json = await response.json()

      expect(response.status, `${fileOpts.type} 은 415이어야 함`).toBe(415)
      expect(json.success).toBe(false)
      expect(json.error).toContain(fileOpts.type)
    }
  })

  // ── 파일 크기 검증 ─────────────────────────────────────────────────────

  it('11MB 파일 전송 시 413을 반환한다', async () => {
    const elevenMB = 11 * 1024 * 1024

    const request = makeUploadRequest({
      fileOptions: { name: 'big.jpg', type: 'image/jpeg', size: elevenMB },
    })
    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(413)
    expect(json.success).toBe(false)
    // 에러 메시지에 최대 크기(10MB) 언급 여부 확인
    expect(json.error).toMatch(/10MB|파일 크기/)
  })

  // ── 정상 업로드 ────────────────────────────────────────────────────────

  it('정상 업로드 시 success: true, data.url/path/size를 포함한 201을 반환한다', async () => {
    const request = makeUploadRequest({
      fileOptions: { name: 'test.jpg', type: 'image/jpeg', size: 1024 * 1024 },
    })
    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data).toHaveProperty('url')
    expect(json.data).toHaveProperty('path')
    expect(json.data).toHaveProperty('size')
    expect(typeof json.data.url).toBe('string')
    expect(typeof json.data.path).toBe('string')
    expect(typeof json.data.size).toBe('number')
  })

  it('정상 업로드 시 data.url은 "data:image/jpeg;base64," 로 시작한다', async () => {
    const request = makeUploadRequest({
      fileOptions: { name: 'test.jpg', type: 'image/jpeg', size: 1024 },
    })
    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(201)
    expect(json.data.url).toMatch(/^data:image\/jpeg;base64,/)
  })
})
