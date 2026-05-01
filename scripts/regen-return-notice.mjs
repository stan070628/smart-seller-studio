/**
 * scripts/regen-return-notice.mjs
 *
 * frame-01-custom_return_notice.jpg 재생성 스크립트
 * 이메일을 cheongyeon.corp@gmail.com 으로 반영한 JPG를 Supabase Storage에 업로드합니다.
 *
 * 실행: node scripts/regen-return-notice.mjs
 *
 * 필수: node_modules에 playwright, sharp 설치, Playwright 브라우저 설치 완료
 */

import { chromium } from 'playwright';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as url from 'url';
import * as fs from 'fs';

// ─── env 로드 ───────────────────────────────────────────────────────────────

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

// .env.local에서 Supabase 환경변수 읽기
const envPath = path.join(projectRoot, '.env.local');
const envVars = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const SUPABASE_URL = envVars['NEXT_PUBLIC_SUPABASE_URL'];
const SUPABASE_SERVICE_KEY = envVars['SUPABASE_SERVICE_ROLE_KEY'];
const BUCKET = 'smart-seller-studio';
const STORAGE_PATH = 'fixed/frame-01-custom_return_notice.jpg';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_URL 또는 SERVICE_ROLE_KEY를 찾을 수 없습니다.');
  process.exit(1);
}

// ─── ReturnNoticeTemplate HTML ─────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"/>
<style>
  @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: transparent; }
</style>
</head>
<body>
<div id="frame" style="
  width:780px; height:1100px;
  background-color:#d9d9d9;
  font-family:'Pretendard','Apple SD Gothic Neo',sans-serif;
  overflow:hidden;
  position:relative;
  display:flex;
  flex-direction:column;
">
  <!-- 우상단 점 3개 -->
  <div style="position:absolute;top:52px;right:52px;display:flex;gap:9px;align-items:center;z-index:2;">
    <div style="width:13px;height:13px;border-radius:50%;background:#aaa;"></div>
    <div style="width:13px;height:13px;border-radius:50%;background:#aaa;"></div>
    <div style="width:13px;height:13px;border-radius:50%;background:#aaa;"></div>
  </div>

  <!-- 상단: Return 체크리스트 (570px) -->
  <div style="height:570px;flex-shrink:0;padding:52px 60px 40px;display:flex;flex-direction:column;">
    <!-- 타이틀 -->
    <div style="margin-top:80px;">
      <h1 style="font-size:84px;font-weight:900;color:#111111;margin:0;line-height:1.0;letter-spacing:-2px;display:block;">Return</h1>
      <p style="font-size:16px;color:#999999;margin:12px 0 0;font-weight:400;display:block;">@reallygreatsite</p>
    </div>
    <div style="flex:1;"></div>
    <!-- 체크리스트 -->
    <div style="display:flex;flex-direction:column;gap:16px;">
      <!-- item 1 -->
      <div style="display:flex;align-items:flex-start;gap:14px;">
        <svg viewBox="0 0 56 44" width="56" height="44" fill="none" style="flex-shrink:0;margin-top:2px;">
          <rect x="2" y="8" width="26" height="26" stroke="#111111" stroke-width="2.6"/>
          <path d="M8 22 L17 31 L50 4" stroke="#111111" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p style="font-size:22px;font-weight:700;color:#111111;margin:0;line-height:1.45;display:block;letter-spacing:-0.3px;">반품 및 교환 전 판매자에게 꼭! 문자 문의 부탁드립니다.</p>
      </div>
      <!-- item 2 -->
      <div style="display:flex;align-items:flex-start;gap:14px;">
        <svg viewBox="0 0 56 44" width="56" height="44" fill="none" style="flex-shrink:0;margin-top:2px;">
          <rect x="2" y="8" width="26" height="26" stroke="#111111" stroke-width="2.6"/>
          <path d="M8 22 L17 31 L50 4" stroke="#111111" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p style="font-size:22px;font-weight:700;color:#111111;margin:0;line-height:1.45;display:block;letter-spacing:-0.3px;">판매자 주소로 임의 반송 시 착불로 재발송됩니다.</p>
      </div>
      <!-- item 3 -->
      <div style="display:flex;align-items:flex-start;gap:14px;">
        <svg viewBox="0 0 56 44" width="56" height="44" fill="none" style="flex-shrink:0;margin-top:2px;">
          <rect x="2" y="8" width="26" height="26" stroke="#111111" stroke-width="2.6"/>
          <path d="M8 22 L17 31 L50 4" stroke="#111111" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p style="font-size:22px;font-weight:700;color:#111111;margin:0;line-height:1.45;display:block;letter-spacing:-0.3px;">출고지와 반품지가 달라 자동수거와 묶음 배송이 불가합니다.</p>
      </div>
    </div>
  </div>

  <!-- 구분선 -->
  <div style="height:1.5px;background:#b8b8b8;margin:0 60px;flex-shrink:0;"></div>

  <!-- 하단: CS Hours -->
  <div style="flex:1;padding:40px 60px 52px;display:flex;flex-direction:column;">
    <h2 style="font-size:32px;font-weight:900;color:#111111;margin:0;letter-spacing:-0.8px;display:block;">CS Hours</h2>
    <div style="height:2px;background:#111111;margin:20px 0 24px;"></div>
    <p style="font-size:44px;font-weight:900;color:#111111;margin:0;letter-spacing:-1px;display:block;">10:00 ~ 16:00</p>
    <p style="font-size:18px;font-weight:600;color:#555;margin:6px 0 0;display:block;">주말, 공휴일 휴무</p>
    <div style="flex:1;"></div>
    <p style="font-size:16px;font-weight:500;color:#111111;margin:0 0 14px;line-height:1.75;display:block;white-space:pre-line;">유선상담이 원활하지 않을 수 있습니다.
문의사항을 사이트 내 문의기능 또는 문자를 이용하여
남겨주시면 빠르게 확인 후 처리 도와드리겠습니다.</p>
    <p style="font-size:16px;font-weight:700;color:#444;margin:0;display:block;">cheongyeon.corp@gmail.com</p>
  </div>
</div>
</body>
</html>`;

// ─── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Playwright 시작...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // 뷰포트를 딱 맞게 설정
  await page.setViewportSize({ width: 780, height: 1100 });
  await page.setContent(HTML, { waitUntil: 'networkidle' });

  // 폰트 로딩 대기 (최대 3초)
  await page.waitForTimeout(2000);

  // 프레임 요소만 캡처
  const frame = await page.$('#frame');
  if (!frame) throw new Error('#frame 요소를 찾을 수 없습니다.');

  console.log('📸 스크린샷 촬영...');
  const screenshotBuffer = await frame.screenshot({ type: 'png' });

  await browser.close();

  // Sharp로 780px JPEG 변환
  console.log('🔧 Sharp로 JPEG 변환 (780px)...');
  const jpegBuffer = await sharp(screenshotBuffer)
    .resize({ width: 780, withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();

  console.log(`  → JPEG 크기: ${(jpegBuffer.length / 1024).toFixed(1)} KB`);

  // Supabase Storage에 업로드 (덮어쓰기)
  console.log('☁️  Supabase Storage 업로드...');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(STORAGE_PATH, jpegBuffer, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error) {
    console.error('❌ 업로드 실패:', error.message);
    process.exit(1);
  }

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(STORAGE_PATH);
  console.log('✅ 업로드 완료!');
  console.log('   URL:', publicUrl);
  console.log('   CDN 캐시 반영까지 최대 수 분 소요될 수 있습니다.');
}

main().catch((err) => {
  console.error('❌ 오류 발생:', err);
  process.exit(1);
});
