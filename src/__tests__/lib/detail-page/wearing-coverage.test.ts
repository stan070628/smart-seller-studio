import { describe, it, expect } from 'vitest';
import { validateProLayout, sanitizeProLayout } from '@/lib/detail-page/layout-validator';

/**
 * model_wearing 슬롯 n개를 서로 다른 섹션(0..n-1)에 배치한 최소 레이아웃.
 * faces[i]가 섹션 i의 faceVisible 값이다 — true/false/undefined(필드 생략)를
 * 각각 지정할 수 있다. faces를 생략하면 섹션 0은 true, 나머지는 false
 * (기존 동작과 동일 — 둘 다 boolean이라 "생략" 케이스는 만들지 않는다).
 */
function withWearing(n: number, faces?: (boolean | undefined)[]): Record<string, unknown>[] {
  // 6 = section_count 검증의 하한(6~10). 이보다 줄이면 무관한 section_count
  // warning이 섞여 다음 사람이 엉뚱한 경고를 쫓게 된다.
  const secs = Array.from({ length: 6 }, (_, i) => ({
    type: 'claude_layout',
    title: `섹션 ${i}`,
    blocks: [{ type: 'heading', text: `제목 ${i}`, size: 'xl' }],
    bgStyle: 'white',
  })) as Record<string, unknown>[];
  for (let i = 0; i < n; i++) {
    const faceVisible = faces ? faces[i] : i === 0;
    const slot: Record<string, unknown> = { slotType: 'model_wearing', promptHint: '해변 산책', modelGender: 'male' };
    // undefined면 필드 자체를 만들지 않는다 — "faceVisible 생략"과 "faceVisible: false"는
    // 서버 기본값(true) 처리 경로가 다르므로 구분해야 한다(I-2).
    if (faceVisible !== undefined) slot.faceVisible = faceVisible;
    secs[i]!.imageSlots = [slot];
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

  it('한 섹션에 2개를 넣으면 위반 — 섹션당 1장만 생성된다', () => {
    // page.tsx가 섹션당 첫 gen 슬롯만 생성하므로 한 섹션의 2개는 실제로 1장이다.
    const secs = withWearing(0);
    secs[0]!.imageSlots = [
      { slotType: 'model_wearing', promptHint: '해변 산책', faceVisible: true, modelGender: 'male' },
      { slotType: 'model_wearing', promptHint: '실내 짐', faceVisible: false, modelGender: 'male' },
    ];
    const res = validateProLayout(secs, { wearing: true });
    expect(res.violations.some(v => v.code === 'wearing_coverage')).toBe(true);
  });

  it('위반은 error 등급이라 repair를 트리거한다', () => {
    const res = validateProLayout(withWearing(1), { wearing: true });
    const v = res.violations.find(x => x.code === 'wearing_coverage');
    expect(v).toMatchObject({
      code: 'wearing_coverage',
      path: 'sections',
      severity: 'error',
      autoFixable: false,
      // repair-pro-layout이 이 문장을 그대로 LLM에 전달한다 — 로그가 아니라 지시다.
      message: expect.stringContaining('2개 이상'),
    });
    // isClean.toBe(false)만 보면 narrative 등 무관한 error로도 통과할 수 있어,
    // error 코드 목록을 정확히 고정한다.
    expect(res.violations.filter(v => v.severity === 'error').map(v => v.code)).toEqual(['wearing_coverage']);
    expect(res.isClean).toBe(false);
  });

  it('flux_lifestyle이 앞에 오면 카운트하지 않는다 — 그 섹션은 라이프스타일 씬이 된다', () => {
    const secs = withWearing(1); // 섹션 0에 순수 model_wearing 1개
    secs[1]!.imageSlots = [
      { slotType: 'flux_lifestyle', promptHint: '카페' },
      { slotType: 'model_wearing', promptHint: '해변', faceVisible: false, modelGender: 'male' },
    ];
    // 섹션 1의 첫 gen 슬롯은 flux_lifestyle → 착용컷은 실제로 1장뿐 → 위반
    const res = validateProLayout(secs, { wearing: true });
    expect(res.violations.some(v => v.code === 'wearing_coverage')).toBe(true);
  });

  it('detail_closeup이 앞에 오면 그 섹션의 model_wearing은 세지 않는다', () => {
    const secs = withWearing(0);
    secs[0]!.imageSlots = [
      { slotType: 'model_wearing', promptHint: '해변', faceVisible: true, modelGender: 'male' },
    ];
    secs[1]!.imageSlots = [
      { slotType: 'detail_closeup', promptHint: '박음질 접사' },
      { slotType: 'model_wearing', promptHint: '실내', faceVisible: false, modelGender: 'male' },
    ];
    const res = validateProLayout(secs, { wearing: true });
    expect(res.violations.some(v => v.code === 'wearing_coverage')).toBe(true);
  });

  it('두 섹션 모두 얼굴 컷이면(faceVisible 생략) wearing_face_pair 위반 — 두 컷이 같은 종류다', () => {
    // 둘 다 faceVisible 생략 → 서버 기본값 true로 처리되어 둘 다 얼굴 컷이 된다.
    const secs = withWearing(2, [undefined, undefined]);
    const res = validateProLayout(secs, { wearing: true });
    expect(res.violations.some(v => v.code === 'wearing_face_pair')).toBe(true);
  });

  it('두 섹션 모두 크롭 컷이면(faceVisible: false) wearing_face_pair 위반', () => {
    const secs = withWearing(2, [false, false]);
    const res = validateProLayout(secs, { wearing: true });
    expect(res.violations.some(v => v.code === 'wearing_face_pair')).toBe(true);
  });

  it('하나는 명시적 true, 하나는 생략이면 wearing_face_pair 위반 — 둘 다 얼굴 컷이 된다', () => {
    // === false 대신 falsy 체크(!firstGen.faceVisible)로 뮤테이션해도 살아남는
    // 케이스: 이 fixture는 "생략"과 "false"를 분리해야만 잡힌다. 두 값이 섞인
    // 조합이 이전에 없어 그 뮤테이션이 죽지 않았다.
    const secs = withWearing(2, [true, undefined]);
    const res = validateProLayout(secs, { wearing: true });
    expect(res.violations.map(v => v.code)).toContain('wearing_face_pair');
  });

  it('개수 위반과 쌍 위반은 서로 다른 code를 쓴다', () => {
    // 사용자에게 보이는 경고 문장이 code로 결정되므로(friendlyViolationWarnings가
    // code로만 문구를 찾고 message는 버린다), 같은 code를 쓰면 2장을 만든 사람이
    // "1개뿐입니다"를 보게 된다.
    const one = validateProLayout(withWearing(1), { wearing: true });
    expect(one.violations.map(v => v.code)).toContain('wearing_coverage');
    expect(one.violations.map(v => v.code)).not.toContain('wearing_face_pair');

    const bothFace = withWearing(2, [true, true]);
    const two = validateProLayout(bothFace, { wearing: true });
    expect(two.violations.map(v => v.code)).toContain('wearing_face_pair');
    expect(two.violations.map(v => v.code)).not.toContain('wearing_coverage');
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
    // false가 truthy 기반 복사로 유실되면 모든 크롭 컷이 얼굴 컷이 된다.
    expect((sections[1] as { imageSlots: Record<string, unknown>[] }).imageSlots[0]!.faceVisible).toBe(false);
  });

  it('modelGender에 잘못된 값이 오면 schema 위반', () => {
    const secs = withWearing(2);
    (secs[0]!.imageSlots as Record<string, unknown>[])[0]!.modelGender = 'other';
    const res = validateProLayout(secs, { wearing: true });
    expect(res.violations.some(v => v.code === 'schema')).toBe(true);
  });

  it('faceVisible에 boolean이 아닌 값이 오면 schema 위반', () => {
    const secs = withWearing(2);
    (secs[0]!.imageSlots as Record<string, unknown>[])[0]!.faceVisible = 'yes';
    const res = validateProLayout(secs, { wearing: true });
    expect(res.violations.some(v => v.code === 'schema')).toBe(true);
  });
});
