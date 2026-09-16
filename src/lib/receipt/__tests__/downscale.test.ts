/**
 * 업로드 전 축소.
 *
 * 아이폰 원본은 장당 6MB 안팎이고 Vercel 함수는 본문 4.5MB에서 끊는다.
 * 한편 Claude는 긴 변 2576px를 넘는 이미지를 **어차피 스스로 줄여서** 본다
 * (Claude 4.7 이후 고해상도 티어). 그래서 2576px로 맞춰 보내는 것은
 * 판독 품질을 깎는 것이 아니라 헛되이 큰 바이트만 덜어내는 것이다.
 */

import { describe, it, expect } from 'vitest';
import { fitLongEdge, prepareForUpload, MAX_LONG_EDGE, UPLOAD_BUDGET_BYTES } from '../downscale';

describe('fitLongEdge', () => {
  it('아이폰 가로 원본(4032×3024)을 긴 변 2576으로 맞춘다', () => {
    expect(fitLongEdge(4032, 3024, MAX_LONG_EDGE)).toEqual({ width: 2576, height: 1932 });
  });

  it('세로 사진은 높이가 긴 변이다', () => {
    expect(fitLongEdge(3024, 4032, MAX_LONG_EDGE)).toEqual({ width: 1932, height: 2576 });
  });

  it('🔴 상한보다 작은 사진을 키우지 않는다 — 없는 화소를 만들면 판독만 흐려진다', () => {
    expect(fitLongEdge(1200, 900, MAX_LONG_EDGE)).toEqual({ width: 1200, height: 900 });
  });

  it('정사각형도 비율을 지킨다', () => {
    expect(fitLongEdge(4000, 4000, MAX_LONG_EDGE)).toEqual({ width: 2576, height: 2576 });
  });

  it('반올림으로 0이 나오지 않는다', () => {
    const { width, height } = fitLongEdge(10000, 3, MAX_LONG_EDGE);
    expect(width).toBe(2576);
    expect(height).toBeGreaterThanOrEqual(1);
  });
});

describe('prepareForUpload', () => {
  it('예산은 Vercel 본문 상한 4.5MB보다 작다 — 멀티파트 오버헤드 몫을 남긴다', () => {
    expect(UPLOAD_BUDGET_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });

  it('🔴 캔버스를 쓸 수 없는 환경에서도 업로드를 막지 않는다 — 원본으로 넘긴다', async () => {
    // jsdom에는 canvas 2d 컨텍스트가 없다. 실기기에서도 디코딩이 실패할 수 있다.
    // 축소에 실패했다고 촬영 흐름을 세우면 매장에서 아무것도 못 한다.
    const file = new File(['x'.repeat(1000)], 'r.jpg', { type: 'image/jpeg' });
    const out = await prepareForUpload([file]);

    expect(out.files).toHaveLength(1);
    expect(out.files[0].size).toBe(1000);
    expect(out.totalBytes).toBe(1000);
    expect(out.overBudget).toBe(false);
  });

  it('🔴 축소 후에도 예산을 넘으면 보내기 전에 알린다 — 413을 맞고 나서가 아니라', async () => {
    const big = new File(['x'.repeat(3_000_000)], 'a.jpg', { type: 'image/jpeg' });
    const big2 = new File(['y'.repeat(3_000_000)], 'b.jpg', { type: 'image/jpeg' });
    const out = await prepareForUpload([big, big2]);

    expect(out.totalBytes).toBe(6_000_000);
    expect(out.overBudget).toBe(true);
  });
});
