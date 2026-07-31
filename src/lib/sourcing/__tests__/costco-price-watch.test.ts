// @vitest-environment node
/**
 * costco-price-watch.test.ts
 * 코스트코 매입가 감시 — 알림 판정과 메시지 생성 단위 테스트
 *
 * 재알림 억제 규칙이 이 기능의 핵심이다. 같은 세일에 매일 알림이 오면
 * 알림 자체를 무시하게 되므로, 판정 로직을 경계값까지 검증한다.
 */

import { describe, it, expect } from 'vitest';
import {
  decideNotification,
  buildWatchMessage,
  type PriceWatchRow,
} from '../costco-price-watch';

const THRESHOLD = 21000;

describe('decideNotification', () => {
  describe('임계가 초과 — 세일이 아니다', () => {
    it('알린 적 없으면 침묵한다', () => {
      expect(decideNotification(23990, THRESHOLD, null)).toBe('silent');
    });

    it('알린 적 있으면 리셋한다 (세일 종료)', () => {
      expect(decideNotification(23990, THRESHOLD, 20000)).toBe('reset');
    });
  });

  describe('임계가 이하 — 세일이다', () => {
    it('처음 진입하면 알린다', () => {
      expect(decideNotification(20990, THRESHOLD, null)).toBe('notify');
    });

    it('임계가와 같아도 알린다 (이하 포함)', () => {
      expect(decideNotification(THRESHOLD, THRESHOLD, null)).toBe('notify');
    });

    it('같은 가격이 이어지면 침묵한다', () => {
      expect(decideNotification(20990, THRESHOLD, 20990)).toBe('silent');
    });

    it('더 싸지면 다시 알린다', () => {
      expect(decideNotification(19990, THRESHOLD, 20990)).toBe('notify');
    });

    it('세일 중 가격이 올라도 임계가 이하면 침묵한다', () => {
      expect(decideNotification(20500, THRESHOLD, 19990)).toBe('silent');
    });
  });

  describe('가격 부재', () => {
    it('null이면 침묵한다', () => {
      expect(decideNotification(null, THRESHOLD, null)).toBe('silent');
    });

    it('0 이하면 침묵한다', () => {
      expect(decideNotification(0, THRESHOLD, null)).toBe('silent');
      expect(decideNotification(-1, THRESHOLD, null)).toBe('silent');
    });
  });

  describe('세일 한 사이클', () => {
    it('진입 → 유지 → 추가 인하 → 종료 → 재진입 순으로 동작한다', () => {
      // 정가
      expect(decideNotification(23990, THRESHOLD, null)).toBe('silent');
      // 세일 진입
      expect(decideNotification(20990, THRESHOLD, null)).toBe('notify');
      // 같은 가격 유지 — 재알림 없음
      expect(decideNotification(20990, THRESHOLD, 20990)).toBe('silent');
      // 추가 인하
      expect(decideNotification(19990, THRESHOLD, 20990)).toBe('notify');
      // 세일 종료 → 리셋
      expect(decideNotification(23990, THRESHOLD, 19990)).toBe('reset');
      // 리셋 후 재진입 — 다시 알린다
      expect(decideNotification(20990, THRESHOLD, null)).toBe('notify');
    });
  });
});

describe('buildWatchMessage', () => {
  const base: PriceWatchRow = {
    id: 'w1',
    product_code: '713160',
    label: '커클랜드 다용도타월 36장',
    threshold_price: THRESHOLD,
    chat_id: '8989165721',
    last_notified_price: null,
    current_price: 20990,
    lowest_price: 19990,
    prev_price: 23990,
  };

  it('직전가가 있으면 낙폭을 표시한다', () => {
    const msg = buildWatchMessage(base);
    expect(msg).toContain('23,990원 → 20,990원');
    expect(msg).toContain('-3,000원');
    expect(msg).toContain('-12.5%');
  });

  it('직전가가 없으면 현재가만 표시한다', () => {
    const msg = buildWatchMessage({ ...base, prev_price: null });
    expect(msg).toContain('현재가 20,990원');
    expect(msg).not.toContain('→');
  });

  it('직전가가 현재가보다 낮으면 낙폭을 표시하지 않는다', () => {
    const msg = buildWatchMessage({ ...base, prev_price: 19000 });
    expect(msg).toContain('현재가 20,990원');
  });

  it('역대 최저가면 강조한다', () => {
    const msg = buildWatchMessage({ ...base, current_price: 19990 });
    expect(msg).toContain('🔥 역대 최저가');
  });

  it('역대 최저가가 아니면 최저가를 함께 보여준다', () => {
    const msg = buildWatchMessage(base);
    expect(msg).toContain('역대 최저 19,990원');
    expect(msg).not.toContain('🔥');
  });

  it('임계가와 상품명을 포함한다', () => {
    const msg = buildWatchMessage(base);
    expect(msg).toContain('커클랜드 다용도타월 36장');
    expect(msg).toContain('임계가 21,000원 이하');
  });
});
