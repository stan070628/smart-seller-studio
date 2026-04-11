/**
 * scripts/migrate-sourcing.mjs
 * Render PostgreSQL에 sourcing 관련 마이그레이션 파일을 순서대로 실행
 *
 * 사용법:
 *   node scripts/migrate-sourcing.mjs [파일번호...]
 *   node scripts/migrate-sourcing.mjs          # 모든 파일
 *   node scripts/migrate-sourcing.mjs 017 018 019  # 특정 파일만
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env.local 수동 파싱
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const connStr = process.env.SOURCING_DATABASE_URL;
if (!connStr) {
  console.error('❌ SOURCING_DATABASE_URL이 설정되지 않았습니다.');
  process.exit(1);
}

const url = new URL(connStr);
const pool = new pg.Pool({
  host: url.hostname,
  port: parseInt(url.port || '5432', 10),
  database: url.pathname.slice(1),
  user: url.username,
  password: decodeURIComponent(url.password),
  ssl: { rejectUnauthorized: false },
  family: 4,
});

const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');

async function run() {
  const args = process.argv.slice(2); // 예: ['017', '018', '019']
  const allFiles = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (args.length === 0) {
    console.error('❌ 실행할 마이그레이션 번호를 지정하세요.');
    console.error('   예) node scripts/migrate-sourcing.mjs 017 018 019');
    process.exit(1);
  }

  const targets = allFiles.filter((f) => args.some((n) => f.startsWith(n)));

  if (targets.length === 0) {
    console.log('실행할 마이그레이션 파일이 없습니다.');
    return;
  }

  console.log(`\n📦 Render PostgreSQL 마이그레이션 (${targets.length}개)\n`);
  const client = await pool.connect();

  try {
    for (const file of targets) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');
      process.stdout.write(`  ▶ ${file} ... `);
      try {
        await client.query(sql);
        console.log('✅');
      } catch (err) {
        console.log('❌');
        console.error(`    오류: ${err.message}`);
        // 계속 진행 (이미 적용된 경우 무시)
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log('\n완료\n');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
