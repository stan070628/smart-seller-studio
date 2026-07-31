import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parse1688Checkout } from '@/lib/sourcing/parse-1688-checkout';

/**
 * 실측 붙여넣기 원문(2026-08-01 채집). 배송지 이름·전화번호만 마스킹했고
 * 나머지는 한 글자도 손대지 않았다. 1688 화면이 바뀌면 이 테스트가 먼저 깨져야 한다.
 */
const fixture = (name: string) =>
  fs.readFileSync(path.resolve(__dirname, `../../fixtures/1688/${name}.txt`), 'utf-8');

/** 판매자1 · 1件 · 쿠폰 있음 · 已减 있음 · 배송비 ¥2.00 */
const POUCH = fixture('tofu-pouch');
/** 판매자1 · 2件 · 쿠폰 없음 · 已减 없음 · 배송비 ¥3.50 */
const PENCASE = fixture('silicone-pencase');

describe('parse1688Checkout — 실측 샘플', () => {
  it('豆腐包: 쿠폰·已减 있는 1건', () => {
    const r = parse1688Checkout(POUCH);
    expect(r.ok).toBe(true);
    expect(r.totalCny).toBe(3.8);
    expect(r.totalKrw).toBe(840);
    expect(r.qty).toBe(1);
    expect(r.goodsCny).toBe(2.8);
    expect(r.freightCny).toBe(2.0);
    expect(r.discountCny).toBe(1.0);
    expect(r.alreadyReducedCny).toBe(0.7);
  });

  it('실리콘 필통: 쿠폰 없고 2件', () => {
    const r = parse1688Checkout(PENCASE);
    expect(r.ok).toBe(true);
    expect(r.totalCny).toBe(17.5);
    expect(r.totalKrw).toBe(3867);   // 천단위 쉼표가 붙어 나온다
    expect(r.qty).toBe(2);
    expect(r.goodsCny).toBe(14.0);
    expect(r.freightCny).toBe(3.5);
    expect(r.discountCny).toBeNull(); // 店铺优惠 라벨 자체가 없다
    expect(r.alreadyReducedCny).toBeNull();
  });
});

describe('parse1688Checkout — 실측이 드러낸 함정', () => {
  it('줄 단위로 쪼개진 금액을 온전히 읽는다', () => {
    // 원문은 "合计 / ¥ / 3 / .80" 네 줄이다. 3이 아니라 3.80이어야 한다
    expect(parse1688Checkout(POUCH).totalCny).toBe(3.8);
  });

  it('已减를 상품총계로 오독하지 않는다', () => {
    // 원문은 "商品总计1种1件 / 已减 / ¥0.70 / ¥2.80". 상품총계는 2.80이다
    expect(parse1688Checkout(POUCH).goodsCny).toBe(2.8);
  });

  it('店铺明细가 아니라 价格明细를 읽는다 (판매자 2명 대비)', () => {
    // 价格明细 앞쪽(=店铺明细 구간)의 수량 표기만 조작한다.
    // 슬라이스가 제대로 되면 결과가 바뀌지 않아야 한다
    const cut = PENCASE.indexOf('价格明细');
    const tampered =
      PENCASE.slice(0, cut).replace('商品总计2种2件', '商品总计9种9件') + PENCASE.slice(cut);
    const r = parse1688Checkout(tampered);
    expect(r.qty).toBe(2);
    expect(r.totalCny).toBe(17.5);
  });

  it('하단 立即下单의 금액 재출현에 흔들리지 않는다', () => {
    // POUCH 원문에는 ¥3.80과 ₩840이 각각 두 번 나온다. 첫 것만 써야 한다
    expect(parse1688Checkout(POUCH).totalKrw).toBe(840);
  });
});

describe('parse1688Checkout — 거부', () => {
  it('합계를 조작하면 검산이 막는다', () => {
    const r = parse1688Checkout(POUCH.replace('合计\n¥\n3\n.80', '合计\n¥\n9\n.80'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/검산/);
  });

  it('价格明细가 없으면 거부한다 (장바구니를 붙여넣은 경우)', () => {
    const r = parse1688Checkout(POUCH.replace('价格明细', ''));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/결제 확인/);
  });

  it('원화가 없으면 거부한다', () => {
    const r = parse1688Checkout(POUCH.replace(/≈KRW₩[\d,]+/g, ''));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/원화/);
  });

  it('빈 문자열을 거부한다', () => {
    expect(parse1688Checkout('').ok).toBe(false);
    expect(parse1688Checkout('   \n  ').ok).toBe(false);
  });
});

describe('parse1688Checkout — 파생값', () => {
  it('실효환율과 개당 평균가를 낸다', () => {
    expect(parse1688Checkout(POUCH).exchangeRate).toBeCloseTo(221.05, 1);  // 840 / 3.80
    expect(parse1688Checkout(POUCH).unitKrw).toBe(840);                    // 840 / 1

    expect(parse1688Checkout(PENCASE).exchangeRate).toBeCloseTo(220.97, 1); // 3867 / 17.50
    expect(parse1688Checkout(PENCASE).unitKrw).toBe(1934);                  // round(3867 / 2)
  });
});
