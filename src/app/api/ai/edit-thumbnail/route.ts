/**
 * POST /api/ai/edit-thumbnail
 *
 * 상품 썸네일 이미지를 Gemini Imagen으로 AI 편집합니다.
 * - 외부 또는 Supabase URL에서 이미지를 다운로드
 * - Gemini gemini-2.5-flash-image 모델로 편집 프롬프트 적용
 * - 결과 이미지를 Supabase Storage listing-images 버킷에 저장
 * - 저장된 이미지의 공개 URL 반환
 */

import { NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { z } from "zod"
import { getGeminiGenAI } from "@/lib/ai/gemini"
import { requireAuth } from "@/lib/supabase/auth"

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

/** Gemini 이미지 편집 모델 */
const MODEL = "gemini-2.5-flash-image"

/** AI 호출 타임아웃: 30초 */
const AI_TIMEOUT_MS = 30_000

/** 이미지 다운로드 타임아웃: 8초 */
const DOWNLOAD_TIMEOUT_MS = 8_000

/** 결과 이미지 저장 버킷 */
const LISTING_IMAGES_BUCKET = "smart-seller-studio"

/** 결과 이미지 저장 경로 prefix */
const STORAGE_PATH_PREFIX = "ai-edited"

/** Gemini 시스템 프롬프트 */
const SYSTEM_PROMPT =
  "You are a professional product photographer assistant. Edit the provided product image according to the user's instructions. Maintain the product's appearance and details while making the requested changes. Output a clean, professional e-commerce product photo."

// ─────────────────────────────────────────
// Zod 스키마
// ─────────────────────────────────────────

const requestSchema = z.object({
  imageUrl: z.string().url("imageUrl은 유효한 URL이어야 합니다."),
  prompt: z.string().min(1, "prompt는 비어 있을 수 없습니다."),
})

// ─────────────────────────────────────────
// 응답 타입
// ─────────────────────────────────────────

interface EditSuccessData {
  editedUrl: string
}

interface ApiSuccessResponse {
  success: true
  data: EditSuccessData
}

interface ApiErrorResponse {
  success: false
  error: string
}

// ─────────────────────────────────────────
// 헬퍼: Supabase 서비스 롤 클라이언트 생성
// ─────────────────────────────────────────

/**
 * listing-images 버킷 접근을 위한 Supabase 서비스 롤 클라이언트를 생성합니다.
 * 이 클라이언트는 RLS를 우회하므로 서버 사이드에서만 사용해야 합니다.
 */
function createSupabaseServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error(
      "[Supabase] 환경변수 NEXT_PUBLIC_SUPABASE_URL이 설정되지 않았습니다."
    )
  }
  if (!serviceRoleKey) {
    throw new Error(
      "[Supabase] 환경변수 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다."
    )
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

// ─────────────────────────────────────────
// 헬퍼: 이미지 다운로드
// ─────────────────────────────────────────

/**
 * 외부 URL에서 이미지를 다운로드합니다.
 * 8초 타임아웃, User-Agent 헤더 포함.
 */
async function downloadImage(url: string): Promise<Buffer> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // 일부 서버가 브라우저 UA가 없으면 403을 반환함
        "User-Agent":
          "Mozilla/5.0 (compatible; SmartSellerStudio/1.0; +https://smartsellerstudio.vercel.app)",
      },
    })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    throw new Error(`이미지 다운로드 실패: HTTP ${res.status} (${url})`)
  }

  const contentType = res.headers.get("content-type") ?? ""
  // 일부 CDN은 application/octet-stream으로 이미지를 반환하므로 허용
  const allowedTypes = ["image/", "application/octet-stream"]
  if (!allowedTypes.some((t) => contentType.startsWith(t))) {
    throw new Error(`이미지가 아닌 응답: ${contentType} (${url})`)
  }

  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

// ─────────────────────────────────────────
// 헬퍼: 이미지 MIME 타입 감지 (magic bytes)
// ─────────────────────────────────────────

/**
 * 버퍼의 magic bytes로 MIME 타입을 판별합니다.
 * 판별 불가 시 "image/jpeg"를 기본값으로 반환합니다.
 */
function detectMimeType(buffer: Buffer): string {
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg"
  }
  // PNG: 89 50 4E 47
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png"
  }
  // WebP: RIFF????WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp"
  }
  // GIF: 47 49 46 38
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return "image/gif"
  }
  return "image/jpeg"
}

// ─────────────────────────────────────────
// 헬퍼: UUID v4 생성 (crypto 내장)
// ─────────────────────────────────────────

/**
 * Web Crypto API로 UUID v4를 생성합니다.
 * crypto.randomUUID()는 Node.js 14.17.0+ 에서 지원합니다.
 */
