import { describe, it, expect, vi } from 'vitest';
import { CoupangClient } from '@/lib/listing/coupang-client';

function clientWith(res: unknown | Error): CoupangClient {
  // vendorId·request는 private — 생성자가 환경변수를 읽어 테스트에서 못 만들므로 프로토타입으로 만들고 두 칸만 채운다
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = Object.create(CoupangClient.prototype) as any;
  c.vendorId = 'A00000000';
  c.request = vi.fn(async () => { if (res instanceof Error) throw res; return res; });
  return c as CoupangClient;
}

describe('getOrderCoupons', () => {
  it('data 배열 · data.content · 최상위 content 세 모양을 모두 읽는다', async () => {
    const e = [{ type: 'PRICE', discount: 840, status: 'APPLIED' }];
    expect(await clientWith({ code: 'SUCCESS', data: e }).getOrderCoupons('1')).toEqual(e);
    expect(await clientWith({ code: 'SUCCESS', data: { content: e } }).getOrderCoupons('1')).toEqual(e);
    expect(await clientWith({ code: 'SUCCESS', content: e }).getOrderCoupons('1')).toEqual(e);
    expect(await clientWith({ code: 'SUCCESS', data: [] }).getOrderCoupons('1')).toEqual([]);
  });

  it('(리뷰) 모르는 응답 모양이면 던진다 — 빈 배열로 읽어 「할인 0원」으로 확정하지 않는다', async () => {
    await expect(clientWith({ code: 'SUCCESS' }).getOrderCoupons('1')).rejects.toThrow();
    await expect(clientWith({ code: 'SUCCESS', data: {} }).getOrderCoupons('1')).rejects.toThrow();
    await expect(clientWith({ code: 'SUCCESS', data: null }).getOrderCoupons('1')).rejects.toThrow();
    await expect(clientWith({ code: 'SUCCESS', data: { content: 'x' } }).getOrderCoupons('1')).rejects.toThrow();
    // 알아본 모양의 빈 배열만 []
    expect(await clientWith({ code: 'SUCCESS', data: { content: [] } }).getOrderCoupons('1')).toEqual([]);
    expect(await clientWith({ code: 'SUCCESS', content: [] }).getOrderCoupons('1')).toEqual([]);
  });

  it('요청이 실패하면 던진다(0으로 삼키지 않는다)', async () => {
    await expect(clientWith(new Error('HTTP 500')).getOrderCoupons('1')).rejects.toThrow('HTTP 500');
  });
});
