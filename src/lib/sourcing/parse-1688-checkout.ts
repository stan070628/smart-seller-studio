/**
 * 1688 결제 확인 화면 붙여넣기 파서.
 *
 * 왜 결제 확인 화면인가 (2026-08-01 실측 비교):
 *   장바구니   — 주문 단위 할인이 품목별로 분배돼 품목을 체크하면 개당가가 바뀐다(3.50 → 4.00).
 *   주문 내역  — 결제 후에만 보여 살지 말지 판단에 못 쓴다.
 *   결제 확인  — 값이 확정되고 아직 안 샀으며 원화까지 있다. 이 화면만 셋을 다 만족한다.
 *
 * 왜 정규식을 원문에 바로 걸지 않는가:
 *   1688은 금액의 정수부와 소수부를 다른 span으로 렌더링한다. 복사하면 이렇게 나온다.
 *     合计
 *     ¥
 *     3
 *     .80
 *   `[¥￥]\s*([\d.]+)` 같은 정규식은 `\s*`가 개행을 먹어 `3`만 잡고 `.80`을 버린다.
 *   `\s`를 막으면 `¥ 2`처럼 공백이 낀 정상 케이스가 깨진다. 양립하지 않는다.
 *
 *   그래서 `价格明细`부터 첫 `₩금액`까지 슬라이스한 뒤 공백을 전부 지우고 파싱한다.
 *   이 한 수가 네 문제를 동시에 없앤다.
 *     - 숫자 분할
 *     - `商品总计`가 `店铺明细`에도 있는 중복 라벨 (판매자가 몇이든 `价格明细`는 하나다)
 *     - 하단 `立即下单`의 금액·원화 재출현
 *     - `配送方式 快递 ¥ 3.5` 같은 앞쪽 잡음
 */

export interface Parsed1688 {
  ok: boolean;
  /** ok가 false일 때 사람에게 보여줄 사유 */
  error: string | null;

  /** 合计 — 실제 결제 금액(위안) */
  totalCny: number | null;
  /** 合计의 원화 환산 */
  totalKrw: number | null;
  /** 商品总计 — 쿠폰 차감 전 상품 합계 */
  goodsCny: number | null;
  /** 总运费 — 중국 내 배송비 */
  freightCny: number | null;
  /** 店铺优惠 — 판매자 쿠폰. 라벨이 없거나 금액이 아니면(包邮 등) null */
  discountCny: number | null;
  /** 已减 — 플랫폼이 이미 차감했다고 표시하는 금액. 표시용이며 검산에 쓰지 않는다 */
  alreadyReducedCny: number | null;
  /** 商品总计 N种 M件 의 M */
  qty: number | null;

  /** ₩合计 ÷ ¥合计. 그 주문에 실제 적용된 환율 */
  exchangeRate: number | null;
  /** ₩合计 ÷ 총 수량 */
  unitKrw: number | null;
}

/** 검산 허용 오차 — 표시가 소수 2자리라 반올림 잔차만 허용한다 */
const EPSILON = 0.02;

function fail(reason: string): Parsed1688 {
  return {
    ok: false, error: reason,
    totalCny: null, totalKrw: null, goodsCny: null, freightCny: null,
    discountCny: null, alreadyReducedCny: null, qty: null,
    exchangeRate: null, unitKrw: null,
  };
}

function num(block: string, pattern: RegExp): number | null {
  const m = block.match(pattern);
  if (!m) return null;
  const n = Number.parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function parse1688Checkout(text: string): Parsed1688 {
  if (!text || !text.trim()) return fail('붙여넣은 내용이 없습니다.');

  const start = text.indexOf('价格明细');
  if (start < 0) {
    return fail('가격 명세(价格明细)를 찾지 못했습니다. 장바구니가 아니라 결제 확인 화면 전체를 긁어와 주세요.');
  }

  const tail = text.slice(start);
  const krw = tail.match(/₩\s*[\d,]+/);
  if (!krw) {
    return fail('원화 환산 금액을 찾지 못했습니다. 결제 확인 화면 전체를 긁어와 주세요.');
  }

  // 价格明细 ~ 첫 ₩금액. 공백을 전부 지워 정수부/소수부 분할을 해소한다
  const block = tail.slice(0, krw.index! + krw[0].length).replace(/\s+/g, '');

  const qtyMatch = block.match(/商品总计(\d+)种(\d+)件/);
  const qty = qtyMatch ? Number.parseInt(qtyMatch[2], 10) : null;

  const alreadyReducedCny = num(block, /已减[¥￥]([\d,.]+)/);
  // 已减가 商品总计와 상품총계 사이에 끼어들 수 있다. optional 그룹으로 건너뛴다
  const goodsCny = num(block, /商品总计\d+种\d+件(?:已减[¥￥][\d,.]+)?[¥￥]([\d,.]+)/);
  const freightCny = num(block, /总运费[¥￥]([\d,.]+)/);
  const discountCny = num(block, /店铺优惠减[¥￥]([\d,.]+)/);
  const totalCny = num(block, /合计[¥￥]([\d,.]+)/);
  const totalKrw = num(block, /₩([\d,]+)/);

  if (totalCny === null || totalCny <= 0) {
    return fail('합계(合计)를 읽지 못했습니다. 가격 명세 영역까지 포함해 다시 긁어와 주세요.');
  }
  if (totalKrw === null) {
    return fail('원화 금액을 읽지 못했습니다.');
  }
  if (qty === null || qty <= 0) {
    return fail('수량(商品总计 N种N件)을 읽지 못했습니다.');
  }
  if (goodsCny === null || freightCny === null) {
    return fail('상품총계 또는 총운임을 읽지 못했습니다. 가격 명세 영역이 잘렸는지 확인해 주세요.');
  }

  // 店铺优惠 라벨이 없거나(할인 없음) 금액이 아닌 값이면(包邮 등) 0으로 둔다.
  // 잘못 읽었다면 바로 아래 검산이 잡는다
  const discount = discountCny ?? 0;
  if (Math.abs(goodsCny - discount + freightCny - totalCny) >= EPSILON) {
    return fail(
      `검산이 맞지 않습니다 (상품 ${goodsCny} − 할인 ${discount} + 운임 ${freightCny} ≠ 합계 ${totalCny}). ` +
        '가격 명세 영역이 온전히 복사됐는지 확인해 주세요.',
    );
  }

  return {
    ok: true, error: null,
    totalCny, totalKrw, goodsCny, freightCny, discountCny, alreadyReducedCny, qty,
    exchangeRate: totalKrw / totalCny,
    unitKrw: Math.round(totalKrw / qty),
  };
}
