import { describe, it, expect, vi } from 'vitest';
import wingFx from '@/__tests__/fixtures/orders/coupang-wing-ordersheets.json';
import rgFx from '@/__tests__/fixtures/orders/coupang-rg-orders.json';
import nvChangedFx from '@/__tests__/fixtures/orders/naver-last-changed.json';
import nvOrdersFx from '@/__tests__/fixtures/orders/naver-product-orders.json';
import nvPartialFx from '@/__tests__/fixtures/orders/naver-partial-claims.json';
import tossFx from '@/__tests__/fixtures/orders/toss-orders.json';
import { createWingAdapter, WING_STATUSES } from '@/lib/erp/orders/adapters/coupang-wing';
import { createRgAdapter } from '@/lib/erp/orders/adapters/coupang-rg';
import { createNaverAdapter, normalizeNaverItem, optionLabel } from '@/lib/erp/orders/adapters/naver';
import { createTossAdapter } from '@/lib/erp/orders/adapters/toss';
import type { NaverOrderRawItem } from '@/lib/listing/naver-commerce-client';
import { FAKE_PII, expectNoPII } from './_pii';

const W = { from: new Date('2026-09-26T11:07:04.989Z'), to: new Date('2026-09-27T03:00:00.000Z') };
const EMPTY = { items: [], nextToken: null };

describe('쿠팡 판매자배송 어댑터', () => {
  const pages = wingFx.pages as Record<string, unknown>;
  const getOrders = vi.fn(async (p: { createdAtFrom: string; createdAtTo: string; status?: string; nextToken?: string }) => (pages[`${p.status}|${p.nextToken ?? ''}`] ?? EMPTY) as never);
  const adapter = createWingAdapter({ getOrders });

  it('상태 6종을 날짜 구간으로 끝까지 넘기고 라인 키 = shipmentBoxId:vendorItemId', async () => {
    const r = await adapter.fetch(W);
    expect(getOrders.mock.calls.map((c) => [c[0].status, c[0].nextToken ?? ''])).toEqual([
      ['ACCEPT', ''], ['ACCEPT', 't2'], ...WING_STATUSES.slice(1).map((s) => [s, '']),
    ]);
    for (const [p] of getOrders.mock.calls) expect([p.createdAtFrom, p.createdAtTo]).toEqual(['2026-09-26', '2026-09-27']);
    expect(r.lines.map((l) => [l.externalLineId, l.status, l.qty, l.amount])).toEqual([
      ['6200000001:70000000001', 'paid', 2, 31800],
      ['6200000001:70000000002', 'canceled', 1, 9900],
      ['6200000002:70000000001', 'paid', 2, 31800],
      ['6200000003:70000000003', 'delivered', 1, 12000],
    ]);
    expect(r.lines[0]).toMatchObject({
      channel: 'coupang_wing', externalOrderId: '31000000001', productId: '70000000001', optionKey: '', altProductId: '16000000001',
      orderedAt: '2026-09-27T01:15:00.000Z', paidAt: '2026-09-27T01:15:30.000Z', rawStatus: 'ACCEPT', productLabel: '접이식 왜건 · 블랙', unitPrice: 15900,
    });
    // 결제 시각이 없으면 주문 시각(발주서는 결제완료부터 보인다)
    expect(r.lines[3].paidAt).toBe('2026-09-26T12:00:00.000Z');
    expect(r.lines[1].rawStatus).toBe('ACCEPT/CANCELED');
    // (I2) 첫날(구간 시작일)은 사라짐 판정에서 뺀다 — cover는 시작일 다음 날 KST 0시부터
    expect(r.cover).toEqual({ field: 'ordered_at', from: '2026-09-26T15:00:00.000Z', to: '2026-09-27T15:00:00.000Z' });
    expect(r.absenceMeansCancel).toBe(true);
    expect(r.rejected).toEqual([]);
    expectNoPII(r.lines);
  });

  it('페이지 조회가 실패하면 던진다(일부만 받은 결과를 돌려주지 않는다)', async () => {
    const bad = createWingAdapter({ getOrders: vi.fn(async () => { throw new Error('429'); }) });
    await expect(bad.fetch(W)).rejects.toThrow('429');
  });

  it('(I5) 수량·id가 잘못된 품목은 버리고 rejected(라인 키 + 이유, 구매자 정보 없음)로 보고한다 — 나머지는 그대로', async () => {
    const base = (wingFx.pages as Record<string, { items: Record<string, unknown>[] }>)['ACCEPT|'].items[0];
    const items = base.orderItems as Record<string, unknown>[];
    const order = { ...base, orderItems: [
      items[0],
      { ...items[0], vendorItemId: 70000000005, shippingCount: 1.5 },
      { ...items[0], vendorItemId: 'bad id!' },
    ] };
    const badTime = { ...base, shipmentBoxId: 6200000009, orderedAt: 'not-a-time', orderItems: [items[0]] };
    const g = vi.fn(async (p: { status?: string }) => (p.status === 'ACCEPT' ? { items: [order, badTime], nextToken: null } : EMPTY) as never);
    const r = await createWingAdapter({ getOrders: g }).fetch(W);
    expect(r.lines.map((l) => l.externalLineId)).toEqual(['6200000001:70000000001']);
    expect(r.rejected).toEqual([
      { lineKey: '6200000001:70000000005', reason: 'bad_qty' },
      { lineKey: '(읽을 수 없음)', reason: 'bad_id' },
      { lineKey: '6200000009:70000000001', reason: 'bad_time' },
    ]);
    for (const p of FAKE_PII) expect(JSON.stringify(r.rejected)).not.toContain(p);
  });
});

