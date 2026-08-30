// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { findPersona, MODEL_PERSONAS, buildCharacterVoice } from '../model-registry';

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

describe('buildCharacterVoice', () => {
  it('이름·직함·말투 규칙·금지를 한 지시문에 담는다', () => {
    const out = buildCharacterVoice(findPersona('model_f_c')!.character!);
    expect(out).toContain('굴다');
    expect(out).toContain('발굴템 연구소 연구원');
    expect(out).toContain('~잖아요');
    expect(out).toContain('~습니다 정중체');
  });

  it('규칙과 금지를 서로 다른 구획에 넣는다 — 섞이면 모델이 금지를 규칙으로 읽는다', () => {
    const out = buildCharacterVoice(findPersona('model_f_c')!.character!);
    const rulesAt = out.indexOf('지켜야 할 말투');
    const banAt = out.indexOf('쓰지 않는다');
    expect(rulesAt).toBeGreaterThan(-1);
    expect(banAt).toBeGreaterThan(rulesAt);
  });
});
