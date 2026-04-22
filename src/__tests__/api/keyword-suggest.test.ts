import { describe, it, expect } from 'vitest';
import { parseKeywordSuggestResponse } from '@/app/api/ai/keyword-suggest/route';

describe('parseKeywordSuggestResponse', () => {
  it('정상 JSON 응답을 파싱한다', () => {
    const raw = '{"keywords": [{"keyword": "방수 직장인 백팩", "reason": "직장인 수요 꾸준, 경쟁 낮음"}]}';
    const result = parseKeywordSuggestResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].keyword).toBe('방수 직장인 백팩');
    expect(result[0].reason).toBe('직장인 수요 꾸준, 경쟁 낮음');
  });

  it('마크다운 코드블록으로 감싸진 JSON을 파싱한다', () => {
    const raw = '```json\n{"keywords": [{"keyword": "알루미늄 노트북 거치대", "reason": "재택근무 수요"}]}\n```';
    const result = parseKeywordSuggestResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].keyword).toBe('알루미늄 노트북 거치대');
  });

  it('keywords 필드가 없으면 빈 배열을 반환한다', () => {
    const raw = '{"data": []}';
    const result = parseKeywordSuggestResponse(raw);
    expect(result).toEqual([]);
  });

  it('유효하지 않은 JSON이면 빈 배열을 반환한다', () => {
    const raw = 'not valid json';
    const result = parseKeywordSuggestResponse(raw);
    expect(result).toEqual([]);
  });

  it('keyword 또는 reason이 문자열이 아닌 항목을 필터링한다', () => {
    const raw = '{"keywords": [{"keyword": "유효한 키워드", "reason": "이유"}, {"keyword": 123, "reason": "이유"}]}';
    const result = parseKeywordSuggestResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].keyword).toBe('유효한 키워드');
  });
});
