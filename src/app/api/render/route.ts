/**
 * POST /api/render
 *
 * 프론트 캔버스에서 넘겨준 DataURL(base64)을 받아
 * Sharp로 가로 860px 고해상도 JPEG로 최적화 후 반환합니다.
 * userId, projectId가 제공되면 Supabase Storage에도 저장합니다.
 */

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { uploadToStorage } from "@/lib/supabase/server";
import { checkRateLimit, getRateLimitKey, RATE_LIMITS } from "@/lib/rate-limit";

// ─────────────────────────────────────────
// 상수
// ─────────────────────────────────────────

/** 출력 이미지 고정 가로 크기 (px) */
const OUTPUT_WIDTH = 860;

/** 기본 JPEG 품질 */
const DEFAULT_QUALITY = 95;

/** 최대 입력 base64 크기 제한 (약 20MB) */
const MAX_INPUT_SIZE = 28 * 1024 * 1024;

// ─────────────────────────────────────────
// 요청/응답 타입
// ─────────────────────────────────────────

interface RenderRequestBody {
  dataUrl: string;
  width?: number;
  quality?: number;
  userId?: string;
  projectId?: string;
}

interface ApiSuccessResponse {
  success: true;
  /** base64 인코딩된 JPEG 이미지 (data URL 형식) */
  dataUrl: string;
  /** Supabase에 저장된 경우 공개 URL */
  storageUrl?: string;
  /** 출력 파일 크기 (bytes) */
  size: number;
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

// ─────────────────────────────────────────
// 헬퍼 함수
// ─────────────────────────────────────────

/**
 * data URL에서 base64 데이터 부분만 추출합니다.
 * "data:image/png;base64,..." → "..."
 */
function extractBase64FromDataUrl(dataUrl: string): {
  base64: string;
  mimeType: string;
} {
  if (!dataUrl.startsWith("data:")) {
    throw new Error("dataUrl은 data URL 형식이어야 합니다. (data:image/...;base64,...)");
  }

  const semiIndex = dataUrl.indexOf(";");
  const commaIndex = dataUrl.indexOf(",");

  if (semiIndex === -1 || commaIndex === -1 || commaIndex <= semiIndex) {
    throw new Error("data URL 형식이 올바르지 않습니다.");
  }

  const mimeType = dataUrl.slice(5, semiIndex); // "data:" 이후 ";" 이전
  const encoding = dataUrl.slice(semiIndex + 1, commaIndex); // "base64"

  if (encoding !== "base64") {
    throw new Error(`지원하지 않는 인코딩 방식: ${encoding}. base64만 허용됩니다.`);
  }

  const base64 = dataUrl.slice(commaIndex + 1);
  return { base64, mimeType };
}

// ─────────────────────────────────────────
// Route Handler
// ─────────────────────────────────────────

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiSuccessResponse | ApiErrorResponse>> {
  try {
    // Rate Limit 검사
    const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown'
    const rateLimitResult = checkRateLimit(getRateLimitKey(ip, 'render'), RATE_LIMITS.RENDER)
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
        {
          status: 429,
          headers: { 'X-RateLimit-Reset': rateLimitResult.resetAt.toString() }
        }
      )
    }

    // 요청 바디 파싱
    let body: RenderRequestBody;
    try {
      body = (await request.json()) as RenderRequestBody;
    } catch {
      return NextResponse.json(
        { success: false, error: "요청 바디를 JSON으로 파싱할 수 없습니다." },
        { status: 400 }
      );
    }

    const { dataUrl, width, quality, userId, projectId } = body;

    // dataUrl 검증
    if (typeof dataUrl !== "string" || dataUrl.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "dataUrl 필드가 누락되었거나 비어있습니다." },
        { status: 400 }
      );
    }

    if (dataUrl.length > MAX_INPUT_SIZE) {
      return NextResponse.json(
        { success: false, error: "입력 이미지가 너무 큽니다. 20MB 이하로 제한됩니다." },
        { status: 413 }
      );
    }

    // quality 범위 검증 (1~100)
    const outputQuality = Math.min(
      100,
      Math.max(1, Math.round(quality ?? DEFAULT_QUALITY))
    );

    // width 범위 검증 (100~3840)
    const outputWidth = Math.min(
      3840,
      Math.max(100, Math.round(width ?? OUTPUT_WIDTH))
    );

    // base64 추출
    let base64: string;
    try {
      ({ base64 } = extractBase64FromDataUrl(dataUrl));
    } catch (parseError) {
      return NextResponse.json(
        {
          success: false,
          error:
            parseError instanceof Error
              ? parseError.message
              : "data URL 파싱 실패",
        },
        { status: 400 }
      );
    }

    // base64 → Buffer 변환
    const inputBuffer = Buffer.from(base64, "base64");

    // Sharp로 이미지 처리
    // - 가로 outputWidth px 고정, 세로 비율 유지
    // - JPEG quality outputQuality
    let outputBuffer: Buffer;
    try {
      outputBuffer = await sharp(inputBuffer)
        .resize({
          width: outputWidth,
          withoutEnlargement: false, // 원본보다 작아도 강제 리사이즈
          fit: "inside",
        })
        .jpeg({ quality: outputQuality, mozjpeg: true })
        .toBuffer();
    } catch (sharpError) {
      console.error("[/api/render] Sharp 처리 오류:", sharpError);
      return NextResponse.json(
        {
          success: false,
          error:
            sharpError instanceof Error
              ? `이미지 처리 중 오류가 발생했습니다: ${sharpError.message}`
              : "이미지 처리 중 알 수 없는 오류가 발생했습니다.",
        },
        { status: 500 }
      );
    }

    const outputSize = outputBuffer.length;
    const outputBase64 = outputBuffer.toString("base64");
    const outputDataUrl = `data:image/jpeg;base64,${outputBase64}`;

    // Supabase Storage에 저장 (userId, projectId가 모두 있는 경우)
    let storageUrl: string | undefined;
    if (
      typeof userId === "string" &&
      userId.trim().length > 0 &&
      typeof projectId === "string" &&
      projectId.trim().length > 0
    ) {
      try {
        const timestamp = Date.now();
        const storagePath = `users/${userId.trim()}/${projectId.trim()}/rendered-outputs/${timestamp}_rendered.jpg`;

        const uploadResult = await uploadToStorage(
          storagePath,
          outputBuffer.buffer.slice(
            outputBuffer.byteOffset,
            outputBuffer.byteOffset + outputBuffer.byteLength
          ) as ArrayBuffer,
          "image/jpeg",
          outputSize
        );
        storageUrl = uploadResult.url;
      } catch (storageError) {
        // Storage 저장 실패는 치명적이지 않으므로 경고만 로그하고 계속 진행
        console.warn(
          "[/api/render] Supabase Storage 저장 실패 (렌더링 결과는 반환):",
          storageError
        );
      }
    }

    return NextResponse.json(
      {
        success: true,
        dataUrl: outputDataUrl,
        storageUrl,
        size: outputSize,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[/api/render] 처리 중 오류:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "이미지 렌더링 중 알 수 없는 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
