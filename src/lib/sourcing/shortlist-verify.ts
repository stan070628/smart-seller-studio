/**
 * shortlist-verify.ts
 * 쇼트리스트 1건을 검증한다. 도매꾹 생존 → 배송비 환산 → 저장된 쿠팡 실판가 → 판정.
 * 쿠팡 시세는 더 이상 조회하지 않는다 — buildVerifyResult 주석 참고(2026-07-31).
 */

import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { parseDeliPolicy, unitDeliveryFee } from '@/lib/sourcing/deli-policy';
import { breakEvenPrice, marginOf } from '@/lib/sourcing/coupang-price';
import { saveVerifyResult, type VerifyResult } from '@/lib/sourcing/shortlist-db';
import type { LogisticsSize } from '@/types/shortlist';

/** 도매꾹 조회 결과를 정규화한 것. null이면 상품이 존재하지 않는다. */
export interface DomeSnapshot {
  status: string;
  price: number;
  inventory: number;
  moq: number;
  deli: unknown;
  /** 상품명. 라우트가 상품명만 얻으려고 다시 조회하지 않도록 함께 담는다. */
  title?: string;
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

/**
 * 재검증 배치 결과. 라우트 응답과 UI가 공유한다.
 * cron(/api/sourcing/cron/shortlist-verify)과 수동(/api/sourcing/shortlist/verify)
 * 라우트가 둘 다 이 형태로 응답한다 — 수동 라우트는 건별 try/catch로 격리하지
 * 않으므로 failed를 집계하지 않아 그 필드만 없다.
 */
export interface ShortlistVerifyResult {
  /** 검증을 마치고 저장된 건수 */
  verified: number;
  /**
   * 도매꾹 일시 오류로 이번엔 건너뛴 건수.
   * 실패가 아니다 — 아무것도 저장하지 않았으므로 다음 자동 검증이 다시 시도한다.
   * UI에서 에러로 표시하지 말 것.
   */
  skipped: number;
  /**
   * 예상 못 한 예외가 난 건수. cron만 집계한다.
   * 이건 실제 실패이며 로그를 봐야 한다.
   */
  failed?: number;
  /**
   * 시간이 모자라 손도 대지 못한 건수(데드라인 가드로 조기 종료된 나머지).
   * skipped와 달리 verifyOne을 호출조차 하지 않았다. 다시 호출하면
   * verified_at ASC 정렬 덕에 오래된 것부터 이어서 처리한다.
   */
  remaining: number;
  /** 이번 배치의 대상 건수 */
  total: number;
}

/**
 * 배치 페이싱·데드라인 상수. cron과 수동 라우트가 각자 루프를 돌리지만 네이버
 * API 호출 규약과 타임아웃 방어 여유는 같아야 하므로 여기 한 곳에서 관리한다.
 *
 * 2026-07-31 기준 이 상수의 원래 근거는 사라졌다. 예전에는 verifyOne 1건이
 * estimateCoupangPrice를 통해 네이버 쇼핑 API를 최대 4회 호출했으나, 네이버
 * 쇼핑 검색 API 종료로 그 호출이 제거됐다. 지금 verifyOne이 때리는 외부 API는
 * 도매꾹뿐이다. 상수와 delay는 도매꾹 페이싱으로 그대로 쓰되(이 저장소 선례는
 * naver-prices/route.ts의 NAVER_CALL_DELAY_MS·delay 패턴), 이름이 더 이상
 * 대상을 정확히 가리키지 않는다는 점은 알고 있어야 한다.
 */
export const NAVER_CALL_DELAY_MS = 200;

/**
 * 데드라인 가드 안전마진. 플랫폼 함수 타임아웃(maxDuration) 직전에 스스로
 * 멈추기 위한 여유분 — naver-prices/route.ts의 DEADLINE_SAFETY_MARGIN_MS와 동일 패턴.
 */
export const DEADLINE_SAFETY_MARGIN_MS = 30_000;

/** 배치 루프에서 항목 사이 페이싱에 쓰는 지연 헬퍼. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      title: String(detail.basis?.title ?? ''),
    };
  } catch (err) {
    // 도매꾹은 없는 상품에 dcode=ITEM_ERROR를 준다.
    // domeggook-client.getItemView는 `[도매꾹] 상품 ${itemNo} 상세 응답 오류: ${JSON.stringify(errors)}`
    // 형태로 던지므로, errors 객체 안의 dcode가 메시지 문자열에 그대로 직렬화되어 들어온다.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ITEM_ERROR')) return null;
    // cause로 원본 오류를 보존한다 — cron이 실패를 로깅할 때 스택이 끊기면 안 된다.
    throw new DomeTransientError(msg, { cause: err });
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
 * 검증 결과를 계산한다.
 *
 * 2026-07-31 변경: 네이버 쇼핑 검색 API가 종료돼 estimateCoupangPrice가 영구히
 * null을 반환한다(개발자센터 공지 32530. GET /v1/search/shop.json → 404 SE05,
 * 같은 키로 blog.json은 200이라 쇼핑 endpoint만 사라진 것이 확인됐다. 유예도
 * 대체 경로도 없다). 시세는 사용자가 직접 입력해 행에 저장되므로, 그 값을 인자로
 * 받아 판정한다. 이 함수는 이제 외부 호출이 전혀 없다.
 *
 * title 인자를 없앤 이유: 오직 estimateCoupangPrice(title)를 위해서만 쓰였다.
 * 그 호출이 사라지면서 인자가 완전히 죽었다.
 *
 * @param dome null이면 도매꾹에서 삭제된 상품
 * @param storedCoupangP25 행에 저장된 쿠팡 실판가. null이면 판정 불가(unknown)
 */
export async function buildVerifyResult(
  dome: DomeSnapshot | null,
  orderQty: number,
  logisticsSize: LogisticsSize,
  storedCoupangP25: number | null,
): Promise<VerifyResult> {
  // 삭제됨 — 쿠팡을 조회할 이유가 없다
  //
  // 아래 다섯 분기는 모두 VerifyResult의 16개 필드를 spread 없이 전부 나열한다.
  // spread(...empty, ...domeFields 등)로 합성하면 순서·오버라이드가 어긋나도
  // TypeScript가 필드 누락은 잡아도 "잘못된 값"은 못 잡는다 — 이 함수는 매입 여부를
  // 결정하므로 각 분기를 눈으로 통째로 감사할 수 있는 쪽을 택한다. 필드 순서는
  // VerifyResult 선언 순서(shortlist-db.ts)로 다섯 분기 모두 동일하게 유지한다 —
  // 그래야 나란히 놓고 비교된다.
  if (dome === null) {
    return {
      domeStatus: '삭제됨',
      domePrice: null,
      domeInventory: null,
      domeMoq: null,
      deliIsFree: null,
      deliType: null,
      deliUnitQty: null,
      deliFee: null,
      coupangP25: null,
      coupangSampleN: null,
      unitDeliFee: null,
      effectiveCost: null,
      breakEvenPrice: null,
      margin: null,
      marginRate: null,
      verdict: 'dead',
    };
  }

  // 판매중이 아니면 더 볼 것이 없다
  if (dome.status !== '판매중') {
    return {
      domeStatus: dome.status,
      domePrice: dome.price,
      domeInventory: dome.inventory,
      domeMoq: dome.moq,
      deliIsFree: null,
      deliType: null,
      deliUnitQty: null,
      deliFee: null,
      coupangP25: null,
      coupangSampleN: null,
      unitDeliFee: null,
      effectiveCost: null,
      breakEvenPrice: null,
      margin: null,
      marginRate: null,
      verdict: 'dead',
    };
  }

  const policy = parseDeliPolicy(dome.deli);

  // 무료 신호 없이 fee·tbl도 못 읽어 FREE로 접힌 경우 — 실제로는 "유료인데 금액 불명"일
  // 수 있다. 이걸 무료로 믿고 원가를 계산하면 과소산정된 원가로 pass가 나갈 수 있다.
  // 원가 과소산정은 "떨어뜨려야 할 후보를 통과시키는" 방향의 오류라 반대 방향(과대산정)보다
  // 비싸다고 판단해 dead와 동일하게 쿠팡 조회 전에 걸러 verdict='unknown'으로 보낸다.
  // (실제 응답 표본에서는 이 경로가 관측된 적이 없다 — deli-policy.ts 주석 참고. 그래도
  //  분기 자체는 몇 줄이고, 쿠팡 API 호출 하나를 아끼는 효과도 있어 넣어 둔다.)
  if (isUnconfirmedPaidDelivery(dome.deli, policy.isFree)) {
    return {
      domeStatus: dome.status,
      domePrice: dome.price,
      domeInventory: dome.inventory,
      domeMoq: dome.moq,
      deliIsFree: null,
      deliType: null,
      deliUnitQty: null,
      deliFee: null,
      coupangP25: null,
      coupangSampleN: null,
      unitDeliFee: null,
      effectiveCost: null,
      breakEvenPrice: null,
      margin: null,
      marginRate: null,
      verdict: 'unknown',
    };
  }

  const unitDeli = unitDeliveryFee(policy, orderQty);
  const effectiveCost = dome.price + unitDeli;
  const be = breakEvenPrice(effectiveCost, logisticsSize);

  // 시세 미입력 — 판정 불가. fail과 구분한다.
  // 원가·손익분기는 시세와 무관하게 계산되므로 여기서도 채운다.
  if (storedCoupangP25 === null) {
    return {
      domeStatus: dome.status,
      domePrice: dome.price,
      domeInventory: dome.inventory,
      domeMoq: dome.moq,
      deliIsFree: policy.isFree,
      deliType: policy.type,
      deliUnitQty: policy.unitQty,
      deliFee: policy.fee,
      coupangP25: null,
      coupangSampleN: null,
      unitDeliFee: unitDeli,
      effectiveCost,
      breakEvenPrice: be,
      margin: null,
      marginRate: null,
      verdict: 'unknown',
    };
  }

  const margin = marginOf(storedCoupangP25, effectiveCost, logisticsSize);

  return {
    domeStatus: dome.status,
    domePrice: dome.price,
    domeInventory: dome.inventory,
    domeMoq: dome.moq,
    deliIsFree: policy.isFree,
    deliType: policy.type,
    deliUnitQty: policy.unitQty,
    deliFee: policy.fee,
    coupangP25: storedCoupangP25,
    // 표본 개념이 사라졌다 — 사람이 쿠팡에서 눈으로 본 값 1건이라 표본 수가 없다.
    // 컬럼은 남기되 채우지 않는다.
    coupangSampleN: null,
    unitDeliFee: unitDeli,
    effectiveCost,
    breakEvenPrice: be,
    margin,
    marginRate: Math.round((margin / storedCoupangP25) * 1000) / 10,
    verdict: storedCoupangP25 >= be ? 'pass' : 'fail',
  };
}

/**
 * 1건을 검증하고 저장한다.
 * 도매꾹 일시 오류면 아무것도 저장하지 않고 false를 반환한다 —
 * verified_at을 갱신하지 않아야 다음 cron이 다시 시도한다.
 *
 * false는 실패가 아니라 "이번엔 건너뜀 — 다음 cron이 재시도"다.
 * 호출부에서 에러로 취급해 사용자에게 알리지 말 것.
 *
 * 인자를 객체로 받는 이유: itemNo와 orderQty가 둘 다 number라
 * 위치 인자로 두면 뒤바뀌어도 컴파일이 통과한다.
 */
export async function verifyOne(target: VerifyTarget): Promise<boolean> {
  // title은 더 이상 판정에 쓰이지 않는다(estimateCoupangPrice 제거).
  // VerifyTarget에는 남겨 둔다 — 호출부·로그가 상품을 식별하는 데 쓴다.
  const { itemNo, orderQty, logisticsSize } = target;

  let dome: DomeSnapshot | null;
  try {
    dome = await fetchDomeSnapshot(itemNo);
  } catch (err) {
    if (err instanceof DomeTransientError) return false;
    throw err;
  }

  // TODO(Task 2): target.coupangP25로 교체한다. listForVerify가 아직 저장된
  // 쿠팡가를 함께 읽어오지 않아 지금은 null만 넘긴다 — 네이버 API 종료 이후의
  // 실제 동작(항상 unknown)과 같으므로 이 단계에서 판정이 바뀌지는 않는다.
  const result = await buildVerifyResult(dome, orderQty, logisticsSize, null);
  await saveVerifyResult(itemNo, result);
  return true;
}
