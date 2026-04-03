/**
 * playwright.config.ts
 * Playwright E2E 테스트 환경 설정
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // 테스트 파일 경로
  testDir: './e2e',

  // 각 테스트 최대 실행 시간
  timeout: 30000,

  // assertion 타임아웃
  expect: {
    timeout: 10000,
  },

  // 전체 테스트 실패 시 중단 여부 (CI 환경에서 빠른 피드백)
  fullyParallel: true,
  forbidOnly: !!process.env.CI,

  // CI 환경에서 실패 시 재시도 횟수
  retries: process.env.CI ? 1 : 0,

  // 병렬 워커 수 (CI에서는 단일 워커로 안정성 확보)
  workers: process.env.CI ? 1 : undefined,

  // 리포트 설정
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],

  // 공통 브라우저 설정
  use: {
    // 기본 URL (로컬 개발 서버)
    baseURL: 'http://localhost:3000',

    // 테스트 실패 시 스크린샷 저장
    screenshot: 'only-on-failure',

    // 트레이스 설정 (디버깅용 — 첫 번째 재시도 때 수집)
    trace: 'on-first-retry',

    // 비디오 녹화 (실패 시에만)
    video: 'retain-on-failure',
  },

  // 브라우저 프로젝트 설정 — Chromium 단독 사용
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // 테스트 전 개발 서버 자동 기동
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    // 서버가 이미 실행 중이면 재사용
    reuseExistingServer: !process.env.CI,
    // 서버 시작 최대 대기 시간 (Next.js 빌드 포함)
    timeout: 120 * 1000,
  },
});
