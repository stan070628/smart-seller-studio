import { describe, it, expect } from 'vitest';
import { buildVerifyResult, type DomeSnapshot } from '@/lib/sourcing/shortlist-verify';

const dome: DomeSnapshot = {
  status: '판매중',
  price: 3300,
  inventory: 500,
  moq: 1,
  deli: { who: 'P', fee: '3000' },
};

describe('buildVerifyResult — 수동 입력 p25 사용', () => {
  it('저장된 p25로 판정한다 (외부 시세 조회 없음)', async () => {
    const r = await buildVerifyResult(dome, 10, 'xsmall', 10500);

    expect(r.coupangP25).toBe(10500);
    expect(r.effectiveCost).toBe(3600);   // 3300 + ceil(3000/10)
    expect(r.breakEvenPrice).toBe(9471);  // 2026-07-31 원가 모델
    expect(r.verdict).toBe('pass');       // 10500 >= 9471
  });

  it('p25가 null이면 unknown이되 원가·손익분기는 채운다', async () => {
    const r = await buildVerifyResult(dome, 10, 'xsmall', null);

    expect(r.coupangP25).toBeNull();
    expect(r.verdict).toBe('unknown');
    expect(r.effectiveCost).toBe(3600);
    expect(r.breakEvenPrice).toBe(9471);  // 시세를 몰라도 손익분기는 계산된다
    expect(r.margin).toBeNull();
  });

  it('손익분기 미달이면 fail이다', async () => {
    const r = await buildVerifyResult(dome, 10, 'xsmall', 9000);
    expect(r.verdict).toBe('fail');
  });

  it('삭제된 상품은 p25가 있어도 dead다', async () => {
    const r = await buildVerifyResult(null, 10, 'xsmall', 10500);
    expect(r.verdict).toBe('dead');
    expect(r.domeStatus).toBe('삭제됨');
  });
});
