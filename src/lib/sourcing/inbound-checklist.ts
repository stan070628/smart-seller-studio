/**
 * 1688 입고 체크리스트
 *
 * 채널 spec v2 §6.4 — 영상 "회송 당합니다" 3편(포장/사이즈/바코드) 기준
 * SKU별 입고 전 자체 검수 항목.
 */

export interface ChecklistItem {
  id: string;
  label: string;
  caution?: string;
}

export interface ChecklistSection {
  id: 'packaging' | 'size' | 'barcode';
  title: string;
  items: ChecklistItem[];
}

export const CHECKLIST_SECTIONS: readonly ChecklistSection[] = [
  {
    id: 'packaging',
    title: '포장 (회송 1편)',
    items: [
      { id: 'pkg-1', label: '박스 손상 없음 (찢김/구겨짐 검수 완료)' },
      { id: 'pkg-2', label: 'OPP 봉투 또는 비닐 개별포장', caution: '낱개 노출 시 회송' },
      { id: 'pkg-3', label: '완충재 (에어캡/스티로폼) 적정량 충진' },
      { id: 'pkg-4', label: '쿠팡 라벨 부착 위치: 박스 가장 큰 면 상단' },
      { id: 'pkg-5', label: '냄새/이물질 없음 (중국발 곰팡이/담배 냄새 주의)' },
    ],
  },
  {
    id: 'size',
    title: '사이즈 (회송 2편)',
    items: [
      { id: 'sz-1', label: '최장변 ≤ 50cm 확인 (보관료 폭탄 회피)' },
      { id: 'sz-2', label: '무게 ≤ 25kg' },
      { id: 'sz-3', label: '1688 스펙 vs 실측 일치 (오차 ±2cm)' },
      { id: 'sz-4', label: '부피무게 = (가로×세로×높이)÷6000 계산 후 실무게와 비교' },
      { id: 'sz-5', label: '유효박스 단위 분할 시 SKU 분리 라벨 부착' },
    ],
  },
  {
    id: 'barcode',
    title: '바코드 (회송 3편)',
    items: [
      { id: 'bc-1', label: '바코드 종류: CODE128 (쿠팡 권장)' },
      { id: 'bc-2', label: '인쇄 해상도 ≥ 300dpi (긁힘/번짐 없음)' },
      { id: 'bc-3', label: '부착 위치: 박스 측면 (상단·하단 X)' },
      { id: 'bc-4', label: '바코드 크기 ≥ 25mm × 15mm' },
      { id: 'bc-5', label: '쿠팡 윙 등록 SKU 코드와 일치 확인' },
    ],
  },
] as const;

export interface SkuInput {
  title: string;
  url1688: string;
  unitPriceRmb: number;
  orderQty: number;
  maxSideCm: number;
  weightKg: number;
  skuCode?: string;
  notes?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateSkuInput(input: SkuInput): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.title || input.title.trim().length === 0) errors.push('title');
  if (!/^https?:\/\/.*1688\.com/i.test(input.url1688)) errors.push('url1688');
  if (!Number.isFinite(input.unitPriceRmb) || input.unitPriceRmb <= 0) errors.push('unitPriceRmb');
  if (!Number.isInteger(input.orderQty) || input.orderQty <= 0) errors.push('orderQty');
  if (!Number.isFinite(input.maxSideCm) || input.maxSideCm <= 0) errors.push('maxSideCm');
  if (!Number.isFinite(input.weightKg) || input.weightKg <= 0) errors.push('weightKg');

  if (input.maxSideCm > 50) warnings.push('oversize');
  if (input.weightKg > 25) warnings.push('overweight');

  return { ok: errors.length === 0, errors, warnings };
}
