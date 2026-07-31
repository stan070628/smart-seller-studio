/**
 * shortlist-verify.ts
 * 쇼트리스트 1건을 검증한다. 도매꾹 생존 → 배송비 환산 → 쿠팡 시세 → 판정.
 */

import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { parseDeliPolicy, unitDeliveryFee } from '@/lib/sourcing/deli-policy';
import { estimateCoupangPrice, breakEvenPrice, marginOf } from '@/lib/sourcing/coupang-price';
import { saveVerifyResult, type VerifyResult } from '@/lib/sourcing/shortlist-db';
import type { LogisticsSize } from '@/types/shortlist';

/** 도매꾹 조회 결과를 정규화한 것. null이면 상품이 존재하지 않는다. */
export interface DomeSnapshot {
  status: string;
  price: number;
  inventory: number;
  moq: number;
  deli: unknown;
}

/** 도매꾹 API가 일시적으로 실패했음을 나타낸다. dead로 오판하면 안 된다. */
export class DomeTransientError extends Error {}

/** 검증 대상 1건. listForVerify의 반환 요소를 그대로 넘길 수 있다. */
export interface VerifyTarget {
  itemNo: number;
  title: string;
  orderQty: number;
  logisticsSize: LogisticsSize;
}

function toInt(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/**
 * 도매꾹에서 상품을 조회한다.
 *
 * 반환값 의미:
 *   DomeSnapshot — 상품이 존재한다 (판매중이 아닐 수도 있다)
 *   null         — 상품이 실제로 없다 (삭제됨)
 *   예외         — API 일시 오류. 호출자는 기존 값을 유지해야 한다.
 */
export async function fetchDomeSnapshot(itemNo: number): Promise<DomeSnapshot | null> {
  try {
    const detail = await getDomeggookClient().getItemView(itemNo);

    return {
      status: String(detail.basis?.status ?? '알수없음'),
      price: toInt(detail.price?.dome),
      inventory: toInt(detail.qty?.inventory),
      moq: toInt(detail.qty?.domeMoq) || 1,
      deli: detail.deli,
    };
  } catch (err) {
    // 도매꾹은 없는 상품에 dcode=ITEM_ERROR를 준다.
    // domeggook-client.getItemView는 `[도매꾹] 상품 ${itemNo} 상세 응답 오류: ${JSON.stringify(errors)}`
    // 형태로 던지므로, errors 객체 안의 dcode가 메시지 문자열에 그대로 직렬화되어 들어온다.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ITEM_ERROR')) return null;
    throw new DomeTransientError(msg);
  }
}

/**
 * dome.deli가 "확인 불가능한 유료 배송비"인지 판정한다.
 *
 * parseDeliPolicy(deli-policy.ts)는 무료 신호(pay==='무료' | who==='S')가 없는데
 * fee·tbl도 못 읽은 경우를 FREE로 접는다 — 반환된 DeliPolicy만 보면 진짜 무료와
 * 이 경로가 구분되지 않는다. 그래서 원본 deli 객체를 다시 봐서 무료 신호가 실제로
 * 있었는지 확인한다. deli-policy.ts는 이 목적을 위해 수정하지 않는다(수정 범위 제한).
 *
 * deli 필드 자체가 없는 경우(undefined·비객체)는 이 판정 대상이 아니다 — "정보가
 * 아예 없음"과 "유료 신호는 있는데 금액을 못 읽음"은 다른 문제다. 전자는 도매꾹
 * 응답에 deli 자체가 누락된 것이라 기존 관례(FREE 취급)를 그대로 따른다.
 */
function isUnconfirmedPaidDelivery(deli: unknown, isFree: boolean): boolean {
  if (!isFree) return false;
  if (!deli || typeof deli !== 'object') return false;
  const raw = deli as Record<string, unknown>;
  const pay = typeof raw.pay === 'string' ? raw.pay : '';
  const who = typeof raw.who === 'string' ? raw.who : '';
  return pay !== '무료' && who !== 'S';
}

/**
 * 검증 결과를 계산한다. 외부 호출은 estimateCoupangPrice 하나뿐이라 테스트하기 쉽다.
 *
 * @param dome null이면 도매꾹에서 삭제된 상품
 */
export async function buildVerifyResult(
  title: string,
  dome: DomeSnapshot | null,
  orderQty: number,
  logisticsSize: LogisticsSize,
): Promise<VerifyResult> {
  const empty = {
    deliIsFree: null, deliType: null, deliUnitQty: null, deliFee: null,
    coupangP25: null, coupangSampleN: null,
    unitDeliFee: null, effectiveCost: null,
    breakEvenPrice: null, margin: null, marginRate: null,
  };

  // 삭제됨 — 쿠팡을 조회할 이유가 없다
  if (dome === null) {
    return {
      ...empty,
      domeStatus: '삭제됨',
      domePrice: null, domeInventory: null, domeMoq: null,
      verdict: 'dead',
    };
  }

  const domeFields = {
    domeStatus: dome.status,
    domePrice: dome.price,
    domeInventory: dome.inventory,
    domeMoq: dome.moq,
  };

  // 판매중이 아니면 더 볼 것이 없다
  if (dome.status !== '판매중') {
    return { ...empty, ...domeFields, verdict: 'dead' };
  }

  const policy = parseDeliPolicy(dome.deli);

  // 무료 신호 없이 fee·tbl도 못 읽어 FREE로 접힌 경우 — 실제로는 "유료인데 금액 불명"일
  // 수 있다. 이걸 무료로 믿고 원가를 계산하면 과소산정된 원가로 pass가 나갈 수 있다.
  // 원가 과소산정은 "떨어뜨려야 할 후보를 통과시키는" 방향의 오류라 반대 방향(과대산정)보다
  // 비싸다고 판단해 dead와 동일하게 쿠팡 조회 전에 걸러 verdict='unknown'으로 보낸다.
  // (실제 응답 표본에서는 이 경로가 관측된 적이 없다 — deli-policy.ts 주석 참고. 그래도
  //  분기 자체는 몇 줄이고, 쿠팡 API 호출 하나를 아끼는 효과도 있어 넣어 둔다.)
  if (isUnconfirmedPaidDelivery(dome.deli, policy.isFree)) {
    return { ...empty, ...domeFields, verdict: 'unknown' };
  }

  const unitDeli = unitDeliveryFee(policy, orderQty);
  const effectiveCost = dome.price + unitDeli;
  const be = breakEvenPrice(effectiveCost, logisticsSize);

  const deliFields = {
    deliIsFree: policy.isFree,
    deliType: policy.type,
    deliUnitQty: policy.unitQty,
    deliFee: policy.fee,
    unitDeliFee: unitDeli,
    effectiveCost,
    breakEvenPrice: be,
  };

  const estimate = await estimateCoupangPrice(title);

  // 표본 부족 — 판정 불가. fail과 구분한다.
  if (estimate === null) {
    return {
      ...domeFields,
      ...deliFields,
      coupangP25: null,
      coupangSampleN: null,
      margin: null,
      marginRate: null,
      verdict: 'unknown',
    };
  }

  const margin = marginOf(estimate.p25, effectiveCost, logisticsSize);

  return {
    ...domeFields,
    ...deliFields,
    coupangP25: estimate.p25,
    coupangSampleN: estimate.sampleN,
    margin,
    marginRate: Math.round((margin / estimate.p25) * 1000) / 10,
    verdict: estimate.p25 >= be ? 'pass' : 'fail',
  };
}

/**
 * 1건을 검증하고 저장한다.
 * 도매꾹 일시 오류면 아무것도 저장하지 않고 false를 반환한다 —
 * verified_at을 갱신하지 않아야 다음 cron이 다시 시도한다.
 *
 * 인자를 객체로 받는 이유: itemNo와 orderQty가 둘 다 number라
 * 위치 인자로 두면 뒤바뀌어도 컴파일이 통과한다.
 */
export async function verifyOne(target: VerifyTarget): Promise<boolean> {
  const { itemNo, title, orderQty, logisticsSize } = target;

  let dome: DomeSnapshot | null;
  try {
    dome = await fetchDomeSnapshot(itemNo);
  } catch (err) {
    if (err instanceof DomeTransientError) return false;
    throw err;
  }

  const result = await buildVerifyResult(title, dome, orderQty, logisticsSize);
  await saveVerifyResult(itemNo, result);
  return true;
}
