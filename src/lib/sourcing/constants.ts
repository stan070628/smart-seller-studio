// 도매꾹 API 기본 URL (직접 호출 기본값)
export const DOMEGGOOK_API_BASE_URL =
  process.env.DOMEGGOOK_API_BASE_URL || 'https://domeggook.com/ssl/api/';

// 도매꾹 API 인증 키
export const DOMEGGOOK_API_KEY = process.env.DOMEGGOOK_API_KEY || '';

// 도매꾹 전용 프록시 설정 (한국 IP 우회용) — Vultr Seoul 서버
// DOMEGGOOK_PROXY_URL: e.g. http://141.164.55.191:3001
export const DOMEGGOOK_PROXY_URL = process.env.DOMEGGOOK_PROXY_URL || '';
export const DOMEGGOOK_PROXY_SECRET = process.env.DOMEGGOOK_PROXY_SECRET || '';

// API 호출 간 딜레이 (ms) — Rate Limiting 방지
export const API_CALL_DELAY_MS = 200;

// 배치 처리 크기
export const BATCH_SIZE = 50;

// 기본 카테고리
export const DEFAULT_CATEGORIES = ['생활용품'];
