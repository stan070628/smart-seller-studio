import { describe, it, expect } from 'vitest';
import { getTariffRate, calcImportTax, DEFAULT_TARIFF_RATE } from '@/lib/sourcing/tariff';

describe('getTariffRate', () => {
  it('의류는 13%다', () => {
    expect(getTariffRate('의류')).toBe(0.13);
    expect(getTariffRate('수영복')).toBe(0.13);
    expect(getTariffRate('신발류')).toBe(0.13);
  });

  it('장갑·가방·액세서리는 8%다', () => {
    expect(getTariffRate('장갑')).toBe(0.08);
    expect(getTariffRate('가방')).toBe(0.08);
    expect(getTariffRate('액세서리')).toBe(0.08);
  });

  it('부분 문자열로도 매칭된다', () => {
    expect(getTariffRate('방한 장갑')).toBe(0.08);
    expect(getTariffRate('겨울 의류 세트')).toBe(0.13);
  });

  it('모르는 카테고리는 기본값 8%다', () => {
    expect(getTariffRate('캠핑용품')).toBe(DEFAULT_TARIFF_RATE);
    expect(getTariffRate(null)).toBe(DEFAULT_TARIFF_RATE);
  });

  it('우산은 13%, 카페트는 10%다 — 배대지 고시표에서 누락돼 있던 행', () => {
    expect(getTariffRate('우산')).toBe(0.13);
    expect(getTariffRate('카페트')).toBe(0.1);
    // 실제 상품명은 이런 식으로 들어온다 (substring 매칭이므로 실사용 형태로 검증)
    expect(getTariffRate('3단 접이식 자동우산')).toBe(0.13);
  });

  it('화장품·향수는 6.5%다 — 관세청 WTO 양허세율 기준, 배대지 고시(8%)보다 낮다', () => {
    expect(getTariffRate('화장품')).toBe(0.065);
    expect(getTariffRate('향수')).toBe(0.065);
  });

  it('레고·블럭·퍼즐은 0%다 — HS 9503.00 조립식 완구·퍼즐의 WTO 양허세율', () => {
    expect(getTariffRate('레고')).toBe(0);
    expect(getTariffRate('블럭 장난감')).toBe(0);
    expect(getTariffRate('직소 퍼즐')).toBe(0);
  });

  it('숄더백은 가방 행에서 8%로 매칭된다 (행 순서 회귀 테스트)', () => {
    // 가방/핸드백 행이 스카프/숄 행보다 위에 있어야 '숄더백'이 '숄' 키워드에
    // 선매칭되지 않는다. 단, 두 행 모두 현재 8%로 같아서 이 단언 하나만으로는
    // "어느 행에서 매칭됐는지"를 증명하지 못한다 — 값이 같으면 순서가 틀려도
    // 통과하기 때문. 행 순서 자체는 TARIFF_TABLE의 정의 순서(가방이 스카프/숄보다
    // 위)로 보증하며, 이 테스트는 최소한 "결과값이 깨지지 않았음"만 고정한다.
    expect(getTariffRate('숄더백')).toBe(0.08);
  });

  it('알려진 오분류: 의류/신발과 무관한 생활용품이 키워드에 substring으로 걸려 13%로 나온다', () => {
    // 이것은 "고쳐야 할 버그"가 아니라 "지금 코드가 실제로 내는 값"을 고정하는
    // 회귀 테스트다. longest-match/제외 목록 없이는 고칠 수 없고 이번 작업의
    // 범위 밖이다. 나중에 매칭 알고리즘을 개선하면 이 테스트들이 눈에 띄게
    // 깨져야 한다 — 그게 그 개선이 실제로 효과가 있었다는 신호다.
    expect(getTariffRate('의류건조대')).toBe(0.13); // 옳은 값은 생활용품 8%
    expect(getTariffRate('신발장')).toBe(0.13); // 옳은 값은 가구 8%
    expect(getTariffRate('신발 건조기')).toBe(0.13); // 옳은 값은 가전 8%
    expect(getTariffRate('속옷 정리함')).toBe(0.13); // 옳은 값은 생활용품 8%
  });
});

describe('calcImportTax', () => {
  it('과세가격에 운임이 포함된다', () => {
    // 상품가 10,000 + 운임 322 = 과세가격 10,322
    const r = calcImportTax({ goodsKrw: 10000, dutiableFreightKrw: 322, tariffRate: 0.08 });
    expect(r.dutiableValueKrw).toBe(10322);
  });

  it('장갑 8% — 관세 826원, 부가세 1,115원', () => {
    const r = calcImportTax({ goodsKrw: 10000, dutiableFreightKrw: 322, tariffRate: 0.08 });
    expect(r.tariffKrw).toBe(826);
    expect(r.importVatKrw).toBe(1115);
    expect(r.dutyPaidValueKrw).toBe(12263);
  });

  it('의류 13% — 관세 1,342원, 부가세 1,166원', () => {
    const r = calcImportTax({ goodsKrw: 10000, dutiableFreightKrw: 322, tariffRate: 0.13 });
    expect(r.tariffKrw).toBe(1342);
    expect(r.importVatKrw).toBe(1166);
    expect(r.dutyPaidValueKrw).toBe(12830);
  });

  it('화장품 6.5% — 과세가격 10,322원 × 0.065 = 관세 671원, 부가세 1,099원', () => {
    // 손계산: dutiableValueKrw = 10000+322 = 10322
    //         tariffKrw = round(10322*0.065) = round(670.93) = 671
    //         importVatKrw = round((10322+671)*0.1) = round(1099.3) = 1099
    //         dutyPaidValueKrw = 10322+671+1099 = 12092
    const r = calcImportTax({ goodsKrw: 10000, dutiableFreightKrw: 322, tariffRate: 0.065 });
    expect(r.tariffKrw).toBe(671);
    expect(r.importVatKrw).toBe(1099);
    expect(r.dutyPaidValueKrw).toBe(12092);
  });

  it('레고 0% — 관세는 0원, 부가세는 과세가격에만 붙는다', () => {
    // 손계산: dutiableValueKrw = 10322, tariffKrw = 0
    //         importVatKrw = round(10322*0.1) = round(1032.2) = 1032
    //         dutyPaidValueKrw = 10322+0+1032 = 11354
    const r = calcImportTax({ goodsKrw: 10000, dutiableFreightKrw: 322, tariffRate: 0 });
    expect(r.tariffKrw).toBe(0);
    expect(r.importVatKrw).toBe(1032);
    expect(r.dutyPaidValueKrw).toBe(11354);
  });

  it('운임이 0이면 상품가만 과세된다', () => {
    const r = calcImportTax({ goodsKrw: 10000, dutiableFreightKrw: 0, tariffRate: 0.08 });
    expect(r.dutiableValueKrw).toBe(10000);
    expect(r.tariffKrw).toBe(800);
  });
});
