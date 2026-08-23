import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// coupang-price mock이 없는 이유: 네이버 쇼핑 검색 API 종료(2026-07-31)로
// buildVerifyResult가 estimateCoupangPrice를 더 이상 부르지 않는다. 쿠팡
// 실판가는 네 번째 인자로 직접 넘긴다. 이 파일에 남은 breakEvenPrice·marginOf는
// 순수 함수라 mock할 이유가 없다.
vi.mock('@/lib/sourcing/domeggook-client', () => ({
  getDomeggookClient: vi.fn(),
}));

vi.mock('@/lib/sourcing/shortlist-db', () => ({
  saveVerifyResult: vi.fn(),
}));

import {
  buildVerifyResult,
  fetchDomeSnapshot,
  verifyOne,
  DomeTransientError,
} from '@/lib/sourcing/shortlist-verify';
import { getDomeggookClient } from '@/lib/sourcing/domeggook-client';
import { saveVerifyResult } from '@/lib/sourcing/shortlist-db';

const DOME_ALIVE = {
  status: '판매중',
  price: 3300,
  inventory: 1186,
  moq: 2,
  deli: { pay: '선결제', dome: { type: '수량별비례', tbl: '30+3000|30+3000' } },
};

describe('buildVerifyResult', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  // 손익분기가 1만원 하한보다 **낮아지는** 저원가 스냅샷.
  // 하한이 손익분기보다 먼저 판정되는지 보려면 두 값이 하한을 사이에 두고 갈려야 하는데,
  // 2026-08-13 실청구 물류비 반영으로 DOME_ALIVE(도매가 3,300)의 손익분기가
  // 13,046원까지 올라 하한 위로 넘어가 버렸다. 그래서 도매가를 낮춘 별도 스냅샷을 쓴다.
  const DOME_CHEAP = { ...DOME_ALIVE, price: 700 };

  it('판매중이고 쿠팡가가 손익분기를 넘으면 pass', async () => {
    // 10,500원이었으나 물류비 실측 반영으로 손익분기가 13,046원이 되어 미달이 된다.
    // 손익분기 통과 경로를 검증하는 케이스라 그 위 값으로 올린다.
    const r = await buildVerifyResult(DOME_ALIVE, 10, 'xsmall', 14000);

    expect(r.verdict).toBe('pass');
    expect(r.unitDeliFee).toBe(300);       // 30개당 3000원을 10개 주문 → 개당 300
    expect(r.effectiveCost).toBe(3600);    // 3300 + 300
    expect(r.breakEvenPrice).toBe(13046);  // 2026-08-13 실청구 물류비 + 매출세액 반영
    expect(r.margin).toBe(5447);
  });

  it('손익분기는 넘어도 1만원 하한 미만이면 fail — 하한이 손익분기보다 먼저다', async () => {
    // 손익분기 9,813원 < 9,900원이므로 손익분기 기준으로는 통과다.
    // 그래도 1만원 미만 가격대는 아예 진입하지 않기로 한 정책이라 fail이다.
    const r = await buildVerifyResult(DOME_CHEAP, 30, 'xsmall', 9900);

    expect(r.verdict).toBe('fail');
    // 하한 미달이어도 원가·손익분기·마진은 그대로 채운다 — 화면이 근거를 보여줘야 한다
    expect(r.coupangP25).toBe(9900);
    expect(r.breakEvenPrice).toBe(9813);
    expect(r.breakEvenPrice).toBeLessThan(9900);
  });

  it('정확히 1만원이면 하한을 통과한다 (경계값)', async () => {
    // 하한은 "1만원 미만"이 fail이다. 1만원 자체는 진입 가능 구간이다.
    const r = await buildVerifyResult(DOME_CHEAP, 30, 'xsmall', 10000);
    expect(r.verdict).toBe('pass');
  });

  it('쿠팡가가 손익분기에 미달하면 fail', async () => {
    const r = await buildVerifyResult(
      { ...DOME_ALIVE, price: 2530, deli: { pay: '선결제', dome: { type: '고정배송비', fee: '3000' } } },
      10,
      'xsmall',
      5080,
    );

    expect(r.verdict).toBe('fail');
    expect(r.effectiveCost).toBe(2830);
    expect(r.margin).toBeLessThan(0);
  });

  it('도매꾹에 상품이 없으면 dead — 저장된 쿠팡가가 있어도 무시한다', async () => {
    const r = await buildVerifyResult(null, 10, 'xsmall', 9900);

    expect(r.verdict).toBe('dead');
    expect(r.domeStatus).toBe('삭제됨');
    // 죽은 상품에 시세를 남기면 화면에서 살아 있는 후보처럼 보인다
    expect(r.coupangP25).toBeNull();
  });

  it('판매종료면 dead', async () => {
    const r = await buildVerifyResult(
      { ...DOME_ALIVE, status: '판매종료' },
      10,
      'xsmall',
      9900,
    );
    expect(r.verdict).toBe('dead');
  });

  it('쿠팡 실판가가 미입력이면 unknown — fail로 뭉치지 않는다', async () => {
    const r = await buildVerifyResult(DOME_ALIVE, 10, 'xsmall', null);

    expect(r.verdict).toBe('unknown');
    expect(r.coupangP25).toBeNull();
    // 원가 계산은 되어 있어야 한다
    expect(r.effectiveCost).toBe(3600);
    expect(r.breakEvenPrice).toBe(13046); // 2026-08-13 실청구 물류비 + 매출세액 반영
  });

  it('사입 수량을 늘리면 개당 배송비가 줄어든다', async () => {
    const r = await buildVerifyResult(DOME_ALIVE, 30, 'xsmall', 9900);

    expect(r.unitDeliFee).toBe(100);
    expect(r.effectiveCost).toBe(3400);
  });

  // Step 3: 무료 신호도 없는데 fee·tbl도 못 읽어 parseDeliPolicy가 FREE로 접는 경로.
  // 실제 배송비는 유료인데 확인이 안 되는 것이므로, 이걸 진짜 무료로 믿고 pass/fail을
  // 내리면 원가가 과소산정된 채로 판정이 나간다. dead와 같은 방식(coupang 호출 전에
  // 걸러서 verdict='unknown')으로 처리한다 — 상세 근거는 shortlist-verify.ts 주석 참고.
  it('배송비 확인 불가(무료 신호 없이 fee·tbl만 못 읽음)면 unknown — 저장된 쿠팡가가 있어도 판정하지 않는다', async () => {
    const r = await buildVerifyResult(
      { ...DOME_ALIVE, deli: { pay: '선결제', dome: {} } }, // pay가 '무료'가 아닌데 fee·tbl이 없음
      10,
      'xsmall',
      9900,
    );

    expect(r.verdict).toBe('unknown');
    expect(r.effectiveCost).toBeNull();
    // 원가를 모르는 채로 시세만 남기면 판정 근거가 없는 값이 화면에 뜬다
    expect(r.coupangP25).toBeNull();
  });

  it('배송비 정보 자체가 없는 경우(deli 필드 부재)는 확인 불가와 다르게 취급해 정상 진행한다', async () => {
    // 원가 3,300원(배송비 0)의 손익분기는 12,700원이므로 그 위 값을 쓴다.
    const r = await buildVerifyResult({ ...DOME_ALIVE, deli: undefined }, 10, 'xsmall', 13000);

    // deli 정보가 아예 없는 경우는 parseDeliPolicy가 기존에도 FREE로 처리해 왔다.
    // 이 테스트는 새 판정 로직이 이 기존 동작을 건드리지 않는다는 것을 고정한다.
    expect(r.verdict).toBe('pass');
    expect(r.unitDeliFee).toBe(0);
    expect(r.effectiveCost).toBe(3300);
  });
});

