// scripts/apply-migration.mjs
// 사용법: node scripts/apply-migration.mjs 107
// SUPABASE_DB_URL에 마이그레이션 하나를 트랜잭션으로 적용한다. 실패하면 롤백하고 exit 1.
// (scripts/migrate-sourcing.mjs는 오류를 삼키고 계속 진행해서 재사용하지 않는다)
// 마이그레이션 파일 안에 BEGIN/COMMIT을 넣지 않는다 — 파일의 COMMIT이 바깥 트랜잭션을 먼저 커밋해 원자성이 깨진다.
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf-8').split('\n')) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
if (!process.env.SUPABASE_DB_URL) { console.error('SUPABASE_DB_URL이 없다 — .env.local 확인'); process.exit(1); }

const num = process.argv[2];
if (!num) { console.error('번호를 지정하세요. 예) node scripts/apply-migration.mjs 107'); process.exit(1); }
const dir = path.join(root, 'supabase', 'migrations');
const matches = fs.readdirSync(dir).filter((f) => f.startsWith(num + '_'));
if (matches.length === 0) { console.error(`${num}_*.sql 없음`); process.exit(1); }
if (matches.length >= 2) { console.error(`${num}_ 파일이 ${matches.length}개: ${matches.join(', ')}`); process.exit(1); }
const file = matches[0];

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('begin');
  await client.query(fs.readFileSync(path.join(dir, file), 'utf-8'));
  await client.query('commit');
  console.log(`✅ ${file}`);
} catch (e) {
  console.error(`❌ ${file}: ${e.message}`);
  await client.query('rollback').catch(() => {});
  process.exitCode = 1;
} finally {
  await client.end();
}
