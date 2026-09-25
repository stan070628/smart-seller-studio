/**
 * Store의 Supabase 구현. Deno 전용 — npm: 지정자 때문에 Node 테스트에서는 import하지 않는다.
 * RLS는 켜져 있고 정책이 없으므로 service role 키로 접근한다 (106 마이그레이션 주석 참조).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { Store } from './handler.ts';

export function supabaseStore(url: string, serviceRoleKey: string): Store {
  const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  return {
    async loadActiveRules() {
      const { data, error } = await db.from('ig_dm_rules').select('*').eq('active', true);
      return { data, error: error ? { code: error.code, message: error.message } : null };
    },
    async claimLog(row) {
      const { error } = await db.from('ig_dm_log').insert(row);
      return { error: error ? { code: error.code, message: error.message } : null };
    },
    async updateLog(commentId, patch) {
      const { error } = await db.from('ig_dm_log').update(patch).eq('comment_id', commentId);
      return { error: error ? { code: error.code, message: error.message } : null };
    },
    async logRequest(row) {
      const { error } = await db.from('ig_dm_webhook_log').insert(row);
      if (error) console.error('[ig-dm] webhook_log insert 실패', error.message);
    },
  };
}
