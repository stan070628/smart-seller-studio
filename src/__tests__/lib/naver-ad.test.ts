import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSignature, parseKeywordStats } from '@/lib/naver-ad';

describe('buildSignature', () => {
  it('timestamp + method + path를 HMAC-SHA256으로 서명한다', () => {
    const sig = buildSignature('1234567890', 'GET', '/keywordstool', 'secret-key');
    expect(typeof sig).toBe('string');
    expect(sig.length).toBeGreaterThan(20);
  });

  it('같은 입력에 대해 항상 동일한 서명을 반환한다', () => {
    const sig1 = buildSignature('1234567890', 'GET', '/keywordstool', 'secret');
    const sig2 = buildSignature('1234567890', 'GET', '/keywordstool', 'secret');
    expect(sig1).toBe(sig2);
  });

  it('다른 secret key는 다른 서명을 만든다', () => {
    const sig1 = buildSignature('1234567890', 'GET', '/keywordstool', 'secret1');
    const sig2 = buildSignature('1234567890', 'GET', '/keywordstool', 'secret2');
    expect(sig1).not.toBe(sig2);
  });
});

describe('parseKeywordStats', () => {
  it('keywordList 배열에서 searchVolume을 PC + Mobile 합산으로 추출한다', () => {
    const raw = {
      keywordList: [
        { relKeyword: '방수 백팩', monthlyPcQcCnt: 3200, monthlyMobileQcCnt: 8500 },
        { relKeyword: '미니 선풍기', monthlyPcQcCnt: 1000, monthlyMobileQcCnt: 2000 },
      ],
    };
    const result = parseKeywordStats(raw);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ keyword: '방수 백팩', searchVolume: 11700 });
    expect(result[1]).toEqual({ keyword: '미니 선풍기', searchVolume: 3000 });
  });

  it('빈 keywordList는 빈 배열을 반환한다', () => {
    expect(parseKeywordStats({ keywordList: [] })).toEqual([]);
  });

  it('잘못된 응답 형식은 빈 배열을 반환한다', () => {
    expect(parseKeywordStats(null)).toEqual([]);
    expect(parseKeywordStats({})).toEqual([]);
    expect(parseKeywordStats({ keywordList: 'bad' })).toEqual([]);
  });
});
