/**
 * 전인규 강의 공식 — 이 앱의 원본.
 *
 * 근거 (위키):
 *   20-wiki/sources/브랜드 강의 3교시 전인규 2026-09-20 — 착륙원가 = 위안 × 210 × 1.4
 *   20-wiki/sources/도제 상담 1회차 전인규 2026-09-27  — 원가율 10%는 최선, 30%까지 허용
 *
 * 환율 210은 실제 시세가 아니라 넉넉히 잡은 값이고, 1.4는 물류비·부가세·관세·배대지
 * 수수료를 묶은 러프한 배수다. 로켓그로스 물류비는 들어 있지 않다 — 실측 공식과의
 * 차이가 대부분 거기서 나온다. ~/dev/sourcing-review/formulas.js(/calc)는 이 파일의
 * 사본이며 통과선이 아직 10%다.
 */
export const LECTURE_RATE = 210;
export const LECTURE_MULTIPLIER = 1.4;
export const LECTURE_FEE_RATE = 0.1;
export const LECTURE_COST_RATIO_PASS = 0.3;
export const LECTURE_COST_RATIO_BEST = 0.1;

/** 강의는 1688 누적을 6개월로 보고 나눈다. 집계 기간 미확인 */
export const LECTURE_CUMULATIVE_DAYS = 180;

export interface LectureJudgement {
  landed: number;
  costRatio: number;
  profit: number;
  pass: boolean;
  best: boolean;
}

export function judgeLecture(cny: number, price: number): LectureJudgement | null {
  if (!(cny > 0) || !(price > 0)) return null;
  const landed = cny * LECTURE_RATE * LECTURE_MULTIPLIER;
  const costRatio = landed / price;
  return {
    landed,
    costRatio,
    profit: price * (1 - LECTURE_FEE_RATE) - landed,
    pass: costRatio <= LECTURE_COST_RATIO_PASS,
    best: costRatio <= LECTURE_COST_RATIO_BEST,
  };
}

/** 1688 누적 판매량 → 일 판매량 */
export function dailySalesFromCumulative(sold: number): number {
  return sold / LECTURE_CUMULATIVE_DAYS;
}
