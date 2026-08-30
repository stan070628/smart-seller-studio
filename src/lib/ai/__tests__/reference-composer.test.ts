// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { composeReferences, MAX_REFERENCES, PRIORITY } from '../reference-composer';

const P = 'https://x/persona.jpg';
const S = 'https://x/scene.jpg';
const W = 'https://x/worn.jpg';
const F = 'https://x/flat.jpg';

describe('composeReferences', () => {
  it('상한은 3장이다', () => {
    expect(MAX_REFERENCES).toBe(3);
  });

  it('넷을 다 주면 씬을 버린다 — 버리는 순서의 첫 번째다', () => {
    const r = composeReferences({ persona: P, scene: S, productWorn: W, productFlat: F });
    expect(r.refs.map((x) => x.kind)).toEqual(['persona', 'productFlat', 'productWorn']);
    expect(r.sceneMode).toBe('fixtures');
    expect(r.dropped).toEqual(['scene']);
  });

  it('착용 참조가 없으면 씬이 들어간다 — 식품·잡화가 이 경우다', () => {
    const r = composeReferences({ persona: P, scene: S, productFlat: F });
    expect(r.refs.map((x) => x.kind)).toEqual(['persona', 'productFlat', 'scene']);
    expect(r.sceneMode).toBe('reference');
    expect(r.dropped).toEqual([]);
  });

  it('인물과 제품 누끼는 절대 버리지 않는다', () => {
    const r = composeReferences({ persona: P, scene: S, productWorn: W, productFlat: F });
    expect(r.refs.some((x) => x.kind === 'persona')).toBe(true);
    expect(r.refs.some((x) => x.kind === 'productFlat')).toBe(true);
    expect(r.dropped).not.toContain('persona');
    expect(r.dropped).not.toContain('productFlat');
  });

  it('씬이 아예 없으면 fixtures 모드가 아니라 none이다', () => {
    const r = composeReferences({ persona: P, productFlat: F });
    expect(r.sceneMode).toBe('none');
    expect(r.dropped).toEqual([]);
  });

  it('인물만 있어도 동작한다', () => {
    const r = composeReferences({ persona: P });
    expect(r.refs.map((x) => x.kind)).toEqual(['persona']);
    expect(r.sceneMode).toBe('none');
  });

  it('어떤 경우에도 상한을 넘지 않는다', () => {
    const r = composeReferences({ persona: P, scene: S, productWorn: W, productFlat: F });
    expect(r.refs.length).toBeLessThanOrEqual(MAX_REFERENCES);
  });

  it('각 슬롯이 자기 URL을 갖는다 — kind만 보면 URL이 뒤섞여도 통과한다', () => {
    const r = composeReferences({ persona: P, scene: S, productWorn: W, productFlat: F });
    const byKind = Object.fromEntries(r.refs.map((x) => [x.kind, x.url]));
    expect(byKind.persona).toBe(P);
    expect(byKind.productFlat).toBe(F);
    expect(byKind.productWorn).toBe(W);
  });

  it('빈 문자열은 없음으로 취급한다 — 호출부는 undefined를 넘겨야 한다', () => {
    const r = composeReferences({ persona: '', scene: S, productWorn: W, productFlat: F });
    expect(r.refs.some((x) => x.kind === 'persona')).toBe(false);
    expect(r.refs.map((x) => x.kind)).toEqual(['productFlat', 'productWorn', 'scene']);
    expect(r.dropped).toEqual([]);
  });
});

describe('PRIORITY', () => {
  it('순서가 고정돼 있다 — 이 배열이 모든 보장을 떠받친다', () => {
    expect(PRIORITY).toEqual(['persona', 'productFlat', 'productWorn', 'scene']);
  });

  it('버릴 수 없는 둘이 앞쪽 두 자리를 차지한다', () => {
    expect(PRIORITY.slice(0, 2)).toEqual(['persona', 'productFlat']);
  });
});