describe('쿠팡 RG 어댑터', () => {
  const pages = rgFx.pages as Record<string, unknown>;
  const getRocketGrowthOrders = vi.fn(async (p: { paidDateFrom: string; paidDateTo: string; nextToken?: string }) =>
    (pages[`${p.paidDateFrom}|${p.paidDateTo}|${p.nextToken ?? ''}`] ?? EMPTY) as never);
  const adapter = createRgAdapter({ getRocketGrowthOrders });

  it('끝 날짜 포함 — paidDateTo = 마지막 날 + 1(배타), 같은 vid 품목은 합치고 수량 0은 뺀다', async () => {
    const r = await adapter.fetch(W);
    expect(getRocketGrowthOrders.mock.calls.map((c) => [c[0].paidDateFrom, c[0].paidDateTo, c[0].nextToken ?? ''])).toEqual([
      ['2026-09-26', '2026-09-28', ''], ['2026-09-26', '2026-09-28', 'n2'],
    ]);
    expect(r.lines.map((l) => [l.externalLineId, l.qty, l.amount, l.paidAt])).toEqual([
      ['41000000001:80000000001', 2, 43800, '2026-09-27T01:00:00.000Z'],
      ['41000000002:80000000003', 3, 15000, '2026-09-27T02:30:00.000Z'],
    ]);
    expect(r.lines[0]).toMatchObject({ channel: 'coupang_rg', status: 'paid', rawStatus: 'PAID', productId: '80000000001', orderedAt: '2026-09-27T01:00:00.000Z' });
    // (I2) 첫날 제외
    expect(r.cover).toEqual({ field: 'paid_at', from: '2026-09-26T15:00:00.000Z', to: '2026-09-27T15:00:00.000Z' });
    expect(r.absenceMeansCancel).toBe(true);
    expect(r.rejected).toEqual([]);
    expectNoPII(r.lines);
  });

  it('(I5) 수량이 정수가 아닌 품목·읽을 수 없는 결제 시각은 버리고 보고한다', async () => {
    const f = vi.fn(async (_p: { paidDateFrom: string; paidDateTo: string; nextToken?: string }) => ({ items: [
      { orderId: '41000000005', paidAt: '1790470800000', orderItems: [
        { vendorItemId: 80000000001, productName: 'a', salesQuantity: 1, unitSalesPrice: 100, currency: 'KRW' },
        { vendorItemId: 80000000002, productName: 'b', salesQuantity: -2, unitSalesPrice: 100, currency: 'KRW' },
      ] },
      { orderId: '41000000006', paidAt: 'garbage', orderItems: [
        { vendorItemId: 80000000001, productName: 'a', salesQuantity: 1, unitSalesPrice: 100, currency: 'KRW' },
      ] },
    ], nextToken: null }) as never);
    const r = await createRgAdapter({ getRocketGrowthOrders: f }).fetch(W);
    expect(r.lines.map((l) => l.externalLineId)).toEqual(['41000000005:80000000001']);
    expect(r.rejected).toEqual([
      { lineKey: '41000000005:80000000002', reason: 'bad_qty' },
      { lineKey: '41000000006:80000000001', reason: 'bad_time' },
    ]);
  });

  it('30일이 넘는 구간은 29일(시작·끝 포함)씩 나눠 각 끝 날짜 + 1을 넘긴다', async () => {
    const f = vi.fn(async (_p: { paidDateFrom: string; paidDateTo: string; nextToken?: string }) => EMPTY as never);
    await createRgAdapter({ getRocketGrowthOrders: f }).fetch({ from: new Date('2026-10-01T00:00:00+09:00'), to: new Date('2026-11-05T12:00:00+09:00') });
    expect(f.mock.calls.map((c) => [c[0].paidDateFrom, c[0].paidDateTo])).toEqual([['2026-10-01', '2026-10-30'], ['2026-10-30', '2026-11-06']]);
  });
});

