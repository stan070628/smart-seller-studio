import { describe, it, expect } from 'vitest';
import { readStructuredText } from '@/lib/sourcing-candidates/parse-response';

describe('readStructuredText', () => {
  it('stop_reason이 max_tokens면 잘림 오류', () => {
    expect(() => readStructuredText({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{}' }] }))
      .toThrow('판독 출력이 잘렸습니다 (max_tokens)');
  });
  it('stop_reason이 refusal이면 거부 오류', () => {
    expect(() => readStructuredText({ stop_reason: 'refusal', content: [{ type: 'text', text: '{}' }] }))
      .toThrow('판독이 거부됐습니다 (refusal)');
  });
  it('text 블록이 없으면 비어있음 오류', () => {
    expect(() => readStructuredText({ stop_reason: 'end_turn', content: [{ type: 'image' }] }))
      .toThrow('판독 결과가 비어 있습니다');
  });
  it('JSON이 아니면 앞부분을 담아 오류', () => {
    expect(() => readStructuredText({ stop_reason: 'end_turn', content: [{ type: 'text', text: '이건 JSON이 아니다' }] }))
      .toThrow('판독 결과가 JSON이 아닙니다: 이건 JSON이 아니다');
  });
  it('정상이면 파싱된 객체를 반환한다', () => {
    expect(readStructuredText({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"a":1}' }] }))
      .toEqual({ a: 1 });
  });
});
