// scripts/ops/set-cron-secrets.mjs
// 사용법: node scripts/ops/set-cron-secrets.mjs /tmp/ssv.env
// Vercel 운영 env 파일에서 APP_URL·CRON_SECRET을 읽어 Supabase Vault에 저장(있으면 갱신). 값은 출력하지 않는다.
import pg from 'pg';
import fs from 'fs';

const read = (p) => Object.fromEntries(
  fs.readFileSync(p, 'utf-8').split('\n')
    .map((l) => l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '').trim()]),
);
if (!process.argv[2]) { console.error('사용법: node scripts/ops/set-cron-secrets.mjs <운영 env 파일>'); process.exit(1); }
const prod = read(process.argv[2]);
const local = read('.env.local');
if (!local.SUPABASE_DB_URL) { console.error('SUPABASE_DB_URL이 없다 — .env.local 확인'); process.exit(1); }
const want = { app_url: prod.APP_URL?.replace(/\/+$/, ''), cron_secret: prod.CRON_SECRET };
for (const [k, v] of Object.entries(want)) if (!v) { console.error(`${k} 값이 비었다`); process.exit(1); }

const c = new pg.Client({ connectionString: local.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
try {
  for (const [name, value] of Object.entries(want)) {
    const { rows } = await c.query('select id from vault.secrets where name = $1', [name]);
    if (rows.length) await c.query('select vault.update_secret($1, $2)', [rows[0].id, value]);
    else await c.query('select vault.create_secret($1, $2)', [value, name]);
    console.log(`✅ vault.${name} (${value.length}자)`);
  }
} finally {
  await c.end();
}
