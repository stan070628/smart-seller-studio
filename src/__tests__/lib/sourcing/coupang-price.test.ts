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
  it('로켓그로스 실청구 실측과 일치한다 (VAT 포함 실효원가)', () => {
    // 2026-08-13 실청구 실측: 고지값(2800/3625/5206)에 10% VAT를 더한 실질 부담액.
    // 직전 판은 요금표 최소값 기준의 1898/2090/3014이었다.
    expect(LOGISTICS_FEE.xsmall).toBe(3080);
    expect(LOGISTICS_FEE.small).toBe(3988);
    expect(LOGISTICS_FEE.medium).toBe(5727);
  });
});

describe('breakEvenPrice', () => {
  // 2026-08-13 실청구 물류비 + 매출세액 1.5% 반영으로 전 구간이 올랐다.
  // 물류비 인상분(1,182원)보다 손익분기가 상승폭(3,554원)이 큰 이유는,
  // 물류비가 마진율 30% 조건의 분자에 들어가 판매가로 3배 증폭되기 때문이다.
  it('극소형 실효원가 2,500원의 손익분기가는 11,776원', () => {
    expect(breakEvenPrice(2500, 'xsmall')).toBe(11776);
  });

  it('극소형 실효원가 3,300원의 손익분기가는 12,700원', () => {
    expect(breakEvenPrice(3300, 'xsmall')).toBe(12700);
  });

  it('극소형 실효원가 4,000원의 손익분기가는 13,508원', () => {
    expect(breakEvenPrice(4000, 'xsmall')).toBe(13508);
  });

  it('소형 실효원가 3,180원의 손익분기가는 15,182원', () => {
    expect(breakEvenPrice(3180, 'small')).toBe(15182);
  });

  it('사이즈가 커지면 손익분기가도 올라간다', () => {
    const cost = 3000;
    expect(breakEvenPrice(cost, 'xsmall')).toBeLessThan(breakEvenPrice(cost, 'small'));
    expect(breakEvenPrice(cost, 'small')).toBeLessThan(breakEvenPrice(cost, 'medium'));
  });
});

describe('marginOf', () => {
  it('메쉬 반장갑 — 실효원가 3,600원을 9,900원에 팔면 마진 1,895원', () => {
    // 2026-08-13 실청구 물류비(3,080) + 매출세액(1.5%) 반영.
    // 직전 판은 3,226원이었고, 물류비 1,182원 인상과 매출세액 149원이 그 차이다.
    expect(marginOf(9900, 3600, 'xsmall')).toBe(1895);
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

  // 마진은 marginOf로 잰다. 검증식을 손으로 다시 쓰면 산식에 항목이 추가될 때
  // (2026-08-13 매출세액이 그랬다) 검증식만 낡아 조건을 통과한 것처럼 보인다.
  it.each(CASES)('실효원가 %i원 %s — 마진율 30%% 이상', (cost, size) => {
    const be = breakEvenPrice(cost, size);
    expect(marginOf(be, cost, size) / be).toBeGreaterThanOrEqual(0.3);
  });

  it.each(CASES)('실효원가 %i원 %s — 개당 마진이 물류비의 1.5배 이상', (cost, size) => {
    const be = breakEvenPrice(cost, size);
    expect(marginOf(be, cost, size)).toBeGreaterThanOrEqual(LOGISTICS_FEE[size] * 1.5);
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

describe('COMMISSION_RATE VAT 반영', () => {
  it('간이과세자 기준 실질 수수료율은 11.88%다', () => {
    expect(COMMISSION_RATE).toBeCloseTo(0.1188, 6);
  });

  it('손익분기가가 VAT 포함 수수료·매출세액·실청구 물류비로 계산된다', () => {
    // 실효원가 3,600원, 극소형(실청구 물류비 3,080원 VAT포함), 정률 합계 0.1188 + 0.015 = 0.1338
    // byRate   = (3600 + 3080) / (1 - 0.1338 - 0.30) = 6680 / 0.5662  = 11798.0
    // byAmount = (3600 + 3080 * 2.5) / (1 - 0.1338)  = 11300 / 0.8662 = 13045.5
    // max(byRate, byAmount) = byAmount → Math.ceil → 13046
    //
    // 요금표 최소값을 쓰던 직전 판은 9,471원이었다. 3,575원이 오른 셈이며,
    // 물류비 배수 조건(byAmount)이 구속한다는 점은 그대로다 — 물류비가 오를수록
    // byAmount의 계수(2.5배)가 더 크게 작용해 격차가 벌어진다.
    // Math.ceil로 정수를 반환하므로 값을 정확히 못 박는다
    // (MARGIN_TO_LOGISTICS 같은 계수의 미세한 변경도 잡아낸다).
    expect(breakEvenPrice(3600, 'xsmall')).toBe(13046);
  });
});