describe('fetchDomeSnapshot — 일시 오류와 삭제 구분', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ITEM_ERROR 메시지면 삭제로 보고 null을 반환한다', async () => {
    // domeggook-client가 errors 객체를 JSON.stringify해 메시지에 담는다
    vi.mocked(getDomeggookClient).mockReturnValue({
      getItemView: vi.fn().mockRejectedValue(
        new Error('[도매꾹] 상품 123 상세 응답 오류: {"code":"40","dcode":"ITEM_ERROR"}'),
      ),
    } as never);

    expect(await fetchDomeSnapshot(123)).toBeNull();
  });

  it('그 밖의 오류는 DomeTransientError로 던진다 — 삭제로 오판하면 안 된다', async () => {
    vi.mocked(getDomeggookClient).mockReturnValue({
      getItemView: vi.fn().mockRejectedValue(new Error('network timeout')),
    } as never);

    await expect(fetchDomeSnapshot(123)).rejects.toBeInstanceOf(DomeTransientError);
  });

  it('HTTP 오류도 DomeTransientError다', async () => {
    vi.mocked(getDomeggookClient).mockReturnValue({
      getItemView: vi.fn().mockRejectedValue(
        new Error('[도매꾹] 상품 123 상세 조회 실패: 503 Service Unavailable'),
      ),
    } as never);

    await expect(fetchDomeSnapshot(123)).rejects.toBeInstanceOf(DomeTransientError);
  });
});

