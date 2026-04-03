/**
 * Supabase 서버 전용 클라이언트 (Service Role Key 사용)
 * 이 파일은 반드시 서버 컴포넌트 또는 API Routes에서만 사용해야 합니다.
 * 클라이언트 컴포넌트에서 import하면 Service Role Key가 노출됩니다.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────

/** Supabase Storage에 업로드한 결과 */
export interface StorageUploadResult {
  url: string;
  path: string;
  size: number;
}

// ─────────────────────────────────────────
// 클라이언트 싱글톤
// ─────────────────────────────────────────

let _supabaseServer: SupabaseClient | null = null;

/**
 * Service Role Key를 사용하는 서버 전용 Supabase 클라이언트를 반환합니다.
 * RLS(Row Level Security)를 우회하여 관리자 권한으로 동작합니다.
 */
export function getSupabaseServerClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error(
      "[Supabase] 환경변수 NEXT_PUBLIC_SUPABASE_URL이 설정되지 않았습니다."
    );
  }

  if (!serviceRoleKey) {
    throw new Error(
      "[Supabase] 환경변수 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다. " +
        "이 키는 서버에서만 사용해야 합니다."
    );
  }

  if (!_supabaseServer) {
    _supabaseServer = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        // 서버 클라이언트는 세션 관리가 필요 없음
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return _supabaseServer;
}

// ─────────────────────────────────────────
// Storage 헬퍼 함수
// ─────────────────────────────────────────

/** Supabase Storage 버킷명 */
export const STORAGE_BUCKET = "smart-seller-studio";

/**
 * 파일을 Supabase Storage에 업로드하고 공개 URL을 반환합니다.
 *
 * @param storagePath 버킷 내 저장 경로 (예: "users/uid/pid/raw_images/ts_file.jpg")
 * @param fileBuffer  업로드할 파일의 ArrayBuffer
 * @param mimeType    파일의 MIME 타입
 * @param fileSize    파일 크기 (bytes)
 */
export async function uploadToStorage(
  storagePath: string,
  fileBuffer: ArrayBuffer,
  mimeType: string,
  fileSize: number
): Promise<StorageUploadResult> {
  const supabase = getSupabaseServerClient();

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: mimeType,
      upsert: false, // 같은 경로에 덮어쓰기 방지 (타임스탬프로 고유 경로 사용)
    });

  if (error) {
    throw new Error(`[Supabase Storage] 업로드 실패: ${error.message}`);
  }

  // 공개 URL 조회
  const { data: urlData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(storagePath);

  return {
    url: urlData.publicUrl,
    path: storagePath,
    size: fileSize,
  };
}
