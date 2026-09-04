// @vitest-environment node
/**
 * 입고 폼의 선택 입력 파싱.
 *
 * RG 물류비 칸은 「비워두면 상품 사이즈 요율」과 「0원」을 구분해야 한다.
 * 종전 소분 폼은 기본값 '0'을 항상 보내 서버 폴백을 무력화했다.
 */
import { describe, it, expect } from 'vitest';
import { parseOptionalFee } from '@/lib/cost-management/entry-form';

describe('parseOptionalFee', () => {
  it('빈 칸은 undefined다 — 서버가 사이즈 요율로 채운다', () => {
    expect(parseOptionalFee('')).toBeUndefined();
  });

  it('공백만 있어도 빈 칸으로 본다', () => {
    expect(parseOptionalFee('   ')).toBeUndefined();
  });

  it('0을 적었으면 0을 보낸다 — 사이즈 요율이 덮지 않는다', () => {
    expect(parseOptionalFee('0')).toBe(0);
  });

  it('숫자는 정수로 반올림한다', () => {
    expect(parseOptionalFee('3079.6')).toBe(3080);
  });

  it('숫자가 아니면 undefined다', () => {
    expect(parseOptionalFee('abc')).toBeUndefined();
  });
});
