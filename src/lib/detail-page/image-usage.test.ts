import { describe, it, expect } from 'vitest';
import { collectImageUsage, imageUsageWarnings } from './image-usage';

const slots = (...refs: Array<number | undefined>) => ({
  imageSlots: refs.map((imageRef) => ({ imageRef })),
});

describe('collectImageUsage', () => {
  it('사용 횟수를 인덱스별로 센다', () => {
    const u = collectImageUsage([slots(0, 1), slots(1)], 3);
    expect(u.counts.get(0)).toBe(1);
    expect(u.counts.get(1)).toBe(2);
    expect(u.counts.get(2)).toBe(0);
    expect(u.unused).toEqual([2]);
    expect(u.duplicated).toEqual([1]);
  });

  it('imageRef가 없는 슬롯은 세지 않는다 (AI 생성 이미지 자리)', () => {
    const u = collectImageUsage([slots(undefined, undefined)], 2);
    expect(u.unused).toEqual([0, 1]);
    expect(u.outOfRange).toBe(0);
  });

  it('업로드 범위 밖을 가리키면 outOfRange로 센다', () => {
    const u = collectImageUsage([slots(5, -1)], 2);
    expect(u.outOfRange).toBe(2);
    expect(u.unused).toEqual([0, 1]);
  });

  it('섹션이 비어도 안전하다', () => {
    expect(collectImageUsage([], 2).unused).toEqual([0, 1]);
    expect(collectImageUsage([{}], 1).unused).toEqual([0]);
  });
});

describe('imageUsageWarnings', () => {
  it('전부 쓰였으면 경고가 없다', () => {
    expect(imageUsageWarnings([slots(0, 1)], 2)).toEqual([]);
  });

  it('업로드가 없으면 경고하지 않는다', () => {
    expect(imageUsageWarnings([], 0)).toEqual([]);
  });

  it('2026-08-02 실제 사례 — 4장 중 1장 미사용 + 1장 중복', () => {
    // 블루앞(0) 미사용, 화이트앞(1)이 두 번 사용됨
    const sections = [slots(3), slots(1), slots(1), slots(2)];
    const w = imageUsageWarnings(sections, 4, ['블루앞', '화이트앞', '화이트뒤', '블루뒤']);

    expect(w).toHaveLength(2);
    expect(w[0]).toContain('4장 중 3장');
    expect(w[0]).toContain('1번째(블루앞)');
    expect(w[1]).toContain('2번째(화이트앞)');
  });

  it('옵션명이 없으면 번호만 쓴다', () => {
    const w = imageUsageWarnings([slots(0)], 2);
    expect(w[0]).toContain('2번째');
    expect(w[0]).not.toContain('(');
  });

  it('미사용이 없으면 중복만으로는 경고하지 않는다', () => {
    // 같은 사진을 의도적으로 두 번 배치하는 것은 정상 편집이다
    const w = imageUsageWarnings([slots(0, 0, 1)], 2);
    expect(w).toEqual([]);
  });

  it('범위 밖 참조를 따로 알린다', () => {
    const w = imageUsageWarnings([slots(0, 9)], 1);
    expect(w.some((x) => x.includes('없는 이미지'))).toBe(true);
  });
});
