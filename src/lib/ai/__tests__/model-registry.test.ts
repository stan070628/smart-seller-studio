// @vitest-environment node

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  findPersona,
  MODEL_PERSONAS,
  buildCharacterVoice,
  personaVoiceBlock,
  personaSheetUrl,
  personaLocalDir,
  personaLocalSheet,
} from '../model-registry';

describe('CharacterProfile', () => {
  it('여성 C에 굴다 프로필이 붙어 있다', () => {
    const p = findPersona('model_f_c');
    expect(p?.character?.name).toBe('굴다');
    expect(p?.character?.title).toBe('발굴템 연구소 연구원');
  });

  it('남성 B에 이루 프로필이 붙어 있다', () => {
    const p = findPersona('model_m_b');
    expect(p?.character?.name).toBe('이루');
    expect(p?.character?.title).toBe('「이루가 해봤어요」 진행자');
  });

  it('굴다와 알리는 어미가 겹치지 않는다 — 겹치면 두 화자가 구분되지 않는다', () => {
    const gulda = findPersona('model_f_c')!.character!;
    const ali = findPersona('model_m_b')!.character!;
    expect(gulda.voiceRules.join(' ')).toContain('~잖아요');
    expect(ali.voiceRules.join(' ')).toContain('~예요');
    // 알리는 다큐체를 쓰지 않는다. 굴다는 그것을 금지 표현으로 갖는다.
    expect(ali.voiceRules.join(' ')).toContain('~습니다체는 쓰지 않는다');
  });

  it('세 화자의 어미가 서로 겹치지 않는다 — 겹치면 한 연구소의 세 사람이 구분되지 않는다', () => {
    const gulda = findPersona('model_f_c')!.character!;
    const iru = findPersona('model_m_b')!.character!;
    const yuha = findPersona('model_f_d')!.character!;

    // 각자의 대표 어미
    expect(gulda.voiceRules.join(' ')).toContain('~잖아요');
    expect(iru.voiceRules.join(' ')).toContain('~예요');
    expect(yuha.voiceRules.join(' ')).toContain('~어요');

    // 🔴 유하는 다른 두 사람의 대표 어미를 규칙이 아니라 금지로 갖는다.
    // 이것이 없으면 「~예요」가 규칙에 섞여 이루와 같은 목소리가 된다(2026-09-08에 실제로 그랬다).
    expect(yuha.voiceRules.join(' ')).not.toContain('~예요');
    expect(yuha.voiceRules.join(' ')).not.toContain('~잖아요');
    expect(yuha.forbidden.join(' ')).toContain('~예요');
    expect(yuha.forbidden.join(' ')).toContain('~잖아요');
  });

  it('유하는 감식 담당이고 근거 없는 감성 수식을 금지한다', () => {
    const c = findPersona('model_f_d')!.character!;
    expect(c.name).toBe('유하');
    expect(c.title).toBe('발굴템 연구소 감식 담당');
    // 절제된 인상이라고 형용사를 늘리면 정반대가 된다 — 그래서 수식어 금지가 첫 항목에 가깝다.
    expect(c.forbidden.join(' ')).toContain('고급스러운');
  });

  it('프로필이 없는 페르소나도 그대로 동작한다', () => {
    const others = MODEL_PERSONAS.filter((p) => !p.character);
    expect(others).toHaveLength(3);
    for (const p of others) {
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

describe('personaVoiceBlock', () => {
  it('프로필이 있으면 말투 지시를 돌려준다', () => {
    const out = personaVoiceBlock('model_m_b');
    expect(out).toContain('이루');
    expect(out).toContain('~예요');
  });

  it('화자가 없으면 빈 문자열이다 — 프롬프트에 붙여도 아무 일이 없어야 한다', () => {
    expect(personaVoiceBlock(undefined)).toBe('');
    expect(personaVoiceBlock(null)).toBe('');
    expect(personaVoiceBlock('없는_id')).toBe('');
    // 프로필이 없는 페르소나도 같은 경로다
    expect(personaVoiceBlock('model_m_a')).toBe('');
  });
});

describe('personaSheetUrl — 전신 시트 선택', () => {
  const prev = process.env.NEXT_PUBLIC_SUPABASE_URL;
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  });
  afterAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev;
  });

  it('기본은 얼굴 시트다', () => {
    const url = personaSheetUrl(findPersona('model_m_b')!);
    expect(url).toContain('model_m_b.jpg');
    expect(url).not.toContain('combined');
  });

  it('fullBody면 합본 시트를 준다 — 얼굴만 주면 등신이 씬마다 달라진다', () => {
    const url = personaSheetUrl(findPersona('model_m_b')!, { fullBody: true });
    expect(url).toContain('model_m_b_combined.jpg');
  });

  it('합본이 없는 페르소나는 얼굴 시트로 물러난다 — 생성이 실패해서는 안 된다', () => {
    // model_f_a는 얼굴 3뷰 시트만 있다 (2026-09-06: model_m_a가 합본을 갖추며 대상 교체)
    const url = personaSheetUrl(findPersona('model_f_a')!, { fullBody: true });
    expect(url).toContain('model_f_a.jpg');
  });
});

describe('personaLocalDir — 폴더명 매핑', () => {
  it('캐릭터가 있으면 캐릭터명 폴더다', () => {
    expect(personaLocalDir('model_f_c')).toContain('/굴다');
    expect(personaLocalDir('model_m_b')).toContain('/이루');
    expect(personaLocalDir('model_m_a')).toContain('/무진');
  });

  it('나머지는 대문자 id 폴더다', () => {
    expect(personaLocalDir('model_f_a')).toContain('/model_F_A');
    expect(personaLocalDir('model_f_b')).toContain('/model_F_B');
  });

  it('시트 종류별 파일명을 만든다', () => {
    expect(personaLocalSheet('model_m_b')).toContain('/이루/캐릭터시트.jpg');
    expect(personaLocalSheet('model_m_b', 'body')).toContain('/이루/전신시트.png');
    expect(personaLocalSheet('model_m_b', 'combined')).toContain('/이루/캐릭터시트_합본.jpg');
  });
});

describe('턴어라운드 시트 — 의류 착용컷용', () => {
  const prev = process.env.NEXT_PUBLIC_SUPABASE_URL;
  beforeAll(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'; });
  afterAll(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = prev; });

  it('turnaround를 요구하면 3뷰 시트를 준다', () => {
    for (const id of ['model_m_a', 'model_m_b', 'model_f_c']) {
      const url = personaSheetUrl(findPersona(id)!, { turnaround: true });
      expect(url).toContain('_turnaround.jpg');
    }
  });

  it('턴어라운드가 없으면 합본으로, 합본도 없으면 얼굴로 물러난다', () => {
    // model_f_a는 둘 다 없다
    expect(personaSheetUrl(findPersona('model_f_a')!, { turnaround: true })).toContain('model_f_a.jpg');
  });

  it('로컬 경로도 종류별로 만든다', () => {
    expect(personaLocalSheet('model_f_c', 'turnaround')).toContain('/굴다/전신턴어라운드.jpg');
    expect(personaLocalSheet('model_m_a', 'turnaround')).toContain('/무진/전신턴어라운드.jpg');
  });
});
