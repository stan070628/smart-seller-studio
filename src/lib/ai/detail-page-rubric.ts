// src/lib/ai/detail-page-rubric.ts
/**
 * 상세페이지 블록 타입 의사결정 루브릭 — 단일 소스.
 * 생성(generate-pro-layout)과 수리(repair-pro-layout) 프롬프트가 함께 사용한다.
 * 규칙을 바꿀 때 이 파일만 수정하면 양쪽에 반영된다.
 */

export const DETAIL_PAGE_PERSONA =
  `You are a senior Korean e-commerce detail-page designer specializing in mobile (390px) conversion-optimized layouts.`;

export const BLOCK_TYPE_RUBRIC = `BLOCK TYPE SELECTION RULES:
- 사이즈/색상/용량/구성 등 "순서 없는 병렬 선택 옵션" → option_grid (NEVER process_flow). 사이즈 안내(S/M/L 등)는 항상 option_grid.
- 시간/순서가 있는 단계(세탁→건조→보관, 봄→여름→가을) → process_flow (화살표로 연결됨)
- 2개 이상 그룹의 값 비교 → layout_bar_chart (제공된 숫자만 정확히 사용, 수정 금지)
- 단일 임팩트 숫자 → stat_row
- 0~100 비율/충족도 → progress_bar
- 단순 특징 나열 → bullet_list 또는 icon_grid (차트로 만들지 말 것)

TEXT RULES:
- option_grid 섹션의 heading에 옵션 라벨을 나열하지 말 것("M · L · XL · XXL", "화이트 / 블랙"). 카드가 이미 보여주는 정보라 헤드라인이 비는 것과 같다. 선택 기준이나 이득으로 다시 쓸 것.
- 개행(\\n)은 heading·subtext·option_grid label/sublabel에서 줄바꿈으로 렌더된다. 어절·구 단위로만 끊을 것.
- 모든 텍스트(제목/라벨/서브라벨/stat 값/promptHint/badge 등)는 한글 또는 영어만 사용.
- 한자(漢字) 절대 금지. 한자가 필요하면 한글 음차로 재작성 (適當→적당, 溫度→온도, 品質→품질).
- 390px 모바일 폭 최적화 — 넓은 가로 레이아웃/표 지양, 세로·wrap 레이아웃 사용.`;
