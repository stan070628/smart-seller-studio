/**
 * design-tokens.ts
 * 프로젝트 공통 색상 토큰 — 모든 컴포넌트가 이 파일을 참조한다.
 * 로컬 const C = { ... } 정의를 이 파일로 통합.
 */

export const C = {
  // ── 메인 영역 (라이트) ──────────────────────────
  bg:          '#f4f4f5',
  card:        '#ffffff',
  border:      '#e4e4e7',
  text:        '#18181b',
  textSub:     '#71717a',
  textMuted:   '#a1a1aa',
  accent:      '#be0014',
  accentBg:    'rgba(190,0,20,0.07)',
  accentBorder:'rgba(190,0,20,0.15)',
  tableHeader: '#f4f4f5',
  rowHover:    '#f9f9f9',

  // ── 사이드바 (다크) ──────────────────────────────
  sidebarBg:           '#0a0a0a',
  sidebarBorder:       '#242424',
  sidebarHover:        '#1c1c1c',
  sidebarActiveAccent: '#1f0004',
  sidebarText:         '#d4d4d8',
  sidebarTextActive:   '#ffffff',

  // ── 채널 ────────────────────────────────────────
  coupang: '#be0014',
  naver:   '#03c75a',

  // ── 시맨틱 ──────────────────────────────────────
  success: '#16a34a',
  warning: '#d97706',
  info:    '#2563eb',
} as const;

export type DesignTokens = typeof C;

/**
 * ERP 스타일 토큰 — 수익·원가 탭(2026-08-23)부터 적용한다.
 *
 * 위의 C와 색 계열은 같다(액센트 #be0014 유지). 다른 것은 밀도다:
 * 라운드를 없애고, 격자 구분선을 세로에도 넣고, 행 높이와 폰트를 줄인다.
 * 기존 화면은 C를 그대로 쓰므로 두 세트가 공존한다 — 개편이 끝난 화면만 E로 옮긴다.
 */
export const E = {
  // ── 면 ──────────────────────────────────────────
  ground:    '#e7ecef',   // 페이지 바탕 — 청회색 기미를 준 회색
  surface:   '#ffffff',   // 표·패널 바탕
  chrome:    '#dae1e6',   // 헤더·툴바·상태바
  chrome2:   '#eef2f4',   // 조회조건 패널·짝수 행

  // ── 선 ──────────────────────────────────────────
  line:      '#c2ccd3',   // 구조 경계
  lineSoft:  '#e1e7ea',   // 셀 구분선

  // ── 글자 ────────────────────────────────────────
  ink:       '#16202a',
  inkSub:    '#5c6b76',
  inkMute:   '#8b98a2',

  // ── 액센트 (C와 동일) ───────────────────────────
  accent:     '#be0014',
  accentSoft: '#fceff0',
  accentLine: '#eabfc4',

  // ── 시맨틱 ──────────────────────────────────────
  profit:   '#0b6e39',
  loss:     '#c22626',
  info:     '#1c6291',
  infoSoft: '#e8f1f7',
  warn:     '#9a6106',
  warnSoft: '#fdf3e0',
  naver:    '#037a38',

  // ── 치수 ────────────────────────────────────────
  rowH:      '27px',      // 그리드 행 높이
  ctrlH:     '26px',      // 버튼·입력 높이
  mono:      "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

export type ErpTokens = typeof E;
