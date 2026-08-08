import { describe, it, expect } from 'vitest';
import { extractPackSize } from '@/lib/receipt/pack-size';

describe('extractPackSize', () => {
  it.each([
    ['KS노랑타월36CT', 36],
    ['소금버터빵 6CT', 6],
    ['KS라운드티6매 L', 6],
    ['KS라운드티6매XL', 6],
    ['동물복지란60개', 60],
    ['커클랜드 물티슈 12PK', 12],
    ['생수 2입', 2],
  ])('%s → %i', (label, expected) => {
    expect(extractPackSize(label)).toBe(expected);
  });

  it.each([
    ['아이더호보백'],
    ['KS M.쇼비뇽블랑'],
    ['YALE남성 후디'],
    ['위트빅스프로틴'],
    ['SEOUL A2+우유2.3'],
  ])('%s → null', (label) => {
    expect(extractPackSize(label)).toBeNull();
  });

  it('여러 개 나오면 마지막 것을 쓴다', () => {
    expect(extractPackSize('2단 선반 6개')).toBe(6);
  });

  it('빈 문자열은 null이다', () => {
    expect(extractPackSize('')).toBeNull();
  });
});
