/**
 * 소싱 쇼트리스트 타입
 * 스펙: docs/superpowers/specs/2026-07-31-sourcing-shortlist-design.md
 */

/** 로켓그로스 사이즈 유형. 물류비가 사이즈마다 다르다. */
export type LogisticsSize = 'xsmall' | 'small' | 'medium';

/** 검증 판정 결과 */
export type Verdict =
  | 'pass'     // 쿠팡 p25 ≥ 손익분기가
  | 'fail'     // 쿠팡 p25 < 손익분기가
  | 'dead'     // 도매꾹에서 판매종료·삭제
  | 'unknown'; // 쿠팡 표본 부족으로 판정 불가

/** 도매꾹 배송비 정책 */
export type DeliType = 'fixed' | 'tiered';

export interface DeliPolicy {
  isFree: boolean;
  type: DeliType;
  /** tiered일 때 구간 수량. fixed면 null */
  unitQty: number | null;
  /** 구간 요금 또는 고정 요금 */
  fee: number;
}

export interface ShortlistItem {
  itemNo: number;
  title: string;
  memo: string | null;
  addedAt: string;

  domeStatus: string | null;
  domePrice: number | null;
  domeInventory: number | null;
  domeMoq: number | null;

  deliIsFree: boolean | null;
  deliType: DeliType | null;
  deliUnitQty: number | null;
  deliFee: number | null;

  coupangP25: number | null;
  coupangSampleN: number | null;

  orderQty: number;
  unitDeliFee: number | null;
  effectiveCost: number | null;
  logisticsSize: LogisticsSize;
  breakEvenPrice: number | null;
  margin: number | null;
  marginRate: number | null;
  verdict: Verdict | null;
  verifiedAt: string | null;

  isArchived: boolean;
}
