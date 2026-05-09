#!/usr/bin/env node
/**
 * Chrome 브라우저에서 coupang.com 쿠키를 직접 삭제하는 스크립트
 * wing.coupang.com 400 에러 해결용
 */
import { execSync, spawnSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { copyFileSync, existsSync } from 'fs';

const COOKIE_DB_PATHS = [
  join(homedir(), 'Library/Application Support/Google/Chrome/Default/Cookies'),
  join(homedir(), 'Library/Application Support/Google/Chrome/Profile 1/Cookies'),
  join(homedir(), 'Library/Application Support/Chromium/Default/Cookies'),
];

function isChromeRunning() {
  try {
    const r = execSync('pgrep -x "Google Chrome"', { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
    return r.trim().length > 0;
  } catch {
    return false;
  }
}

function closeChrome() {
  console.log('Chrome 종료 중...');
  spawnSync('osascript', ['-e', 'tell application "Google Chrome" to quit']);
  // 프로세스가 완전히 종료될 때까지 대기
  for (let i = 0; i < 10; i++) {
    execSync('sleep 0.5');
    if (!isChromeRunning()) break;
  }
  if (isChromeRunning()) {
    // 강제 종료
    spawnSync('pkill', ['-9', 'Google Chrome']);
    execSync('sleep 1');
  }
  console.log('Chrome 종료 완료');
}

function getCookieCount(dbPath) {
  try {
    return execSync(
      `sqlite3 "${dbPath}" "SELECT COUNT(*) FROM cookies WHERE host_key LIKE '%coupang.com%';"`,
      { encoding: 'utf8' }
    ).trim();
  } catch {
    return '?';
  }
}

function getTotalSize(dbPath) {
  try {
    const result = execSync(
      `sqlite3 "${dbPath}" "SELECT SUM(LENGTH(name) + LENGTH(value)) FROM cookies WHERE host_key LIKE '%coupang.com%';"`,
      { encoding: 'utf8' }
    ).trim();
    return parseInt(result) || 0;
  } catch {
    return 0;
  }
}

// sqlite3 존재 확인
try {
  execSync('which sqlite3', { stdio: 'pipe' });
} catch {
  console.error('sqlite3가 설치되어 있지 않습니다. macOS에 기본 포함되어 있어야 합니다.');
  process.exit(1);
}

// 쿠키 DB 파일 찾기
let cookieDb = null;
for (const p of COOKIE_DB_PATHS) {
  if (existsSync(p)) {
    cookieDb = p;
    break;
  }
}

if (!cookieDb) {
  console.error('Chrome 쿠키 데이터베이스를 찾을 수 없습니다.');
  console.error('확인한 경로:', COOKIE_DB_PATHS.join('\n'));
  process.exit(1);
}

console.log(`\n쿠키 DB 위치: ${cookieDb}`);

// 삭제 전 현황
const beforeCount = getCookieCount(cookieDb);
const beforeSize = getTotalSize(cookieDb);
console.log(`\n[삭제 전] coupang.com 쿠키: ${beforeCount}개, 크기: ${beforeSize.toLocaleString()} B`);
if (beforeSize > 8192) {
  console.log(`⚠️  HTTP 헤더 한도(8,192 B) 초과 → 이것이 400 에러 원인`);
}

// Chrome 종료 (DB 파일이 잠겨있으면 삭제 불가)
const wasRunning = isChromeRunning();
if (wasRunning) {
  closeChrome();
}

// 백업
const backupPath = cookieDb + '.backup_' + Date.now();
try {
  copyFileSync(cookieDb, backupPath);
  console.log(`\n백업 완료: ${backupPath}`);
} catch (e) {
  console.error('백업 실패:', e.message);
  process.exit(1);
}

// coupang.com 쿠키 전체 삭제
console.log('\ncoupang.com 쿠키 삭제 중...');
try {
  const deletedRows = execSync(
    `sqlite3 "${cookieDb}" "DELETE FROM cookies WHERE host_key LIKE '%coupang.com%'; SELECT changes();"`,
    { encoding: 'utf8' }
  ).trim();
  console.log(`✅ ${deletedRows}개 쿠키 삭제 완료`);
} catch (err) {
  console.error('삭제 실패:', err.message);
  // 백업 복원
  copyFileSync(backupPath, cookieDb);
  console.log('백업에서 복원됨');
  process.exit(1);
}

// Chrome 재시작 및 wing 오픈
console.log('\nChrome을 열고 wing.coupang.com으로 이동합니다...');
spawnSync('open', ['-a', 'Google Chrome', 'https://wing.coupang.com/tenants/rfm-inventory/management/list']);

console.log('\n로그인 후 재고관리 페이지가 정상적으로 열릴 것입니다.');
console.log('문제가 계속되면 백업 복원: cp "' + backupPath + '" "' + cookieDb + '"');
