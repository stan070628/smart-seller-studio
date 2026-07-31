import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  breakEvenPrice,
  marginOf,
  LOGISTICS_FEE,
  COMMISSION_RATE,
  buildSearchQueries,
  estimateCoupangPrice,
} from '@/lib/sourcing/coupang-price';
import type { LogisticsSize } from '@/types/shortlist';

describe('LOGISTICS_FEE', () => {
  it('로켓그로스 요금표와 일치한다', () => {
    expect(LOGISTICS_FEE.xsmall).toBe(1725);
    expect(LOGISTICS_FEE.small).toBe(1900);
    expect(LOGISTICS_FEE.medium).toBe(2740);
  });
});

describe('breakEvenPrice', () => {
  it('극소형 실효원가 2,500원의 손익분기가는 7,638원', () => {
    expect(breakEvenPrice(2500, 'xsmall')).toBe(7638);
  });

  it('극소형 실효원가 3,300원의 손익분기가는 8,535원', () => {
    expect(breakEvenPrice(3300, 'xsmall')).toBe(8535);
  });

  it('극소형 실효원가 4,000원의 손익분기가는 9,671원', () => {
    expect(breakEvenPrice(4000, 'xsmall')).toBe(9671);
  });

  it('소형 실효원가 3,180원의 손익분기가는 8,891원', () => {
    expect(breakEvenPrice(3180, 'small')).toBe(8891);
  });

  it('사이즈가 커지면 손익분기가도 올라간다', () => {
    const cost = 3000;
    expect(breakEvenPrice(cost, 'xsmall')).toBeLessThan(breakEvenPrice(cost, 'small'));
    expect(breakEvenPrice(cost, 'small')).toBeLessThan(breakEvenPrice(cost, 'medium'));
  });
});

describe('marginOf', () => {
  it('메쉬 반장갑 — 실효원가 3,600원을 9,900원에 팔면 마진 3,506원', () => {
    expect(marginOf(9900, 3600, 'xsmall')).toBe(3506);
  });

  it('접이식 쓰레기통 — 실효원가 2,830원을 5,080원에 팔면 적자', () => {
    expect(marginOf(5080, 2830, 'xsmall')).toBeLessThan(0);
  });

  it('손익분기가에서는 마진이 0 이상이다', () => {
    const cost = 3300;
    const be = breakEvenPrice(cost, 'xsmall');
    expect(marginOf(be, cost, 'xsmall')).toBeGreaterThanOrEqual(0);
  });
});

describe('breakEvenPrice 보장', () => {
  // 손익분기가로 팔면 두 조건을 모두 만족해야 한다. 이게 이 함수의 존재 이유다.
  // 값 하나하나를 박는 대신 성질을 검증해, 공식을 잘못 고치면 여기서 걸리게 한다.
  const CASES: [number, LogisticsSize][] = [
    [2000, 'xsmall'], [2500, 'xsmall'], [3300, 'xsmall'], [4000, 'xsmall'], [8000, 'xsmall'],
    [3180, 'small'], [5000, 'small'],
    [3000, 'medium'], [7000, 'medium'],
  ];

  it.each(CASES)('실효원가 %i원 %s — 마진율 30%% 이상', (cost, size) => {
    const be = breakEvenPrice(cost, size);
    const margin = be * (1 - COMMISSION_RATE) - LOGISTICS_FEE[size] - cost;
    expect(margin / be).toBeGreaterThanOrEqual(0.3);
  });

  it.each(CASES)('실효원가 %i원 %s — 개당 마진이 물류비의 1.5배 이상', (cost, size) => {
    const be = breakEvenPrice(cost, size);
    const margin = be * (1 - COMMISSION_RATE) - LOGISTICS_FEE[size] - cost;
    expect(margin).toBeGreaterThanOrEqual(LOGISTICS_FEE[size] * 1.5);
  });
});

