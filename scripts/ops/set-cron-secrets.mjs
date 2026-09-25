// scripts/ops/set-cron-secrets.mjs
// 사용법: node scripts/ops/set-cron-secrets.mjs <운영 env 파일> <운영 URL>
// APP_URL은 Vercel env에 없어 인자로 받는다(운영: https://smartsellerstudio.vercel.app).
// 운영 env 파일에서 CRON_SECRET을 읽고, URL과 함께 Supabase Vault에 저장(있으면 갱신)한다. 값은 출력하지 않는다.
import pg from 'pg';
import fs from 'fs';

const read = (p) => Object.fromEntries(
  fs.readFileSync(p, 'utf-8').split('\n')
    .map((l) => l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '').trim()]),
);
if (!process.argv[2] && !process.argv[3]) {
  console.error('사용법: node scripts/ops/set-cron-secrets.mjs <운영 env 파일> <운영 URL>');
  process.exit(1);
}
const prod = read(process.argv[2]);
const local = read('.env.local');
if (!local.SUPABASE_DB_URL) { console.error('SUPABASE_DB_URL이 없다 — .env.local 확인'); process.exit(1); }
const app_url = (process.argv[3] ?? prod.APP_URL)?.replace(/\/+$/, '');
if (!app_url?.startsWith('https://')) { console.error('app_url은 https:// 로 시작해야 한다'); process.exit(1); }
const want = { app_url, cron_secret: prod.CRON_SECRET };
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
