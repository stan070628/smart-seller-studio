/**
 * setup.ts
 * Vitest 전역 테스트 설정
 *
 * - @testing-library/jest-dom 커스텀 매처 등록
 * - MSW 서버 수명주기 관리
 */

import '@testing-library/jest-dom';
import { afterAll, afterEach } from 'vitest';
import { server } from './mocks/server';

// MSW 서버를 모듈 로드 시점에 즉시 기동합니다.
// beforeAll 훅 대신 최상위에서 호출하여 native fetch를 pureFetch로 확보합니다.
// 이후 개별 테스트 파일에서 vi.stubGlobal('fetch', mockFetch)를 사용하면
// globalThis.fetch를 교체하여 MSW interceptor를 우회하고 mock을 직접 호출합니다.
server.listen({ onUnhandledRequest: 'warn' });

// 각 테스트 종료 후 핸들러 오버라이드 초기화 (테스트 간 격리 보장)
afterEach(() => {
  server.resetHandlers();
});

// 모든 테스트 종료 후 MSW 서버 종료
afterAll(() => {
  server.close();
});
