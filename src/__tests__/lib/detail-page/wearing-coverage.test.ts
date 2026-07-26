import { describe, it, expect } from 'vitest';
import { validateProLayout, sanitizeProLayout } from '@/lib/detail-page/layout-validator';

/** model_wearing 슬롯 n개를 서로 다른 섹션에 배치한 최소 레이아웃 */
function withWearing(n: number): Record<string, unknown>[] {
  const secs = Array.from({ length: 6 }, (_, i) => ({
    type: 'claude_layout',
    title: `섹션 ${i}`,
    blocks: [{ type: 'heading', text: `제목 ${i}`, size: 'xl' }],
    bgStyle: 'white',
  })) as Record<string, unknown>[];
  for (let i = 0; i < n; i++) {
    secs[i]!.imageSlots = [
      { slotType: 'model_wearing', promptHint: '해변 산책', faceVisible: i === 0, modelGender: 'male' },
    ];
  }
  return secs;
}

describe('wearing_coverage', () => {
  it('플래그가 꺼져 있으면 검증하지 않는다', () => {
    const res = validateProLayout(withWearing(1));
    expect(res.violations.some(v => v.code === 'wearing_coverage')).toBe(false);
  });

  it('0개는 통과한다 — 인물이 부적절한 상품은 0개가 정답', () => {
    const res = validateProLayout(withWearing(0), { wearing: true });
    expect(res.violations.some(v => v.code === 'wearing_coverage')).toBe(false);
  });

  it('1개면 위반 — 얼굴 컷과 크롭 컷이 각각 필요하다', () => {
    const res = validateProLayout(withWearing(1), { wearing: true });
    expect(res.violations.some(v => v.code === 'wearing_coverage')).toBe(true);
  });

  it('2개는 통과한다', () => {
    const res = validateProLayout(withWearing(2), { wearing: true });
    expect(res.violations.some(v => v.code === 'wearing_coverage')).toBe(false);
  });

  it('3개도 통과한다', () => {
    const res = validateProLayout(withWearing(3), { wearing: true });
    expect(res.violations.some(v => v.code === 'wearing_coverage')).toBe(false);
  });

  it('위반은 error 등급이라 repair를 트리거한다', () => {
    const res = validateProLayout(withWearing(1), { wearing: true });
    const v = res.violations.find(x => x.code === 'wearing_coverage');
    expect(v?.severity).toBe('error');
    expect(res.isClean).toBe(false);
  });
});

describe('imageSlots 신규 필드', () => {
  it('faceVisible과 modelGender가 스키마 위반이 아니다', () => {
    const res = validateProLayout(withWearing(2), { wearing: true });
    expect(res.violations.some(v => v.code === 'schema')).toBe(false);
  });

  it('sanitize를 거쳐도 두 필드가 보존된다', () => {
    const { sections } = sanitizeProLayout(withWearing(2));
    const slot = (sections[0] as { imageSlots: Record<string, unknown>[] }).imageSlots[0]!;
    expect(slot.faceVisible).toBe(true);
    expect(slot.modelGender).toBe('male');
  });

  it('modelGender에 잘못된 값이 오면 schema 위반', () => {
    const secs = withWearing(2);
    (secs[0]!.imageSlots as Record<string, unknown>[])[0]!.modelGender = 'other';
    const res = validateProLayout(secs, { wearing: true });
    expect(res.violations.some(v => v.code === 'schema')).toBe(true);
  });
});