describe('buildSearchQueries', () => {
  it('판매자 태그를 제거한다', () => {
    const qs = buildSearchQueries('[한원산업] 극세사 스포츠 방한장갑 바이크장갑 오토바이장갑');
    expect(qs.join(' ')).not.toContain('한원산업');
    expect(qs[0]).toBe('극세사 스포츠 방한장갑 바이크장갑');
  });

  it('제목 여러 구간을 검색어로 만든다', () => {
    // 앞 4단어만 쓰면 상품 정체를 놓친다.
    // "접이식 쓰레기통"으로 검색하면 캠핑용 대형 트래쉬박스가 잡혔다.
    const qs = buildSearchQueries(
      '접이식 쓰레기통 걸이형휴지통 휴대용휴지통 쓰레기봉투걸이 휴지통',
    );
    expect(qs.length).toBeGreaterThan(1);
    expect(qs.some((q) => q.includes('쓰레기봉투걸이'))).toBe(true);
  });

  it('괄호와 모델코드를 제거한다', () => {
    const qs = buildSearchQueries('(GTF58047) 캠핑러브 고강도 단조팩 세트 실버');
    expect(qs[0]).not.toContain('GTF58047');
    expect(qs[0]).not.toContain('(');
  });

  it('중복 구간은 한 번만 담는다', () => {
    const qs = buildSearchQueries('장갑 방한 장갑 방한');
    expect(new Set(qs).size).toBe(qs.length);
  });

  it('빈 제목이어도 빈 배열을 반환하지 않는다', () => {
    expect(buildSearchQueries('123 45').length).toBeGreaterThan(0);
  });
});

/** 네이버 쇼핑 API 응답 모양의 아이템을 만든다 */
function item(lprice: number, mallName: string) {
  return { title: 'x', lprice: String(lprice), mallName };
}

describe('estimateCoupangPrice', () => {
  beforeEach(() => {
    process.env.NAVER_CLIENT_ID = 'id';
    process.env.NAVER_CLIENT_SECRET = 'secret';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('쿠팡몰 항목만 골라 하위 25%를 반환한다', async () => {
    const coupang = [4000, 5000, 5500, 6000, 7000, 8000, 9000, 20000].map((p) =>
      item(p, '쿠팡'),
    );
    const noise = [100, 200, 300].map((p) => item(p, '기타몰'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [...coupang, ...noise] }),
      }),
    );

    const result = await estimateCoupangPrice('메쉬 반장갑 등산 낚시 라이더');
    expect(result).not.toBeNull();
    expect(result!.p25).toBe(5500);
    // buildSearchQueries('메쉬 반장갑 등산 낚시 라이더')는 쿼리 3개를 만들고
    // (mock이 모든 호출에 같은 8건을 반환하므로) 3 × 8 = 24건이 쌓인다.
    expect(result!.sampleN).toBe(24);
  });

  it('쿠팡몰 표본이 3건 미만이면 null을 반환한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [item(5000, '쿠팡'), item(300, '기타몰')] }),
      }),
    );
    expect(await estimateCoupangPrice('아주 희귀한 상품명')).toBeNull();
  });

  it('네이버 API가 실패해도 예외를 던지지 않고 null을 반환한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(await estimateCoupangPrice('메쉬 반장갑')).toBeNull();
  });

  it('1,000원 미만 항목은 표본에서 제외한다', async () => {
    const items = [item(500, '쿠팡'), item(600, '쿠팡'), item(700, '쿠팡')];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items }) }),
    );
    expect(await estimateCoupangPrice('저가 부속품')).toBeNull();
  });

  it('HTTP 오류 응답이면 표본 없이 null을 반환한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }),
    );
    expect(await estimateCoupangPrice('메쉬 반장갑 등산 낚시')).toBeNull();
  });

  it('검색어마다 호출하고 결과를 누적한다', async () => {
    const title = '메쉬 반장갑 등산 낚시 라이더';
    const queries = buildSearchQueries(title);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [4000, 5000, 5500].map((p) => item(p, '쿠팡')) }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await estimateCoupangPrice(title);

    expect(fetchMock).toHaveBeenCalledTimes(queries.length);
    expect(result!.sampleN).toBe(queries.length * 3);
  });
});
