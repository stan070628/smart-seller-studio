// scripts/erp/_env.ts
// 스크립트 공용 .env.local 로더. 값이 이미 있으면 덮어쓰지 않는다.
import fs from 'node:fs';
import path from 'node:path';

export function loadEnvLocal(): void {
  const file = path.join(__dirname, '..', '..', '.env.local');
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
