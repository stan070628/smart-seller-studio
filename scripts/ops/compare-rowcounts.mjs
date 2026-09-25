// scripts/ops/compare-rowcounts.mjs
// 사용법: node scripts/ops/compare-rowcounts.mjs <대상 DB URL 환경변수 이름>
// 셀러 DB(SUPABASE_DB_URL)와 대상 DB의 투자콕 테이블 행 수를 비교한다. 하나라도 다르면 exit 1.
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env.local'), 'utf-8').split('\n')
  .map((l) => l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)).filter(Boolean)
  .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const targetKey = process.argv[2];
if (!targetKey) { console.error('사용법: node scripts/ops/compare-rowcounts.mjs <환경변수 이름>'); process.exit(1); }
if (!env.SUPABASE_DB_URL || !env[targetKey]) { console.error(`.env.local에 SUPABASE_DB_URL 또는 ${targetKey}가 없다`); process.exit(1); }
const tables = fs.readFileSync(path.join(root, 'scripts/ops/investcock-tables.txt'), 'utf-8').split('\n').filter(Boolean);

const count = async (url) => {
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const out = {};
    for (const t of tables) out[t] = Number((await c.query(`select count(*) from public."${t}"`)).rows[0].count);
    return out;
  } finally {
    await c.end();
  }
};
const [src, dst] = await Promise.all([count(env.SUPABASE_DB_URL), count(env[targetKey])]);
const diff = tables.filter((t) => src[t] !== dst[t]);
for (const t of diff) console.log(`❌ ${t}: 원본 ${src[t]} / 대상 ${dst[t]}`);
console.log(`${tables.length - diff.length}/${tables.length} 일치`);
process.exitCode = diff.length ? 1 : 0;
