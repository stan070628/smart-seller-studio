// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { findPersona, MODEL_PERSONAS } from '../model-registry';

describe('CharacterProfile', () => {
  it('여성 C에 굴다 프로필이 붙어 있다', () => {
    const p = findPersona('model_f_c');
    expect(p?.character?.name).toBe('굴다');
    expect(p?.character?.title).toBe('발굴템 연구소 연구원');
  });

  it('나머지 페르소나는 character가 없어도 그대로 동작한다', () => {
    const others = MODEL_PERSONAS.filter((p) => p.id !== 'model_f_c');
    expect(others).toHaveLength(4);
    for (const p of others) {
      expect(p.character).toBeUndefined();
      expect(p.sheetPath).toMatch(/^model-sheets\//);
    }
  });

  it('굴다의 말투 규칙과 금지 표현이 비어 있지 않다', () => {
    const c = findPersona('model_f_c')!.character!;
    expect(c.voiceRules.length).toBeGreaterThan(0);
    expect(c.forbidden.length).toBeGreaterThan(0);
  });
});
