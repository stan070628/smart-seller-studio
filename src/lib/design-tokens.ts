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