describe('네이버 어댑터', () => {
  const changed = nvChangedFx.pages as Record<string, { statuses: { productOrderId: string }[]; more: { moreFrom: string; moreSequence: string } | null }>;
  const getLastChangedStatuses = vi.fn(async (p: { from: string; to: string; moreSequence?: string }) => changed[p.moreSequence ?? '']);
  const queryProductOrders = vi.fn(async (ids: string[]) =>
    (nvOrdersFx.data as { productOrder: { productOrderId: string } }[]).filter((d) => ids.includes(d.productOrder.productOrderId)) as never);
  const adapter = createNaverAdapter({ getLastChangedStatuses, queryProductOrders }, { sleepMs: 0 });

  it('변경 조회를 more로 끝까지 넘기고(다음 페이지 시작 = moreFrom) 상세는 한 번에, 원상품번호·옵션 코드를 쓴다', async () => {
    const r = await adapter.fetch(W);
    expect(getLastChangedStatuses.mock.calls.map((c) => c[0])).toEqual([
      { from: '2026-09-26T20:07:04.989+09:00', to: '2026-09-27T12:00:00.000+09:00', moreSequence: undefined },
      { from: '2026-09-27T09:00:00.000+09:00', to: '2026-09-27T12:00:00.000+09:00', moreSequence: '0000000002' },
    ]);
    expect(queryProductOrders).toHaveBeenCalledWith(['2026092700000001', '2026092700000002', '2026092700000003']);
    expect(r.lines.map((l) => [l.externalLineId, l.status, l.productId, l.optionKey, l.altProductId, l.qty, l.amount])).toEqual([
      ['2026092700000001', 'paid', '8700000001', '12345', '8800000001', 2, 25800],
      ['2026092700000002', 'canceled', '8700000002', '', '8800000002', 1, 9900],
      ['2026092700000003', 'return_requested', '8700000003', '777', '8800000003', 1, 15000],
    ]);
    expect(r.lines[0]).toMatchObject({
      externalOrderId: '2026092712340001', orderedAt: '2026-09-27T00:05:00.000Z', paidAt: '2026-09-27T00:06:00.000Z',
      rawStatus: 'PAYED', productLabel: '쿨매트 · 블루 / S', unitPrice: 12900,
    });
    expect(r.lines[1].rawStatus).toBe('CANCELED/CANCEL_DONE');
    expect(r.cover).toBeNull();
    expect(r.absenceMeansCancel).toBe(false);
    expect(r.rejected).toEqual([]);
    expectNoPII(r.lines);
  });

  it('(I4) 부분 취소 — 수량 = remainQuantity, 금액 = 결제 금액 × 남은/처음 수량 · 남은 수량 0 = 취소', () => {
    const [partial, allGone] = (nvPartialFx.data as unknown as NaverOrderRawItem[]).map(normalizeNaverItem);
    expect([partial.qty, partial.amount, partial.unitPrice, partial.status]).toEqual([1, 10000, 10000, 'paid']);
    // 남은 수량 0: 상품주문 상태가 PAYED여도 취소. DB 수량 칸은 > 0이라 처음 수량을 남긴다(금액도 그대로 — 취소라 쓰이지 않는다)
    expect([allGone.qty, allGone.amount, allGone.status]).toEqual([2, 19800, 'canceled']);
    expectNoPII([partial, allGone]);
  });

  it('(M2) 입력형 옵션(「이름: 값」)·50자 넘는 옵션은 라벨에 남기지 않는다 — 선택형 옵션 이름은 남긴다', () => {
    const custom = normalizeNaverItem((nvPartialFx.data as unknown as NaverOrderRawItem[])[2]);
    expect(custom.productLabel).toBe('각인 텀블러 · (입력형 옵션 생략)');
    expect(custom.optionKey).toBe('900');
    expect(JSON.stringify(custom)).not.toContain('사랑해');
    expect(optionLabel('블루 / S')).toBe('블루 / S');
    expect(optionLabel('가'.repeat(51))).toBe('(입력형 옵션 생략)');
    expect(optionLabel(undefined)).toBeNull();
    expectNoPII([custom]);
  });

  it('(I5) 수량이 잘못된 상품주문은 버리고 보고한다(상세 조회 한 번이 채널 전체를 실패시키지 않는다)', async () => {
    const good = (nvOrdersFx.data as unknown as NaverOrderRawItem[])[0];
    const bad = { ...good, productOrder: { ...good.productOrder, productOrderId: '2026092700000099', quantity: 0 } };
    const r = await createNaverAdapter({
      getLastChangedStatuses: vi.fn(async () => ({ statuses: [{ productOrderId: '1' }], more: null })) as never,
      queryProductOrders: vi.fn(async () => [good, bad] as never),
    }, { sleepMs: 0 }).fetch(W);
    expect(r.lines).toHaveLength(1);
    expect(r.rejected).toEqual([{ lineKey: '2026092700000099', reason: 'bad_qty' }]);
  });

  it('변경 조회가 실패하면 던진다(옛 getOrders처럼 삼키지 않는다)', async () => {
    const bad = createNaverAdapter({ getLastChangedStatuses: vi.fn(async () => { throw new Error('[네이버 API] 500'); }), queryProductOrders }, { sleepMs: 0 });
    await expect(bad.fetch(W)).rejects.toThrow('500');
  });

  it('상세 조회는 300건씩 나눈다', async () => {
    const many = Array.from({ length: 301 }, (_, i) => ({ productOrderId: String(1000 + i) }));
    const q = vi.fn(async (_ids: string[]) => [] as never);
    await createNaverAdapter({ getLastChangedStatuses: vi.fn(async () => ({ statuses: many, more: null })), queryProductOrders: q }, { sleepMs: 0 }).fetch(W);
    expect(q.mock.calls.map((c) => c[0].length)).toEqual([300, 1]);
  });
});

