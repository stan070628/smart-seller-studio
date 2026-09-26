import { describe, it, expect } from 'vitest';
import { DEFAULT_QUEUE_N, kstDate, pickCountQueue } from '@/lib/erp/stock/count-queue';

const TODAY = '2026-09-27';
const r = (skuId: number, selfValue: number, hasLedger = true) => ({ skuId, selfValue, hasLedger });
const ids = (xs: { skuId: number }[]) => xs.map((x) => x.skuId);

describe('kstDate', () => {
  it('ISO를 KST 날짜로', () => {
    expect(kstDate('2026-09-26T15:00:00Z')).toBe('2026-09-27');
    expect(kstDate('2026-09-26T14:59:59Z')).toBe('2026-09-26');
    expect(kstDate(new Date('2026-09-27T00:00:00+09:00'))).toBe('2026-09-27');
  });
});

describe('pickCountQueue', () => {
  it('한 번도 안 센 SKU — 집 재고 금액 큰 순', () => {
    expect(ids(pickCountQueue([r(1, 100), r(2, 900), r(3, 500)], new Map(), { today: TODAY }))).toEqual([2, 3, 1]);
  });

  it('센 적이 있으면 마지막 실사가 오래된 순, 같으면 금액 큰 순', () => {
    const counts = new Map([[1, '2026-09-20T01:00:00Z'], [2, '2026-09-25T01:00:00Z'], [3, '2026-09-20T01:00:00Z']]);
    expect(ids(pickCountQueue([r(1, 100), r(2, 900), r(3, 500)], counts, { today: TODAY }))).toEqual([3, 1, 2]);
  });

  it('안 센 SKU가 센 SKU보다 앞선다(금액과 무관)', () => {
    expect(ids(pickCountQueue([r(1, 5000), r(2, 10)], new Map([[1, '2026-09-01T00:00:00Z']]), { today: TODAY }))).toEqual([2, 1]);
  });

  it('오늘(KST) 센 SKU는 빠진다 — 날짜 경계는 KST', () => {
    const counts = new Map([
      [1, '2026-09-26T15:00:00Z'], // 27일 00:00 KST — 오늘
      [2, '2026-09-26T14:59:59Z'], // 26일 23:59 KST — 어제
    ]);
    expect(ids(pickCountQueue([r(1, 100), r(2, 100)], counts, { today: TODAY }))).toEqual([2]);
  });

  it('원장 전표가 하나도 없는 SKU는 빠진다(재고 0이고 전표도 없다 = 판매하지 않는 옵션)', () => {
    expect(ids(pickCountQueue([r(1, 0, false), r(2, 0, true)], new Map(), { today: TODAY }))).toEqual([2]);
  });

  it('N개까지(기본 8) · 금액이 같으면 SKU id 순(순서가 흔들리지 않게)', () => {
    const rows = Array.from({ length: 10 }, (_, i) => r(10 - i, 100));
    expect(DEFAULT_QUEUE_N).toBe(8);
    expect(ids(pickCountQueue(rows, new Map(), { today: TODAY }))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(pickCountQueue(rows, new Map(), { n: 3, today: TODAY })).toHaveLength(3);
  });
});
