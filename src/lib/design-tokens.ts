/**
 * design-tokens.ts
 * 프로젝트 공통 색상 토큰 — 모든 컴포넌트가 이 파일을 참조한다.
 * 로컬 const C = { ... } 정의를 이 파일로 통합.
 */

export const C = {
  bg:          '#f9f9f9',
  card:        '#ffffff',
  border:      '#eeeeee',
  text:        '#1a1c1c',
  textSub:     '#926f6b',
  accent:      '#be0014',
  tableHeader: '#f3f3f3',
  rowHover:    '#f5f5f5',
} as const;

export type DesignTokens = typeof C;
