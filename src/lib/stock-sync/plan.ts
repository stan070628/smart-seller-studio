/**
 * 쿠팡 → 네이버·토스 품절 동기화의 판정 규칙 (docs/superpowers/plans/2026-09-13-stock-sync.md).
 *
 * 수량을 맞추는 동기화가 아니다. 사용자는 코스트코에서 더 사 오므로 수량은 엄밀하지 않고,
 * 막아야 하는 것은 **쿠팡에서 못 파는 옵션이 다른 채널에서 팔리는 것** 하나다.
 */

export type Channel = 'naver' | 'toss';

export interface SyncLink {
  id: number;
  coupangVendorItemId: number;
  channel: Channel;
  /** 네이버 originProductNo / 토스 productId */
  productId: number;
  /** 네이버 optionCombination id('' = 단일상품) / 토스 옵션 valueName을 ' / '로 이은 값 */
  optionKey: string;
  label: string | null;
  /** 동기화가 0으로 내린 시각. 값이 있을 때만 복구 대상이다 */
  zeroedAt: Date | null;
}

export interface CoupangState {
  amountInStock: number;
  onSale: boolean;
}

export type Plan =
  | { kind: 'none' }
  | { kind: 'zero'; from: number }
  | { kind: 'restore'; to: number }
  | { kind: 'clear' }
  | { kind: 'missing' };

/**
 * 채널 옵션 하나에 붙은 쿠팡 옵션 여럿을 하나의 상태로 합친다.
 * 하나라도 팔 수 있으면 팔 수 있고, 되살릴 수량은 팔 수 있는 옵션 수량의 합이다.
 */
export function combineCoupang(states: CoupangState[]): CoupangState {
  const sellable = states.filter(isCoupangSellable);
  return { onSale: sellable.length > 0, amountInStock: sellable.reduce((n, s) => n + s.amountInStock, 0) };
}

/** 판매중지도 품절로 본다 — Wing 앱에서 품절을 판매중지로 처리하기도 한다 */
export function isCoupangSellable(s: CoupangState): boolean {
  return s.onSale && s.amountInStock > 0;
}

/**
 * @param channelStock 채널 옵션의 현재 재고. 옵션을 못 찾았으면 null
 */
export function planLink(link: SyncLink, coupang: CoupangState, channelStock: number | null): Plan {
  if (channelStock === null) return { kind: 'missing' };

  if (!isCoupangSellable(coupang)) {
    return channelStock > 0 ? { kind: 'zero', from: channelStock } : { kind: 'none' };
  }

  // 사용자가 직접 내린 옵션은 되살리지 않는다 — 판매중지 의도를 덮어쓰게 된다
  if (!link.zeroedAt) return { kind: 'none' };
  return channelStock === 0 ? { kind: 'restore', to: coupang.amountInStock } : { kind: 'clear' };
}