function generateUuid(): string {
  return crypto.randomUUID()
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  // 1. 인증 검증
  const auth = await requireAuth(request)
  if (auth instanceof Response) {
    return Response.json(
      { success: false, error: "인증이 필요합니다. 로그인 후 다시 시도해주세요." } satisfies ApiErrorResponse,
      { status: 401 }
    )
  }

  // 2. 요청 바디 파싱 및 Zod 검증
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { success: false, error: "요청 바디를 파싱할 수 없습니다. JSON 형식이어야 합니다." } satisfies ApiErrorResponse,
      { status: 400 }
    )
  }

  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]
    return Response.json(
      {
        success: false,
        error: firstError
          ? `${firstError.path.join(".")}: ${firstError.message}`
          : "요청 형식이 올바르지 않습니다.",
      } satisfies ApiErrorResponse,
      { status: 400 }
    )
  }

  const { imageUrl, prompt } = parsed.data

  // 3. 원본 이미지 다운로드
  let imageBuffer: Buffer
  try {
    imageBuffer = await downloadImage(imageUrl)
  } catch (err) {
    console.error("[POST /api/ai/edit-thumbnail] 이미지 다운로드 오류:", err)
    return Response.json(
      {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : "원본 이미지를 다운로드하는 데 실패했습니다.",
      } satisfies ApiErrorResponse,
      { status: 400 }
    )
  }

  // 4. 이미지 MIME 타입 감지 및 base64 변환
  const mimeType = detectMimeType(imageBuffer)
  const imageBase64 = imageBuffer.toString("base64")

  // 5. Gemini Imagen AI 편집 호출 (30초 타임아웃)
  let editedImageBase64: string
  let editedMimeType: string
  try {
    const ai = getGeminiGenAI()

    // 프롬프트를 영어 편집 지시로 래핑하여 이미지 출력을 유도
    const editInstruction =
      `Edit this product photo according to the following instruction. ` +
      `You MUST output the edited image. Instruction: ${prompt}`

    const aiCallPromise = ai.models.generateContent({
      model: MODEL,
      config: {
        responseModalities: ["IMAGE", "TEXT"],
        systemInstruction: SYSTEM_PROMPT,
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                data: imageBase64,
                mimeType,
              },
            },
            {
              text: editInstruction,
            },
          ],
        },
      ],
    })

    // 30초 타임아웃 레이스
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("AI 처리 시간이 초과되었습니다. (30초)")),
        AI_TIMEOUT_MS
      )
    )

    const response = await Promise.race([aiCallPromise, timeoutPromise])

    // 응답에서 이미지 part 추출
    const candidates = response.candidates
    if (!candidates || candidates.length === 0) {
      throw new Error("AI가 이미지를 생성하지 못했습니다.")
    }

    const contentParts = candidates[0]?.content?.parts
    if (!contentParts || contentParts.length === 0) {
      throw new Error("AI 응답에서 이미지 데이터를 찾을 수 없습니다.")
    }

    const imagePart = contentParts.find(
      (part) => part.inlineData && part.inlineData.data
    )

    if (!imagePart || !imagePart.inlineData) {
      throw new Error("AI 응답에 이미지 데이터가 포함되어 있지 않습니다.")
    }

    editedImageBase64 = imagePart.inlineData.data as string
    editedMimeType = (imagePart.inlineData.mimeType as string) || "image/jpeg"
  } catch (err) {
    console.error("[POST /api/ai/edit-thumbnail] Gemini AI 오류:", err)
    const errMsg = err instanceof Error ? err.message : ""
    const isOverloaded =
      errMsg.includes("503") ||
      errMsg.toLowerCase().includes("unavailable") ||
      errMsg.toLowerCase().includes("high demand")
    return Response.json(
      {
        success: false,
        error: isOverloaded
          ? "AI 서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해주세요."
          : errMsg || "AI 이미지 편집 처리 중 오류가 발생했습니다.",
      } satisfies ApiErrorResponse,
      { status: isOverloaded ? 503 : 500 }
    )
  }

  // 6. 편집된 이미지를 Supabase Storage에 업로드
  //    경로: ai-edited/{uuid}.jpg
  const uuid = generateUuid()
  // AI 응답 MIME 타입에 따라 확장자 결정 (기본 jpg)
  const ext = editedMimeType.includes("png")
    ? "png"
    : editedMimeType.includes("webp")
      ? "webp"
      : "jpg"
  const storagePath = `${STORAGE_PATH_PREFIX}/${uuid}.${ext}`

  let editedUrl: string
  try {
    const supabase = createSupabaseServiceClient()
    const editedBuffer = Buffer.from(editedImageBase64, "base64")

    const { error: uploadError } = await supabase.storage
      .from(LISTING_IMAGES_BUCKET)
      .upload(storagePath, editedBuffer, {
        contentType: editedMimeType,
        upsert: false,
      })

    if (uploadError) {
      throw new Error(
        `[Supabase Storage] 업로드 실패: ${uploadError.message}`
      )
    }

    // 공개 URL 조회
    const { data: urlData } = supabase.storage
      .from(LISTING_IMAGES_BUCKET)
      .getPublicUrl(storagePath)

    editedUrl = urlData.publicUrl
  } catch (err) {
    console.error("[POST /api/ai/edit-thumbnail] Storage 업로드 오류:", err)
    return Response.json(
      {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : "편집된 이미지를 저장하는 중 오류가 발생했습니다.",
      } satisfies ApiErrorResponse,
      { status: 500 }
    )
  }

  // 7. 성공 응답
  return Response.json(
    {
      success: true,
      data: { editedUrl },
    } satisfies ApiSuccessResponse,
    { status: 200 }
  )
}
