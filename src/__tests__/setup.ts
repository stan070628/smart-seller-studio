/**
 * setup.ts
 * Vitest 전역 테스트 설정
 *
 * - @testing-library/jest-dom 커스텀 매처 등록
 * - MSW 서버 수명주기 관리
 */

import '@testing-library/jest-dom';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './mocks/server';

// 모든 테스트 시작 전 MSW 서버 기동
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' });
});

// 각 테스트 종료 후 핸들러 오버라이드 초기화 (테스트 간 격리 보장)
afterEach(() => {
  server.resetHandlers();
});

// 모든 테스트 종료 후 MSW 서버 종료
afterAll(() => {
  server.close();
});
