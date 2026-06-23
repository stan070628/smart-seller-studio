/**
 * scripts/group-vendor-items.mjs
 * vendorItemId 목록을 sellerProductId 로 그룹핑
 *
 * 사용법:
 *   node scripts/group-vendor-items.mjs <sellerProductId> <vendorItemId1> [vendorItemId2 ...]
 *
 * 예시:
 *   node scripts/group-vendor-items.mjs 16209648179 95448956820 95448956822 95448956821
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env.local 파싱
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    process.env[key] = val;
  }
}

const [,, sellerProductIdArg, ...vendorItemIdArgs] = process.argv;

if (!sellerProductIdArg || vendorItemIdArgs.length === 0) {
  console.error('사용법: node scripts/group-vendor-items.mjs <sellerProductId> <vendorItemId1> [vendorItemId2 ...]');
  process.exit(1);
}

const sellerProductId = Number(sellerProductIdArg);
const vendorItemIds = vendorItemIdArgs.map(Number);

if (!Number.isInteger(sellerProductId) || sellerProductId <= 0) {
  console.error('sellerProductId 가 올바르지 않습니다:', sellerProductIdArg);
  process.exit(1);
}
if (vendorItemIds.some((id) => !Number.isInteger(id) || id <= 0)) {
  console.error('vendorItemId 에 올바르지 않은 값이 있습니다:', vendorItemIdArgs);
  process.exit(1);
}

const connectionString = process.env.SOURCING_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('SOURCING_DATABASE_URL 또는 DATABASE_URL 환경 변수가 없습니다.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  // 현재 상태 조회
  const { rows: before } = await pool.query(
    `SELECT id, product_name, vendor_item_id, seller_product_id
     FROM product_costs
     WHERE vendor_item_id = ANY($1::bigint[])`,
    [vendorItemIds],
  );

  if (before.length === 0) {
    console.error('해당 vendorItemId 를 가진 상품이 없습니다:', vendorItemIds);
    process.exit(1);
  }

  console.log('업데이트 대상:');
  for (const r of before) {
    console.log(`  [${r.vendor_item_id}] ${r.product_name}  seller_product_id: ${r.seller_product_id ?? '(없음)'} → ${sellerProductId}`);
  }

  const placeholders = vendorItemIds.map((_, i) => `$${i + 2}`).join(', ');
  const { rowCount, rows } = await pool.query(
    `UPDATE product_costs
     SET seller_product_id = $1
     WHERE vendor_item_id IN (${placeholders})
     RETURNING id, product_name, vendor_item_id, seller_product_id`,
    [sellerProductId, ...vendorItemIds],
  );

  console.log(`\n✅ ${rowCount}개 상품 업데이트 완료 (seller_product_id = ${sellerProductId})`);
  for (const r of rows) {
    console.log(`  [${r.vendor_item_id}] ${r.product_name}`);
  }
} finally {
  await pool.end();
}
