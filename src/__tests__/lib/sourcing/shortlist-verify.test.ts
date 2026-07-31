import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/sourcing/coupang-price', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sourcing/coupang-price')>();
  return { ...actual, estimateCoupangPrice: vi.fn() };
});

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
import { estimateCoupangPrice } from '@/lib/sourcing/coupang-price';
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

  it('판매중이고 쿠팡가가 손익분기를 넘으면 pass', async () => {
    vi.mocked(estimateCoupangPrice).mockResolvedValue({ p25: 9900, sampleN: 90 });

    const r = await buildVerifyResult('메쉬 반장갑', DOME_ALIVE, 10, 'xsmall');

    expect(r.verdict).toBe('pass');
    expect(r.unitDeliFee).toBe(300);       // 30개당 3000원을 10개 주문 → 개당 300
    expect(r.effectiveCost).toBe(3600);    // 3300 + 300
    expect(r.breakEvenPrice).toBe(9471); // 2026-07-31 VAT 반영
    expect(r.margin).toBe(3226); // 2026-07-31 VAT 반영
  });

  it('쿠팡가가 손익분기에 미달하면 fail', async () => {
    vi.mocked(estimateCoupangPrice).mockResolvedValue({ p25: 5080, sampleN: 8 });

    const r = await buildVerifyResult(
      '접이식 쓰레기통',
      { ...DOME_ALIVE, price: 2530, deli: { pay: '선결제', dome: { type: '고정배송비', fee: '3000' } } },
      10,
      'xsmall',
    );

    expect(r.verdict).toBe('fail');
    expect(r.effectiveCost).toBe(2830);
    expect(r.margin).toBeLessThan(0);
  });

  it('도매꾹에 상품이 없으면 dead — 쿠팡 조회를 하지 않는다', async () => {
    const r = await buildVerifyResult('사라진 상품', null, 10, 'xsmall');

    expect(r.verdict).toBe('dead');
    expect(r.domeStatus).toBe('삭제됨');
    expect(estimateCoupangPrice).not.toHaveBeenCalled();
  });

  it('판매종료면 dead', async () => {
    const r = await buildVerifyResult(
      '판매종료 상품',
      { ...DOME_ALIVE, status: '판매종료' },
      10,
      'xsmall',
    );
    expect(r.verdict).toBe('dead');
  });

  it('쿠팡 표본이 부족하면 unknown — fail로 뭉치지 않는다', async () => {
    vi.mocked(estimateCoupangPrice).mockResolvedValue(null);

    const r = await buildVerifyResult('희귀 상품', DOME_ALIVE, 10, 'xsmall');

    expect(r.verdict).toBe('unknown');
    expect(r.coupangP25).toBeNull();
    // 원가 계산은 되어 있어야 한다
    expect(r.effectiveCost).toBe(3600);
    expect(r.breakEvenPrice).toBe(9471); // 2026-07-31 VAT 반영
  });

  it('사입 수량을 늘리면 개당 배송비가 줄어든다', async () => {
    vi.mocked(estimateCoupangPrice).mockResolvedValue({ p25: 9900, sampleN: 90 });

    const r = await buildVerifyResult('메쉬 반장갑', DOME_ALIVE, 30, 'xsmall');

    expect(r.unitDeliFee).toBe(100);
    expect(r.effectiveCost).toBe(3400);
  });

  // Step 3: 무료 신호도 없는데 fee·tbl도 못 읽어 parseDeliPolicy가 FREE로 접는 경로.
  // 실제 배송비는 유료인데 확인이 안 되는 것이므로, 이걸 진짜 무료로 믿고 pass/fail을
  // 내리면 원가가 과소산정된 채로 판정이 나간다. dead와 같은 방식(coupang 호출 전에
  // 걸러서 verdict='unknown')으로 처리한다 — 상세 근거는 shortlist-verify.ts 주석 참고.
  it('배송비 확인 불가(무료 신호 없이 fee·tbl만 못 읽음)면 unknown — 쿠팡 조회를 하지 않는다', async () => {
    const r = await buildVerifyResult(
      '배송비 불명 상품',
      { ...DOME_ALIVE, deli: { pay: '선결제', dome: {} } }, // pay가 '무료'가 아닌데 fee·tbl이 없음
      10,
      'xsmall',
    );

    expect(r.verdict).toBe('unknown');
    expect(r.effectiveCost).toBeNull();
    expect(estimateCoupangPrice).not.toHaveBeenCalled();
  });

  it('배송비 정보 자체가 없는 경우(deli 필드 부재)는 확인 불가와 다르게 취급해 정상 진행한다', async () => {
    vi.mocked(estimateCoupangPrice).mockResolvedValue({ p25: 9900, sampleN: 90 });

    const r = await buildVerifyResult('메쉬 반장갑', { ...DOME_ALIVE, deli: undefined }, 10, 'xsmall');

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
      itemNo: 123, title: '테스트', orderQty: 10, logisticsSize: 'xsmall',
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
      itemNo: 123, title: '사라진 상품', orderQty: 10, logisticsSize: 'xsmall',
    });

    expect(ok).toBe(true);
    expect(saveVerifyResult).toHaveBeenCalledWith(123, expect.objectContaining({ verdict: 'dead' }));
  });
});
