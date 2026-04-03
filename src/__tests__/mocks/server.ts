/**
 * server.ts
 * MSW 서버 인스턴스
 *
 * Node.js(테스트) 환경에서 HTTP 인터셉터 역할을 합니다.
 */

import { setupServer } from 'msw/node';
import { handlers } from './handlers';

// 기본 핸들러를 등록한 MSW 서버 생성
export const server = setupServer(...handlers);