describe('토스 어댑터', () => {
  const pages = tossFx.pages as Record<string, unknown>;
  const getOrdersPage = vi.fn(async (p: { startDate: string; endDate: string; nextCursor?: string }) => pages[p.nextCursor ?? ''] as never);
  const adapter = createTossAdapter({ getOrdersPage });

  it('nextCursor로 끝까지 넘기고 상품 ID·옵션명·재고 ID를 쓴다. 결제 상태면 주문 시각 = 결제 시각', async () => {
    const r = await adapter.fetch(W);
    expect(getOrdersPage.mock.calls.map((c) => [c[0].startDate, c[0].endDate, c[0].nextCursor ?? ''])).toEqual([
      ['2026-09-26', '2026-09-27', ''], ['2026-09-26', '2026-09-27', 'c2'],
    ]);
    expect(r.lines.map((l) => [l.externalLineId, l.status, l.productId, l.optionKey, l.altProductId, l.qty, l.unitPrice, l.amount, l.paidAt])).toEqual([
      ['9100000001', 'paid', '7700000001', '그레이 / 10매', '6600000001', 2, 12900, 25800, '2026-09-27T01:00:00.000Z'],
      ['9100000002', 'canceled', '7700000002', '블루 / S', '6600000002', 1, 12900, 12900, '2026-09-27T02:00:00.000Z'],
      ['9100000003', 'unpaid', '7700000001', '화이트 / 10매', '6600000003', 1, 12900, 12900, null],
    ]);
    expect(r.lines[0]).toMatchObject({ channel: 'toss', externalOrderId: '5100000001', orderedAt: '2026-09-27T01:00:00.000Z', productLabel: '극세사 타월 · 그레이 / 10매' });
    expect(r.absenceMeansCancel).toBe(false);
    expect(r.rejected).toEqual([]);
    expectNoPII(r.lines);
  });

  it('페이지 상한(200)을 넘으면 조용히 자르지 않고 던진다', async () => {
    const endless = vi.fn(async () => ({ results: [], nextCursor: 'again' }) as never);
    await expect(createTossAdapter({ getOrdersPage: endless }).fetch(W)).rejects.toThrow(/200페이지/);
  });

  it('(I5) 수량이 잘못된 주문상품은 버리고 보고한다', async () => {
    const first = ((tossFx.pages as Record<string, { results: Record<string, unknown>[] }>)[''].results)[0];
    const g = vi.fn(async () => ({ results: [first, { ...first, orderProductId: 9100000077, quantity: 'x' }], nextCursor: null }) as never);
    const r = await createTossAdapter({ getOrdersPage: g }).fetch(W);
    expect(r.lines).toHaveLength(1);
    expect(r.rejected).toEqual([{ lineKey: '9100000077', reason: 'bad_qty' }]);
  });

  it('꼬리일수는 30일이다(설계 해석 #23 — 주문일 기준 API라 배송 후 반품 완료가 7일을 넘겨 온다)', () => {
    expect(adapter.tailDays).toBe(30);
  });
});
