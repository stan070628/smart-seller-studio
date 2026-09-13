import { describe, it, expect } from 'vitest';
import { planLink, combineCoupang, type SyncLink } from '../plan';

describe('combineCoupang', () => {
  it('하나라도 팔 수 있으면 팔 수 있고 수량은 팔 수 있는 것의 합', () => {
    expect(combineCoupang([
      { amountInStock: 3, onSale: true }, { amountInStock: 9, onSale: false }, { amountInStock: 2, onSale: true },
    ])).toEqual({ onSale: true, amountInStock: 5 });
  });
  it('전부 판매 불가면 품절', () => {
    const s = combineCoupang([{ amountInStock: 0, onSale: true }, { amountInStock: 9, onSale: false }]);
    expect(s.onSale && s.amountInStock > 0).toBe(false);
  });
});

const link = (over: Partial<SyncLink> = {}): SyncLink => ({
  id: 1, coupangVendorItemId: 100, channel: 'naver', productId: 200, optionKey: '', label: 'x', zeroedAt: null, ...over,
});

describe('planLink', () => {
  it('쿠팡 재고 0이면 채널 재고를 0으로 내린다', () => {
    expect(planLink(link(), { amountInStock: 0, onSale: true }, 5)).toEqual({ kind: 'zero', from: 5 });
  });

  it('쿠팡 판매중지면 수량이 남아 있어도 0으로 내린다', () => {
    expect(planLink(link(), { amountInStock: 30, onSale: false }, 5)).toEqual({ kind: 'zero', from: 5 });
  });

  it('쿠팡이 판매 가능하면 채널 수량을 맞추지 않는다', () => {
    expect(planLink(link(), { amountInStock: 3, onSale: true }, 10)).toEqual({ kind: 'none' });
  });

  it('이미 0인 채널 옵션은 건드리지 않고 표시도 남기지 않는다', () => {
    expect(planLink(link(), { amountInStock: 0, onSale: true }, 0)).toEqual({ kind: 'none' });
  });

  it('동기화가 내린 옵션은 쿠팡이 다시 판매 가능해지면 쿠팡 수량으로 되살린다', () => {
    const l = link({ zeroedAt: new Date() });
    expect(planLink(l, { amountInStock: 7, onSale: true }, 0)).toEqual({ kind: 'restore', to: 7 });
  });

  it('사용자가 직접 내린 옵션(표시 없음)은 되살리지 않는다', () => {
    expect(planLink(link(), { amountInStock: 7, onSale: true }, 0)).toEqual({ kind: 'none' });
  });

  it('동기화가 내렸는데 채널에서 이미 누가 되살렸으면 표시만 지운다', () => {
    const l = link({ zeroedAt: new Date() });
    expect(planLink(l, { amountInStock: 7, onSale: true }, 4)).toEqual({ kind: 'clear' });
  });

  it('쿠팡 판매 불가가 이어지는 동안 표시를 유지한다', () => {
    const l = link({ zeroedAt: new Date() });
    expect(planLink(l, { amountInStock: 0, onSale: false }, 0)).toEqual({ kind: 'none' });
  });

  it('채널에서 옵션을 못 찾으면 missing', () => {
    expect(planLink(link(), { amountInStock: 0, onSale: true }, null)).toEqual({ kind: 'missing' });
  });
});
