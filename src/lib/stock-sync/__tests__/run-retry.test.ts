import { describe, it, expect, vi } from 'vitest';
import { getInventoryWithRetry, isTransientCoupangError } from '../run';

const ok = { amountInStock: 3, onSale: true };
const err504 = new Error('쿠팡 API 오류 (504): Gateway Timeout');
const err400 = new Error('쿠팡 API 오류 (400): BAD_REQUEST: 잘못된 옵션');

function client(...results: Array<Error | Record<string, unknown>>) {
  const fn = vi.fn();
  for (const r of results) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r);
    else fn.mockResolvedValueOnce(r);
  }
  return { getVendorItemInventory: fn };
}

describe('isTransientCoupangError', () => {
  it('5xx·타임아웃·연결 끊김은 다시 묻는다', () => {
    expect(isTransientCoupangError(err504)).toBe(true);
    expect(isTransientCoupangError(new Error('쿠팡 API 오류 (502): Bad Gateway'))).toBe(true);
    expect(isTransientCoupangError(Object.assign(new Error('t'), { name: 'TimeoutError' }))).toBe(true);
    expect(isTransientCoupangError(new TypeError('fetch failed'))).toBe(true);
  });

  it('4xx와 응답 형식 오류는 다시 묻지 않는다', () => {
    expect(isTransientCoupangError(err400)).toBe(false);
    expect(isTransientCoupangError(new Error('응답에 amountInStock/onSale 없음'))).toBe(false);
  });
});

describe('getInventoryWithRetry', () => {
  it('504 뒤 성공하면 값을 돌려준다', async () => {
    const cp = client(err504, ok);
    await expect(getInventoryWithRetry(cp, 1, [0, 0])).resolves.toEqual(ok);
    expect(cp.getVendorItemInventory).toHaveBeenCalledTimes(2);
  });

  it('재시도를 다 쓰면 마지막 오류를 던진다', async () => {
    const cp = client(err504, err504, err504);
    await expect(getInventoryWithRetry(cp, 1, [0, 0])).rejects.toThrow('504');
    expect(cp.getVendorItemInventory).toHaveBeenCalledTimes(3);
  });

  it('4xx는 바로 던진다', async () => {
    const cp = client(err400);
    await expect(getInventoryWithRetry(cp, 1, [0, 0])).rejects.toThrow('400');
    expect(cp.getVendorItemInventory).toHaveBeenCalledTimes(1);
  });
});
