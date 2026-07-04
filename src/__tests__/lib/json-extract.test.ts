import { describe, it, expect } from 'vitest';
import { extractJsonArray } from '@/lib/ai/json-extract';

describe('extractJsonArray', () => {
  it('평범한 JSON 배열을 추출한다', () => {
    expect(extractJsonArray('[{"a":1}]')).toBe('[{"a":1}]');
  });
  it('코드펜스·설명이 앞뒤에 있어도 배열만 추출한다', () => {
    const text = 'Here:\n```json\n[{"x":[1,2]}]\n```\ndone';
    expect(extractJsonArray(text)).toBe('[{"x":[1,2]}]');
  });
  it('문자열 안의 대괄호를 깊이로 오인하지 않는다', () => {
    expect(extractJsonArray('[{"t":"a]b["}]')).toBe('[{"t":"a]b["}]');
  });
  it('배열이 없으면 null', () => {
    expect(extractJsonArray('no array here')).toBeNull();
  });
});
