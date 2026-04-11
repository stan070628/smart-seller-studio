/**
 * scripts/backfill-unit-price.mjs
 * 기존 코스트코 상품의 unit_type / unit_price 백필
 *
 * 사용법:
 *   node scripts/backfill-unit-price.mjs
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

const DATABASE_URL = process.env.SOURCING_DATABASE_URL;
if (!DATABASE_URL) {
  console.error('SOURCING_DATABASE_URL 환경변수가 없습니다.');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// unit-parser 로직 (unit-parser.ts 와 동일)
// ─────────────────────────────────────────────────────────────────────────────

const WEIGHT_TO_GRAM = { mg: 0.001, g: 1, kg: 1000 };
const VOLUME_TO_ML   = { ml: 1, mL: 1, ML: 1, l: 1000, L: 1000 };

function removeBrackets(text) {
  return text.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
}

function applyMultipliers(afterUnit, baseQty) {
  let result = baseQty;
  const regex = /[xX×]\s*(\d+(?:\.\d+)?)/g;
  let match;
  while ((match = regex.exec(afterUnit)) !== null) {
    const factor = parseFloat(match[1]);
    if (!isNaN(factor) && factor > 0) result *= factor;
  }
  return result;
}

function applyAdditions(text, baseQty, unitType) {
  let result = baseQty;
  const plusRegex = /[+]\s*(\d+(?:\.\d+)?)\s*(g|kg|mg|ml|mL|ML|l|L|정|알|캡슐|캡|개|봉|매|롤|장|포|입|팩)/gi;
  let match;
  while ((match = plusRegex.exec(text)) !== null) {
    const addQty = parseFloat(match[1]);
    const addUnit = match[2].toLowerCase();
    if (isNaN(addQty) || addQty <= 0) continue;
    if (unitType === 'weight' && addUnit in WEIGHT_TO_GRAM) {
      result += addQty * WEIGHT_TO_GRAM[addUnit];
    } else if (unitType === 'volume' && addUnit in VOLUME_TO_ML) {
      result += addQty * (VOLUME_TO_ML[addUnit] ?? VOLUME_TO_ML[addUnit.toLowerCase()] ?? 1);
    } else if (unitType === 'count') {
      result += addQty;
    }
  }
  return result;
}

function parseProductUnit(title) {
  if (!title?.trim()) return { success: false, reason: '빈 상품명' };
  const cleaned = removeBrackets(title);

  // 1. 중량 (g, kg, mg)
  const weightRegex = /(\d+(?:\.\d+)?)\s*(kg|mg|g)(?!\w)/gi;
  let m;
  while ((m = weightRegex.exec(cleaned)) !== null) {
    const rawQty = parseFloat(m[1]);
    const unitKey = m[2].toLowerCase();
    if (isNaN(rawQty) || rawQty <= 0 || !(unitKey in WEIGHT_TO_GRAM)) continue;
    const baseGrams = rawQty * WEIGHT_TO_GRAM[unitKey];
    const after = cleaned.slice(m.index + m[0].length);
    const total = applyAdditions(after, applyMultipliers(after, baseGrams), 'weight');
    if (total <= 0) continue;
    return { success: true, parsed: { unitType: 'weight', totalQuantity: Math.round(total * 1000) / 1000, baseUnit: 'g', unitPriceDivisor: 100, unitPriceLabel: '100g당' } };
  }

  // 2. 용량 (ml, L)
  const volumeRegex = /(\d+(?:\.\d+)?)\s*(ml|mL|ML|l|L)(?!\w)/g;
  while ((m = volumeRegex.exec(cleaned)) !== null) {
    const rawQty = parseFloat(m[1]);
    const unitKeyRaw = m[2];
    if (isNaN(rawQty) || rawQty <= 0) continue;
    const factor = VOLUME_TO_ML[unitKeyRaw] ?? 1;
    const baseML = rawQty * factor;
    const after = cleaned.slice(m.index + m[0].length);
    const total = applyAdditions(after, applyMultipliers(after, baseML), 'volume');
    if (total <= 0) continue;
    return { success: true, parsed: { unitType: 'volume', totalQuantity: Math.round(total * 1000) / 1000, baseUnit: 'ml', unitPriceDivisor: 100, unitPriceLabel: '100ml당' } };
  }

  // 3. 낱개 (정, 알, 캡슐, 개 등)
  const countRegex = /(\d+(?:\.\d+)?)\s*(정제|캡슐|캡|알|ct|pk|개|봉|매|롤|장|포|입|팩|정)/gi;
  while ((m = countRegex.exec(cleaned)) !== null) {
    const rawQty = parseFloat(m[1]);
    if (isNaN(rawQty) || rawQty <= 0) continue;
    const after = cleaned.slice(m.index + m[0].length);
    const total = applyAdditions(after, applyMultipliers(after, rawQty), 'count');
    if (total <= 0) continue;
    return { success: true, parsed: { unitType: 'count', totalQuantity: Math.round(total * 1000) / 1000, baseUnit: '개', unitPriceDivisor: 1, unitPriceLabel: '1개당' } };
  }

  return { success: false, reason: '단위 파싱 불가' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 백필 실행
// ─────────────────────────────────────────────────────────────────────────────

const { Pool } = pg;
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const { rows: products } = await pool.query(
    `SELECT id, product_code, title, price FROM public.costco_products WHERE is_active = true ORDER BY title`
  );

  console.log(`총 ${products.length}개 상품 처리 시작...`);

  let success = 0, failed = 0;

  for (const product of products) {
    const result = parseProductUnit(product.title);

    if (!result.success) {
      failed++;
      continue;
    }

    const { unitType, totalQuantity, baseUnit, unitPriceDivisor, unitPriceLabel } = result.parsed;
    const unitPrice = totalQuantity > 0
      ? Math.round((product.price / totalQuantity) * unitPriceDivisor * 100) / 100
      : null;

    await pool.query(
      `UPDATE public.costco_products
       SET unit_type = $1, total_quantity = $2, base_unit = $3,
           unit_price = $4, unit_price_label = $5, updated_at = now()
       WHERE id = $6`,
      [unitType, totalQuantity, baseUnit, unitPrice, unitPriceLabel, product.id]
    );

    console.log(`✓ [${unitType}] ${product.title} → ${unitPriceLabel} ${unitPrice?.toLocaleString('ko-KR')}원`);
    success++;
  }

  console.log(`\n완료: 성공 ${success}개 / 실패(단위 없음) ${failed}개`);
  await pool.end();
}

run().catch((err) => {
  console.error('오류:', err);
  process.exit(1);
});
