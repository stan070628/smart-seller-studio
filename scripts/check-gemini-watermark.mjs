/**
 * Gemini API 티어 판별기
 *
 * gemini-2.5-flash-image는 무료 티어 키로 생성한 이미지에만
 * 눈에 보이는 스파클(✦) 워터마크를 우하단에 붙인다.
 * 평평한 어두운 씬을 1장 생성해 우하단 밝기 블롭을 찾아 티어를 추정한다.
 *
 * 실행: node scripts/check-gemini-watermark.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import sharp from 'sharp';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = os.tmpdir();
const MODEL = 'gemini-2.5-flash-image';

/** 워터마크가 얹히면 반드시 도드라지도록 평평하고 어두운 씬을 요청한다. */
const PROMPT =
  'A completely flat, evenly lit dark charcoal gray studio backdrop. ' +
  'No objects, no people, no text, no logos, no gradients, no vignette. ' +
  'Uniform matte surface filling the entire frame.';

/** .env.local에서 키 하나를 읽는다 (dotenv 의존성 없이). */
function readEnv(name) {
  const raw = fs.readFileSync(path.join(PROJECT_ROOT, '.env.local'), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, '').trim();
  }
  return null;
}

/**
 * 우하단 사분면에서 배경 대비 밝은 픽셀 덩어리를 찾는다.
 * 스파클은 작고(전체의 0.1% 미만) 배경보다 훨씬 밝다.
 */
async function findBrightBlob(buffer) {
  const img = sharp(buffer).grayscale();
  const { width, height } = await img.metadata();
  const { data } = await img.raw().toBuffer({ resolveWithObject: true });

  const x0 = Math.floor(width * 0.7);
  const y0 = Math.floor(height * 0.7);

  // 검사 영역의 중앙값을 배경 밝기로 삼는다 (평균은 워터마크에 끌려간다).
  const region = [];
  for (let y = y0; y < height; y++) {
    for (let x = x0; x < width; x++) region.push(data[y * width + x]);
  }
  region.sort((a, b) => a - b);
  const median = region[Math.floor(region.length / 2)];
  const threshold = median + 40;

  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, count = 0, peak = 0;
  for (let y = y0; y < height; y++) {
    for (let x = x0; x < width; x++) {
      const v = data[y * width + x];
      if (v <= threshold) continue;
      count++;
      peak = Math.max(peak, v);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  return {
    width, height, median, threshold, count, peak,
    box: count > 0
      ? { xPct: [minX / width, maxX / width], yPct: [minY / height, maxY / height] }
      : null,
  };
}

async function main() {
  const apiKey = readEnv('GOOGLE_AI_API_KEY');
  if (!apiKey) {
    console.error('✗ .env.local에 GOOGLE_AI_API_KEY가 없습니다.');
    process.exit(1);
  }
  console.log(`키: ${apiKey.slice(0, 6)}…${apiKey.slice(-4)}`);
  console.log(`모델: ${MODEL} — 검사용 이미지 1장 생성 중…\n`);

  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model: MODEL,
    config: { responseModalities: ['Text', 'Image'] },
    contents: [{ role: 'user', parts: [{ text: PROMPT }] }],
  });

  const parts = res?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart) {
    console.error('✗ 응답에 이미지가 없습니다:', JSON.stringify(res).slice(0, 500));
    process.exit(1);
  }

  const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
  const outPath = path.join(OUT_DIR, 'tier-probe.png');
  fs.writeFileSync(outPath, buffer);

  const r = await findBrightBlob(buffer);
  console.log(`이미지: ${r.width}×${r.height} → ${outPath}`);
  console.log(`우하단 배경 밝기(중앙값): ${r.median}, 임계: ${r.threshold}`);
  console.log(`임계 초과 픽셀: ${r.count}개, 최대 밝기: ${r.peak}`);
  if (r.box) {
    const f = (n) => (n * 100).toFixed(1);
    console.log(`밝기 블롭 위치: 가로 ${f(r.box.xPct[0])}~${f(r.box.xPct[1])}%, 세로 ${f(r.box.yPct[0])}~${f(r.box.yPct[1])}%`);
  }

  // 스파클은 작은 덩어리다. 배경 자체가 밝거나 얼룩지면 픽셀 수가 폭증하므로 상한도 둔다.
  const areaPct = r.count / (r.width * r.height);
  const looksLikeSparkle = r.count > 30 && areaPct < 0.01;

  console.log('\n' + '─'.repeat(50));
  if (looksLikeSparkle) {
    console.log('판정: 워터마크 있음 → 무료 티어 키로 보입니다.');
    console.log('      Google Cloud 결제를 연결해 유료 티어로 올리면 사라집니다.');
  } else if (r.count === 0) {
    console.log('판정: 워터마크 없음 → 유료 티어 키로 보입니다.');
  } else {
    console.log('판정: 불확실 — 배경이 균일하지 않게 생성됐습니다.');
    console.log(`      ${outPath} 를 직접 열어 우하단 ✦ 표시를 확인하세요.`);
  }
  console.log('─'.repeat(50));
}

main().catch((e) => {
  console.error('✗ 실패:', e?.message ?? e);
  process.exit(1);
});
