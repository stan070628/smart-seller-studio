/**
 * POST /api/storage/upload
 *
 * 이미지 파일을 받아 Base64 data URL로 변환하여 반환합니다.
 * (개인 사용 도구이므로 Supabase Storage 대신 data URL 방식 사용)
 */

import { NextRequest, NextResponse } from "next/server";

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

/** 최대 파일 크기: 10MB */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** 허용 MIME 타입 */
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

// ─────────────────────────────────────────
// 응답 타입
// ─────────────────────────────────────────

interface ApiSuccessResponse {
  success: true;
  data: { url: string; path: string; size: number };
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiSuccessResponse | ApiErrorResponse>> {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { success: false, error: "Content-Type은 multipart/form-data여야 합니다." },
        { status: 400 }
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { success: false, error: "FormData 파싱에 실패했습니다." },
        { status: 400 }
      );
    }

    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "file 필드가 누락되었거나 유효하지 않습니다." },
        { status: 400 }
      );
    }

    const mimeType = file.type as AllowedMimeType;
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json(
        {
          success: false,
          error: `지원하지 않는 파일 형식입니다: ${file.type}. 허용 형식: ${ALLOWED_MIME_TYPES.join(", ")}`,
        },
        { status: 415 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          success: false,
          error: `파일 크기가 너무 큽니다. 최대 ${MAX_FILE_SIZE / 1024 / 1024}MB까지 허용됩니다.`,
        },
        { status: 413 }
      );
    }

    // 파일을 Base64 data URL로 변환
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64}`;

    return NextResponse.json(
      {
        success: true,
        data: {
          url: dataUrl,
          path: file.name,
          size: file.size,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[/api/storage/upload] 처리 중 오류:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "파일 업로드 중 알 수 없는 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