describe('verifyOne — 일시 오류일 때 저장하지 않는다', () => {
  beforeEach(() => vi.clearAllMocks());

  it('일시 오류면 false를 반환하고 아무것도 저장하지 않는다', async () => {
    // 저장하면 verified_at이 갱신되어 다음 cron이 재시도하지 않는다
    vi.mocked(getDomeggookClient).mockReturnValue({
      getItemView: vi.fn().mockRejectedValue(new Error('network timeout')),
    } as never);

    const ok = await verifyOne({
      itemNo: 123, title: '테스트', orderQty: 10, logisticsSize: 'xsmall', coupangP25: null,
    });

    expect(ok).toBe(false);
    expect(saveVerifyResult).not.toHaveBeenCalled();
  });

  it('삭제된 상품이면 dead로 저장하고 true를 반환한다', async () => {
    vi.mocked(getDomeggookClient).mockReturnValue({
      getItemView: vi.fn().mockRejectedValue(
        new Error('[도매꾹] 상품 123 상세 응답 오류: {"dcode":"ITEM_ERROR"}'),
      ),
    } as never);

    const ok = await verifyOne({
      itemNo: 123, title: '사라진 상품', orderQty: 10, logisticsSize: 'xsmall', coupangP25: 9900,
    });

    expect(ok).toBe(true);
    expect(saveVerifyResult).toHaveBeenCalledWith(123, expect.objectContaining({ verdict: 'dead' }));
  });
});

describe('verifyOne — target.coupangP25가 buildVerifyResult까지 전달된다 (round trip)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('저장된 쿠팡가를 그대로 결과에 담아 저장한다', async () => {
    // DOME_ALIVE와 같은 조합(가격 3300원, 30개당 3000원 배송)이다. 위
    // 'buildVerifyResult' describe의 첫 테스트에서 이 조합의 손익분기가
    // 13,046원으로 이미 검증돼 있다. 14000 >= 13046이므로 손으로 계산해도 pass다.
    vi.mocked(getDomeggookClient).mockReturnValue({
      getItemView: vi.fn().mockResolvedValue({
        basis: { status: '판매중', title: '테스트 상품' },
        price: { dome: 3300 },
        qty: { inventory: 1186, domeMoq: 2 },
        deli: { pay: '선결제', dome: { type: '수량별비례', tbl: '30+3000|30+3000' } },
      }),
    } as never);

    const ok = await verifyOne({
      itemNo: 999,
      title: '테스트 상품',
      orderQty: 10,
      logisticsSize: 'xsmall',
      coupangP25: 14000,
    });

    expect(ok).toBe(true);
    // verifyOne이 target.coupangP25 대신 null을 넘기도록 되돌아가면 coupangP25는
    // null, verdict는 'unknown'으로 저장되어 이 단언이 실패한다 — 그것이 이
    // 테스트가 지키려는 회귀다(야간 cron이 사용자가 입력한 시세를 지우는 버그).
    expect(saveVerifyResult).toHaveBeenCalledWith(
      999,
      expect.objectContaining({ coupangP25: 14000, verdict: 'pass' }),
    );
  });
});
