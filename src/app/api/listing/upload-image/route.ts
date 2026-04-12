/**
 * POST /api/listing/upload-image
 *
 * 상품 등록용 이미지를 업로드합니다.
 * - multipart/form-data 수신
 * - Sharp로 2000px 초과 시 리사이즈 + WebP → JPEG 변환
 * - Supabase Storage listings/{userId}/{timestamp}_{fileName} 경로에 저장
 * - assets 테이블에 usage_context 포함하여 INSERT
 */

import { NextRequest } from "next/server"
import { z } from "zod"
import sharp from "sharp"
import { requireAuth } from "@/lib/supabase/auth"
import {
  uploadToStorage,
  getSupabaseServerClient,
} from "@/lib/supabase/server"

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

/** 허용 MIME 타입 */
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number]

/** 최대 파일 크기: 10MB */
const MAX_FILE_SIZE = 10 * 1024 * 1024

/** 리사이즈 기준 너비 (px) */
const MAX_WIDTH = 2000

/** JPEG 출력 품질 */
const OUTPUT_QUALITY = 85

// ─────────────────────────────────────────
// Zod 스키마
// ─────────────────────────────────────────

/** usageContext 필드 검증 */
const usageContextSchema = z.enum(["listing_thumbnail", "listing_detail"])

// ─────────────────────────────────────────
// 응답 타입
// ─────────────────────────────────────────

interface UploadSuccessData {
  url: string
  assetId: string
  fileName: string
  fileSize: number
}

interface ApiSuccessResponse {
  success: true
  data: UploadSuccessData
}

interface ApiErrorResponse {
  success: false
  error: string
  code:
    | "AUTH_REQUIRED"
    | "INVALID_CONTENT_TYPE"
    | "FORM_PARSE_ERROR"
    | "MISSING_FILE"
    | "MISSING_USAGE_CONTEXT"
    | "INVALID_USAGE_CONTEXT"
    | "INVALID_FILE_TYPE"
    | "FILE_TOO_LARGE"
    | "UPLOAD_FAILED"
    | "SERVER_ERROR"
}

// ─────────────────────────────────────────
// 헬퍼: magic bytes 검증
// ─────────────────────────────────────────

/**
 * 파일 버퍼의 시그니처(magic bytes)로 실제 이미지 타입을 검증합니다.
 * Content-Type 위조 공격을 방어합니다.
 */
function validateMagicBytes(buffer: Uint8Array): boolean {
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return true
  }
  // WebP: RIFF????WEBP (4~7번째 바이트 = WEBP)
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
    return true
  }
  return false
}

// ─────────────────────────────────────────
// 헬퍼: Sharp 이미지 처리
// ─────────────────────────────────────────

/**
 * 이미지를 처리합니다.
 * - 너비 2000px 초과 시 비율 유지하며 리사이즈
 * - WebP 입력 포함 모든 포맷 → JPEG 변환 (quality 85)
 */
