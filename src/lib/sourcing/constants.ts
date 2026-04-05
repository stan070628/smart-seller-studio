// 도매꾹 API 기본 URL (환경변수 우선, 없으면 공식 기본값)
export const DOMEGGOOK_API_BASE_URL =
  process.env.DOMEGGOOK_API_BASE_URL || 'https://domeggook.com/ssl/api/';

// 도매꾹 API 인증 키
export const DOMEGGOOK_API_KEY = process.env.DOMEGGOOK_API_KEY || '';

// API 호출 간 딜레이 (ms) — Rate Limiting 방지
export const API_CALL_DELAY_MS = 200;

// 배치 처리 크기
export const BATCH_SIZE = 50;

// 기본 카테고리
export const DEFAULT_CATEGORIES = ['생활용품'];
