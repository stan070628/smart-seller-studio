/**
 * listing-upload-image-watermark.test.ts
 * POST /api/listing/upload-image — 업로드 파이프라인 테스트
 *
 * 워터마크 제거는 generate-detail-html 라우트로 이동됨.
 * 이 파일은 업로드 자체가 정상 동작하는지만 검증합니다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Sharp Mock
// ---------------------------------------------------------------------------

vi.mock('sharp', () => {
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

  chainMethods.resize.mockReturnValue(chainMethods)
  chainMethods.jpeg.mockReturnValue(chainMethods)
  chainMethods.composite.mockReturnValue(chainMethods)
  chainMethods.extract.mockReturnValue(chainMethods)
  chainMethods.blur.mockReturnValue(chainMethods)

  return { default: vi.fn(() => chainMethods) }
})

// ---------------------------------------------------------------------------
// 인증 Mock
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn(async () => ({ userId: 'user-abc' })),
}))

// ---------------------------------------------------------------------------
// Supabase Mock
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
// route import
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/listing/upload-image/route'

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

function makeMinimalJpegBuffer(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
}

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

describe('POST /api/listing/upload-image', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('listing_detail 업로드가 201로 성공한다', async () => {
    const request = makeUploadRequest('listing_detail')
    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data).toHaveProperty('url')
  })

  it('listing_thumbnail 업로드가 201로 성공한다', async () => {
    const request = makeUploadRequest('listing_thumbnail')
    const response = await POST(request)
    const json = await response.json()

    expect(response.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data).toHaveProperty('url')
  })
})
