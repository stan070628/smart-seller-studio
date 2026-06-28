/**
 * POST /api/image/add-text-badge
 *
 * 이미 생성·리사이즈된 이미지 URL에 텍스트 뱃지를 합성해 Supabase에 저장 후 URL 반환.
 * generate-thumbnail 흐름의 4단계로 사용.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/auth'
import { addTextBadge, type BadgePosition } from '@/lib/ai/text-badge'

const RequestSchema = z.object({
  imageUrl: z.string().url(),
  text: z.string().min(1).max(20),
  position: z
    .enum(['top-right', 'top-left', 'bottom-right', 'bottom-left'])
    .default('top-right'),
})

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase 환경변수 누락')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request)
  if (auth instanceof Response) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: '잘못된 요청 형식' }, { status: 400 })
  }

  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? '잘못된 파라미터' },
      { status: 400 },
    )
  }

  const { imageUrl, text, position } = parsed.data

  // 1. 이미지 다운로드
  let imgBuffer: Buffer
  try {
    const res = await fetch(imageUrl, {
      headers: { 'User-Agent': 'SmartSellerStudio/1.0' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    imgBuffer = Buffer.from(await res.arrayBuffer())
  } catch (err) {
    return NextResponse.json(
      { success: false, error: `이미지 다운로드 실패: ${err instanceof Error ? err.message : err}` },
      { status: 400 },
    )
  }

  // 2. 뱃지 합성
  const badgedBuffer = await addTextBadge(imgBuffer, text, position as BadgePosition)

  // 3. Supabase Storage 업로드
  try {
    const supabase = getSupabase()
    const storagePath = `ai-edited/${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage
      .from('smart-seller-studio')
      .upload(storagePath, badgedBuffer, { contentType: 'image/jpeg', upsert: false })
    if (error) throw new Error(error.message)

    const { data: urlData } = supabase.storage
      .from('smart-seller-studio')
      .getPublicUrl(storagePath)

    return NextResponse.json({ success: true, url: urlData.publicUrl })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: `업로드 실패: ${err instanceof Error ? err.message : err}` },
      { status: 500 },
    )
  }
}