async function processImage(inputBuffer: Buffer): Promise<{
  buffer: Buffer
  width: number
  height: number
  fileSize: number
}> {
  const image = sharp(inputBuffer)
  const metadata = await image.metadata()
  const originalWidth = metadata.width ?? 0

  let pipeline = image

  // 2000px 초과 시에만 리사이즈
  if (originalWidth > MAX_WIDTH) {
    pipeline = pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true })
  }

  // 항상 JPEG로 출력 (WebP 포함 모든 입력 포맷 통일)
  const outputBuffer = await pipeline
    .jpeg({ quality: OUTPUT_QUALITY, progressive: true })
    .toBuffer({ resolveWithObject: false })

  // 처리 후 실제 해상도 확인
  const outputMeta = await sharp(outputBuffer).metadata()

  return {
    buffer: outputBuffer,
    width: outputMeta.width ?? 0,
    height: outputMeta.height ?? 0,
    fileSize: outputBuffer.length,
  }
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(
  request: NextRequest
): Promise<Response> {
  // 1. 인증 검증
  const auth = await requireAuth(request)
  if (auth instanceof Response) {
    // requireAuth가 반환하는 401 응답을 에러 코드 포함 형태로 재구성
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
    // 2. multipart/form-data 파싱
    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return Response.json(
        {
          success: false,
          error: "FormData 파싱에 실패했습니다.",
          code: "FORM_PARSE_ERROR",
        } satisfies ApiErrorResponse,
        { status: 400 }
      )
    }

    // 3. 필수 필드 존재 확인
    const fileField = formData.get("file")
    if (!fileField || !(fileField instanceof File)) {
      return Response.json(
        {
          success: false,
          error: "file 필드가 누락되었거나 유효하지 않습니다.",
          code: "MISSING_FILE",
        } satisfies ApiErrorResponse,
        { status: 400 }
      )
    }

    const usageContextRaw = formData.get("usageContext")
    if (!usageContextRaw || typeof usageContextRaw !== "string") {
      return Response.json(
        {
          success: false,
          error:
            "usageContext 필드가 누락되었습니다. 허용값: listing_thumbnail | listing_detail",
          code: "MISSING_USAGE_CONTEXT",
        } satisfies ApiErrorResponse,
        { status: 400 }
      )
    }

    const usageContextParsed = usageContextSchema.safeParse(usageContextRaw)
    if (!usageContextParsed.success) {
      return Response.json(
        {
          success: false,
          error: `usageContext 값이 올바르지 않습니다. 허용값: listing_thumbnail | listing_detail`,
          code: "INVALID_USAGE_CONTEXT",
        } satisfies ApiErrorResponse,
        { status: 400 }
      )
    }

    const usageContext = usageContextParsed.data

    // 4. 파일 타입 검증 (서버사이드 MIME 타입 확인)
    const declaredMime = fileField.type as AllowedMimeType
    if (!ALLOWED_MIME_TYPES.includes(declaredMime)) {
      return Response.json(
        {
          success: false,
          error: `지원하지 않는 파일 형식입니다: ${fileField.type}. 허용 형식: ${ALLOWED_MIME_TYPES.join(", ")}`,
          code: "INVALID_FILE_TYPE",
        } satisfies ApiErrorResponse,
        { status: 415 }
      )
    }

    // 5. 파일 크기 검증
    if (fileField.size > MAX_FILE_SIZE) {
      return Response.json(
        {
          success: false,
          error: `파일 크기가 너무 큽니다. 최대 ${MAX_FILE_SIZE / 1024 / 1024}MB까지 허용됩니다.`,
          code: "FILE_TOO_LARGE",
        } satisfies ApiErrorResponse,
        { status: 413 }
      )
    }

    // 6. 파일 버퍼 읽기 + magic bytes 검증
    const arrayBuffer = await fileField.arrayBuffer()
    const uint8 = new Uint8Array(arrayBuffer)

    if (!validateMagicBytes(uint8)) {
      return Response.json(
        {
          success: false,
          error: "파일 내용이 선언된 이미지 형식과 일치하지 않습니다.",
          code: "INVALID_FILE_TYPE",
        } satisfies ApiErrorResponse,
        { status: 415 }
      )
    }

    // 7. Sharp 이미지 처리 (리사이즈 + JPEG 변환)
    let processedBuffer: Buffer
    let processedSize: number
    try {
      const result = await processImage(Buffer.from(arrayBuffer))
      processedBuffer = result.buffer
      processedSize = result.fileSize
    } catch (err) {
      console.error("[POST /api/listing/upload-image] Sharp 처리 오류:", err)
      return Response.json(
        {
          success: false,
          error: "이미지 처리 중 오류가 발생했습니다.",
          code: "UPLOAD_FAILED",
        } satisfies ApiErrorResponse,
        { status: 500 }
      )
    }

    // 8. 스토리지 경로 생성
    //    listings/{userId}/{timestamp}_{originalFileName}.jpg
    const timestamp = Date.now()
    // 원본 파일명에서 확장자 제거 후 JPEG 확장자 붙임
    const baseName = fileField.name.replace(/\.[^.]+$/, "")
    const safeBaseName = baseName.replace(/[^a-zA-Z0-9_\-가-힣]/g, "_").slice(0, 100)
    const storedFileName = `${timestamp}_${safeBaseName}.jpg`
    const storagePath = `listings/${userId}/${storedFileName}`

    // 9. Supabase Storage 업로드
    let uploadResult: { url: string; path: string; size: number }
    try {
      uploadResult = await uploadToStorage(
        storagePath,
        processedBuffer.buffer as ArrayBuffer,
        "image/jpeg",
        processedSize
      )
    } catch (err) {
      console.error(
        "[POST /api/listing/upload-image] Storage 업로드 오류:",
        err
      )
      return Response.json(
        {
          success: false,
          error:
            err instanceof Error
              ? err.message
              : "스토리지 업로드 중 오류가 발생했습니다.",
          code: "UPLOAD_FAILED",
        } satisfies ApiErrorResponse,
        { status: 502 }
      )
    }

    // 10. assets 테이블 INSERT
    const supabase = getSupabaseServerClient()

    const { data: asset, error: dbError } = await supabase
      .from("assets")
      .insert({
        user_id: userId,
        project_id: null,           // listing 이미지는 프로젝트 미연결
        storage_path: uploadResult.path,
        public_url: uploadResult.url,
        file_name: storedFileName,
        mime_type: "image/jpeg",
        file_size: processedSize,
        usage_context: usageContext,
      })
      .select("id")
      .single()

    if (dbError || !asset) {
      console.error(
        "[POST /api/listing/upload-image] DB INSERT 오류:",
        dbError
      )
      // Storage 업로드는 성공했지만 DB 실패 — 고아 파일이 되므로 Storage도 삭제 시도
      await supabase.storage
        .from("smart-seller-studio")
        .remove([storagePath])
        .catch((cleanupErr) =>
          console.error(
            "[POST /api/listing/upload-image] 고아 파일 정리 실패:",
            cleanupErr
          )
        )

      return Response.json(
        {
          success: false,
          error: "이미지 메타데이터 저장 중 오류가 발생했습니다.",
          code: "UPLOAD_FAILED",
        } satisfies ApiErrorResponse,
        { status: 500 }
      )
    }

    // 11. 성공 응답
    return Response.json(
      {
        success: true,
        data: {
          url: uploadResult.url,
          assetId: asset.id as string,
          fileName: storedFileName,
          fileSize: processedSize,
        },
      } satisfies ApiSuccessResponse,
      { status: 201 }
    )
  } catch (error) {
    console.error("[POST /api/listing/upload-image] 예기치 않은 오류:", error)
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
