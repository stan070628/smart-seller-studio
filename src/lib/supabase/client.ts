/**
 * Supabase 브라우저 전용 클라이언트 싱글톤
 *
 * - NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 환경변수 사용
 * - 서버 컴포넌트나 API Route에서는 server.ts의 getSupabaseServerClient()를 사용하세요.
 * - 한 번 생성된 인스턴스를 재사용하므로 여러 컴포넌트에서 안전하게 호출 가능합니다.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// 브라우저 환경에서의 클라이언트 싱글톤
let _browserClient: SupabaseClient | null = null;

/**
 * 브라우저 환경용 Supabase 클라이언트를 반환합니다.
 *
 * @throws 서버 환경(SSR)에서 호출 시 에러
 * @throws 환경변수 미설정 시 에러
 */
export function getBrowserClient(): SupabaseClient {
  if (typeof window === "undefined") {
    throw new Error(
      "[Supabase] getBrowserClient는 브라우저 환경에서만 사용 가능합니다. " +
        "서버 컴포넌트 또는 API Route에서는 getSupabaseServerClient()를 사용하세요."
    );
  }

  if (!_browserClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url) {
      throw new Error(
        "[Supabase] 환경변수 NEXT_PUBLIC_SUPABASE_URL이 설정되지 않았습니다."
      );
    }
    if (!key) {
      throw new Error(
        "[Supabase] 환경변수 NEXT_PUBLIC_SUPABASE_ANON_KEY가 설정되지 않았습니다."
      );
    }

    _browserClient = createClient(url, key);
  }

  return _browserClient;
}
