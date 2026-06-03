/**
 * listing-upload-image-watermark.test.ts
 * POST /api/listing/upload-image — 워터마크 제거 연동 테스트
 *
 * 검증 대상:
 *   1. 모든 업로드에서 removeGeminiWatermark 가 1회 호출된다
 *      (감지 여부는 removeGeminiWatermark 내부 hasWatermarkCandidate가 결정)
 *   2. removeGeminiWatermark 가 throw 해도 업로드는 성공(non-fatal)한다
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// hoisted mock 변수 선언
// ---------------------------------------------------------------------------

const { removeGeminiWatermarkMock } = vi.hoisted(() => ({
  removeGeminiWatermarkMock: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Sharp Mock
// processImage 내부에서 sharp(buffer).metadata() / .jpeg().toBuffer() 를
// 사용하므로 sharp 모듈 전체를 stub합니다.
// ---------------------------------------------------------------------------

vi.mock('sharp', () => {
  // 처리 결과로 반환할 더미 JPEG 버퍼 (FF D8 FF + 패딩)
  const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

  const chainMethods = {
    metadata: vi.fn().mockResolvedValue({ width: 800, height: 1200, format: 'jpeg' }),
    resize: vi.fn(),
    jpeg: vi.fn(),
    toBuffer: vi.fn().mockResolvedValue(FAKE_JPEG),
    composite: vi.fn(),
    extract: vi.fn(),
    blur: vi.fn(),
  }

  // 메서드 체이닝 지원: 각 메서드가 chainMethods 를 반환
  chainMethods.resize.mockReturnValue(chainMethods)
  chainMethods.jpeg.mockReturnValue(chainMethods)
  chainMethods.composite.mockReturnValue(chainMethods)
  chainMethods.extract.mockReturnValue(chainMethods)
  chainMethods.blur.mockReturnValue(chainMethods)

  const sharpFn = vi.fn(() => chainMethods)

  return { default: sharpFn }
})

// ---------------------------------------------------------------------------
// 워터마크 모듈 Mock
// ---------------------------------------------------------------------------

vi.mock('@/lib/image/watermark-removal', () => ({
  removeGeminiWatermark: removeGeminiWatermarkMock,
}))

// ---------------------------------------------------------------------------
// 인증 Mock
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(async () => ({ userId: 'user-abc' })),
}))

// ---------------------------------------------------------------------------
// Supabase 스토리지 / DB Mock
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  uploadToStorage: vi.fn(async (path: string) => ({
    url: `https://storage.example.com/${path}`,
    path,
    size: 1000,
  })),
  getSupabaseServerClient: () => ({
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: { id: 'asset-id-1' }, error: null }),
        }),
      }),
    }),
  }),
}))

// ---------------------------------------------------------------------------
// route import (모든 mock 선언 이후)
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/listing/upload-image/route'

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

/**
 * JPEG magic bytes(FF D8 FF)가 포함된 최소 버퍼를 반환합니다.
 * sharp 자체를 mock하므로 실제 JPEG 유효성은 불필요하지만,
 * magic bytes 검증 단계(validateMagicBytes)를 통과해야 합니다.
 */
function makeMinimalJpegBuffer(): Buffer {
  // FF D8 FF (JPEG 시그니처)
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
}

/**
 * multipart FormData를 stub한 NextRequest를 생성합니다.
 * jsdom 환경에서 실제 multipart 파싱이 불가하므로
 * formData() 메서드를 spyOn으로 대체합니다.
 */
function makeUploadRequest(usageContext: 'listing_thumbnail' | 'listing_detail'): NextRequest {
  const jpegBuffer = makeMinimalJpegBuffer()
  const file = new File([new Uint8Array(jpegBuffer)], 'test.jpg', { type: 'image/jpeg' })

  const formData = new FormData()
  formData.append('file', file)
  formData.append('usageContext', usageContext)

  const request = new NextRequest('http://localhost:3000/api/listing/upload-image', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=----TestBoundary' },
    body: 'stub',
  })

  vi.spyOn(request, 'formData').mockResolvedValue(formData)

  return request
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe('POST /api/listing/upload-image — 워터마크 제거 연동', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 기본 동작: 입력 버퍼를 그대로 반환 (정상 처리)
    removeGeminiWatermarkMock.mockImplementation(async (buf: Buffer) => buf)
  })

  // ── 테스트 1 ──────────────────────────────────────────────────────────────

  it('업로드 시 removeGeminiWatermark 가 항상 1회 호출된다 (감지는 내부에서)', async () => {
    const request = makeUploadRequest('listing_detail')

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(201)
    expect(json.success).toBe(true)
    expect(removeGeminiWatermarkMock).toHaveBeenCalledTimes(1)
  })

  // ── 테스트 2 ──────────────────────────────────────────────────────────────

  it('removeGeminiWatermark 가 throw 해도 업로드는 201로 성공한다 (non-fatal)', async () => {
    removeGeminiWatermarkMock.mockRejectedValue(new Error('워터마크 제거 실패'))

    const request = makeUploadRequest('listing_detail')

    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data).toHaveProperty('url')
    expect(json.data).toHaveProperty('fileName')
  })
})
