import { describe, it, expect } from 'vitest';
import { MOOD_PRESETS, getMoodPreset, parseSuggestedMoodIds } from '@/lib/detail-page/mood-presets';
import { PALETTES } from '@/lib/detail-page/palette-config';

describe('MOOD_PRESETS 카탈로그', () => {
  it('8개의 프리셋을 가진다', () => {
    expect(MOOD_PRESETS).toHaveLength(8);
  });

  it('모든 프리셋 id가 유일하다', () => {
    const ids = MOOD_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('모든 프리셋의 palette가 실제 PALETTES에 존재한다', () => {
    for (const preset of MOOD_PRESETS) {
      expect(PALETTES[preset.palette]).toBeDefined();
    }
  });

  it('모든 프리셋이 비어있지 않은 sceneHint를 가진다', () => {
    for (const preset of MOOD_PRESETS) {
      expect(preset.sceneHint.length).toBeGreaterThan(10);
    }
  });
});

describe('getMoodPreset', () => {
  it('존재하는 id로 프리셋을 찾는다', () => {
    expect(getMoodPreset('nordic_minimal')?.label).toBe('북유럽 미니멀');
  });
  it('없는 id면 null', () => {
    expect(getMoodPreset('does_not_exist')).toBeNull();
  });
  it('null/undefined면 null', () => {
    expect(getMoodPreset(null)).toBeNull();
    expect(getMoodPreset(undefined)).toBeNull();
  });
});

describe('parseSuggestedMoodIds', () => {
  const valid = MOOD_PRESETS.map((p) => p.id);

  it('JSON에서 카탈로그에 존재하는 id만 추린다', () => {
    const raw = '{"moodIds": ["luxury_dark", "hallucinated_id", "nordic_minimal"]}';
    expect(parseSuggestedMoodIds(raw, valid)).toEqual(['luxury_dark', 'nordic_minimal']);
  });

  it('최대 3개로 자른다 (유효 id 8개 입력 시 정확히 3개)', () => {
    const raw = JSON.stringify({ moodIds: valid });
    expect(parseSuggestedMoodIds(raw, valid)).toHaveLength(3);
  });

  it('moodIds가 배열이 아니면 빈 배열', () => {
    expect(parseSuggestedMoodIds('{"moodIds": "luxury_dark"}', valid)).toEqual([]);
  });

  it('중복을 제거한다', () => {
    const raw = '{"moodIds": ["luxury_dark", "luxury_dark"]}';
    expect(parseSuggestedMoodIds(raw, valid)).toEqual(['luxury_dark']);
  });

  it('JSON이 없으면 빈 배열', () => {
    expect(parseSuggestedMoodIds('not json at all', valid)).toEqual([]);
  });
});
