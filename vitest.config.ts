/**
 * vitest.config.ts
 * Vitest 테스트 환경 설정
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // jsdom 환경으로 브라우저 API 시뮬레이션
    environment: 'jsdom',
    // 테스트 시작 전 전역 설정 파일 로드
    setupFiles: ['./src/__tests__/setup.ts'],
    // 글로벌 API (describe, it, expect 등) 자동 주입
    globals: true,
    // E2E 테스트 파일은 Playwright가 담당하므로 vitest 대상에서 제외
    // .claude/worktrees/** 는 에이전트 작업 공간이므로 테스트 대상에서 제외
    exclude: ['**/node_modules/**', '**/e2e/**', '**/.claude/worktrees/**'],
    coverage: {
      // v8 기반 커버리지 수집
      provider: 'v8',
      // 커버리지 측정 대상 경로
      include: ['src/**/*'],
      // 커버리지에서 제외할 패턴
      exclude: [
        'src/**/*.d.ts',
        'src/**/mocks/**',
        'src/__tests__/**',
      ],
      // 커버리지 리포트 형식
      reporter: ['text', 'html', 'lcov'],
    },
  },
  resolve: {
    alias: {
      // tsconfig paths와 동일하게 @/ → src/ 매핑
      '@': path.resolve(__dirname, './src'),
    },
  },
});
