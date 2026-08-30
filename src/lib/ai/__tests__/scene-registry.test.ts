// @vitest-environment node

import { describe, it, expect, afterEach } from 'vitest';
import { SCENE_SHEETS, findScene, scenesFor, sceneSheetUrl } from '../scene-registry';

describe('SCENE_SHEETS', () => {
  it('굴다의 집으로 거실·부엌·현관이 등록돼 있다', () => {
    const ids = scenesFor('model_f_c').map((s) => s.id);
    expect(ids).toContain('home_living');
    expect(ids).toContain('home_kitchen');
    expect(ids).toContain('home_entrance');
  });

  it('모든 씬이 고정 소품 문장을 갖는다 — 참조를 못 넣을 때의 대체 수단이다', () => {
    for (const s of SCENE_SHEETS) {
      expect(s.fixtures.length).toBeGreaterThan(10);
    }
  });

  it('id가 중복되지 않는다', () => {
    const ids = SCENE_SHEETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('findScene', () => {
  it('없는 id에는 null을 준다', () => {
    expect(findScene('nope')).toBeNull();
    expect(findScene(undefined)).toBeNull();
  });
});

describe('sceneSheetUrl', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL;
  });

  it('Supabase 공개 URL을 만든다', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    const url = sceneSheetUrl(findScene('home_living')!);
    expect(url).toBe(
      'https://example.supabase.co/storage/v1/object/public/smart-seller-studio/scene-sheets/home_living.jpg',
    );
  });

  it('환경변수가 없으면 null을 준다 — 씬 없이도 생성은 진행돼야 한다', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(sceneSheetUrl(findScene('home_living')!)).toBeNull();
  });
});
