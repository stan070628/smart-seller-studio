/**
 * ShortlistItem 한 건에서 두 공급처(도매꾹·1688)의 SupplierCost를 만든다.
 *
 * 상단 표(ShortlistTab)와 비교 패널(SupplierCompare)이 같은 원가를 봐야 한다.
 * 각자 조립하면 "표는 미달인데 펼치면 통과"라는 어긋남이 형태만 바꿔 되살아난다 —
 * 그게 바로 이 화면이 고치려던 버그다. 판정 규칙은 supplier-verdict.ts가,
 * 그 규칙에 넣을 원가는 이 파일이 한 곳에서 만든다.
 */

import { calc1688UnitCost, type Cost1688Result } from '@/lib/sourcing/cost-1688';
import type { SupplierCost } from '@/lib/sourcing/supplier-verdict';
import type { ShortlistItem } from '@/types/shortlist';

export interface SupplierCosts {
  /** 도매꾹. 재검증이 원가를 세우지 못했으면(판매종료·배송비 금액 불명) null */
  dome: SupplierCost | null;
  /** 1688. 결제 확인 붙여넣기 값이 없으면 null */
  cn1688: SupplierCost | null;
  /**
   * 1688 원가 상세.
   * 비교 패널이 관세·부가세 내역까지 펼쳐 보여주는 데 쓴다 —
   * SupplierCost에는 판정에 필요한 값만 담기 때문이다.
   */
  cn1688Detail: Cost1688Result | null;
}

export function supplierCostsOf(item: ShortlistItem): SupplierCosts {
  const dome: SupplierCost | null =
    item.domePrice !== null && item.effectiveCost !== null && item.breakEvenPrice !== null
      ? {
          supplier: 'dome',
          unitPriceKrw: item.domePrice,
          shipPerUnitKrw: item.unitDeliFee ?? 0,
          // 도매꾹 배송비는 도매꾹이 고지한 정책(deli)에서 환산한 값이라 추정이 아니다
          shipEstimated: false,
          effectiveCostKrw: item.effectiveCost,
          breakEvenPriceKrw: item.breakEvenPrice,
        }
      : null;

  const pasted = item.buyKrwTotal !== null && item.orderQty1688 !== null;

  const cn1688Detail = pasted
    ? calc1688UnitCost({
        buyKrwTotal: item.buyKrwTotal!,
        orderQty: item.orderQty1688!,
        // 국제배송비 환산의 분모다. 1688 주문 수량(샘플이면 2~3개)이 아니라 사입 예정 수량이다
        sourcingOrderQty: item.orderQty,
        // 입력 필드명이 DB 컬럼명(intlShipPerUnit)과 일부러 다르다. 여기서 명시적으로 옮긴다.
        // null을 0으로 접지 않는 이유: 미입력이어야 추정이 작동한다.
        // 0으로 접으면 "사람이 0이라고 못 박은 값"이 되어 추정이 막힌다.
        intlShipPerUnitKrw: item.intlShipPerUnit,
        itemName: item.title,
        logisticsSize: item.logisticsSize,
      })
    : null;

  const cn1688: SupplierCost | null =
    cn1688Detail !== null &&
    cn1688Detail.unitKrw !== null &&
    cn1688Detail.effectiveCostKrw !== null &&
    cn1688Detail.breakEvenPriceKrw !== null
      ? {
          supplier: 'cn1688',
          unitPriceKrw: cn1688Detail.unitKrw,
          // 사람이 넣은 값이든 추정치든 실제로 원가에 들어간 값이다.
          // 어느 쪽인지는 shipEstimated가 말한다.
          shipPerUnitKrw: cn1688Detail.intlShipPerUnitKrw,
          shipEstimated: cn1688Detail.shipEstimated,
          effectiveCostKrw: cn1688Detail.effectiveCostKrw,
          breakEvenPriceKrw: cn1688Detail.breakEvenPriceKrw,
        }
      : null;

  return { dome, cn1688, cn1688Detail };
}
