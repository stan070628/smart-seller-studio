/**
 * Edge Function 진입점. 비밀값은 `supabase secrets set`으로 넣는다.
 * SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY는 Supabase가 자동 주입한다.
 *
 * 배포: supabase functions deploy ig-webhook --no-verify-jwt
 *   (Meta 웹훅은 Authorization 헤더 없이 오므로 JWT 검증을 끈다. 서명 검증이 문지기다.)
 */
import { handle, type Env } from './handler.ts';
import { supabaseStore } from './store.ts';

const env: Env = {
  IG_APP_SECRET: Deno.env.get('IG_APP_SECRET') ?? '',
  IG_VERIFY_TOKEN: Deno.env.get('IG_VERIFY_TOKEN') ?? '',
  IG_ACCESS_TOKEN: Deno.env.get('IG_ACCESS_TOKEN') ?? '',
  IG_USER_ID: Deno.env.get('IG_USER_ID') || undefined,
  IG_GRAPH_VERSION: Deno.env.get('IG_GRAPH_VERSION') || undefined,
};

const store = supabaseStore(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

Deno.serve((req) => handle(req, { env, store, fetch }));
