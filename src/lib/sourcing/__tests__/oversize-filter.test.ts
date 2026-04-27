import { describe, it, expect } from 'vitest';
import { checkOversize } from '../legal/oversize-filter';

describe('checkOversize — 부피 큰 상품 RED 차단 (그로스 보관료 회피)', () => {
  it('"3인용 소파" → RED 차단', () => {
    const issue = checkOversize('3인용 소파 회색 패브릭');
    expect(issue?.severity).toBe('RED');
    expect(issue?.layer).toBe('oversize');
    expect(issue?.code).toBe('OVERSIZE_ITEM');
  });

  it('"매트리스 퀸" → RED 차단', () => {
    expect(checkOversize('매트리스 퀸사이즈 본넬스프링')?.severity).toBe('RED');
  });

  it('"5단 책장" → RED 차단', () => {
    expect(checkOversize('5단 책장 원목 대형')?.severity).toBe('RED');
  });

  it('"수납 캐비넷" → RED 차단', () => {
    expect(checkOversize('철제 수납 캐비넷')?.severity).toBe('RED');
  });

  it('"러닝머신" → RED 차단', () => {
    expect(checkOversize('가정용 러닝머신 접이식')?.severity).toBe('RED');
  });

  it('일반 소형 상품 → null', () => {
    expect(checkOversize('스테인리스 텀블러 500ml')).toBeNull();
    expect(checkOversize('마우스패드 XL')).toBeNull();
  });

  it('대형 키워드 단독("대형") → RED', () => {
    expect(checkOversize('대형 화분 스탠드')?.severity).toBe('RED');
  });
});
