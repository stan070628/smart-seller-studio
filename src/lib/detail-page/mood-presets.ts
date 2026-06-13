import type { MoodPreset } from '@/types/detail-page';

/** 무드 프리셋 카탈로그. AI 추천(suggest-mood)과 갤러리(CreativeBriefPanel)가 공유한다. */
export const MOOD_PRESETS: MoodPreset[] = [
  {
    id: 'nordic_minimal',
    label: '북유럽 미니멀',
    emoji: '🌿',
    keywords: ['밝은 우드', '린넨', '자연광'],
    palette: 'cream_cozy',
    sceneHint:
      'bright Scandinavian minimalist setting, light oak wood surfaces, linen textiles, abundant soft natural daylight, generous negative space, muted warm neutrals',
  },
  {
    id: 'luxury_dark',
    label: '럭셔리 다크',
    emoji: '🥃',
    keywords: ['대리석', '골드', '무드조명'],
    palette: 'deep_dark',
    sceneHint:
      'moody low-key lighting, polished marble and brushed gold surfaces, dark elegant background, dramatic directional shadows, premium editorial feel',
  },
  {
    id: 'vivid_pop',
    label: '비비드 팝',
    emoji: '🍭',
    keywords: ['선명한 색', '그래픽', '활기'],
    palette: 'sunset_warm',
    sceneHint:
      'bright saturated color background, bold graphic color blocking, energetic playful mood, crisp even lighting, contemporary pop aesthetic',
  },
  {
    id: 'clean_tech',
    label: '클린 테크',
    emoji: '💻',
    keywords: ['클린 데스크', '블루톤', '미니멀'],
    palette: 'tech_navy',
    sceneHint:
      'clean modern desk setup, cool blue and slate tones, minimal tech environment, crisp soft lighting, organized uncluttered composition',
  },
  {
    id: 'natural_home',
    label: '내추럴 홈',
    emoji: '🪴',
    keywords: ['식물', '오가닉', '오후 햇살'],
    palette: 'nature_green',
    sceneHint:
      'cozy natural home interior, potted green plants, organic materials, warm afternoon daylight through a window, lived-in authentic feel',
  },
  {
    id: 'soft_romance',
    label: '소프트 로맨스',
    emoji: '🌸',
    keywords: ['파스텔 핑크', '부드러움', '드리미'],
    palette: 'rose_soft',
    sceneHint:
      'soft pastel pink palette, dreamy diffused lighting, delicate feminine styling, gentle gradients, airy romantic mood',
  },
  {
    id: 'fresh_clean',
    label: '프레시 클린',
    emoji: '💧',
    keywords: ['화이트', '청량', '에어리'],
    palette: 'fresh_mint',
    sceneHint:
      'bright airy white setting, fresh clean aesthetic, dewy freshness cues, high-key even lighting, crisp and hygienic feel',
  },
  {
    id: 'warm_cozy',
    label: '웜 코지',
    emoji: '☕',
    keywords: ['베이지', '아늑함', '골든아워'],
    palette: 'warm_cream',
    sceneHint:
      'warm beige and cream tones, cozy homely atmosphere, soft golden-hour lighting, comfortable textured fabrics, inviting relaxed mood',
  },
];

/** id로 프리셋 조회. 없으면 null. */
export function getMoodPreset(id: string | null | undefined): MoodPreset | null {
  if (!id) return null;
  return MOOD_PRESETS.find((p) => p.id === id) ?? null;
}

/**
 * Claude 응답 raw 텍스트에서 moodIds를 파싱하되, validIds에 존재하는 것만(환각 방어)
 * 중복 제거 후 최대 3개 반환한다.
 */
export function parseSuggestedMoodIds(rawText: string, validIds: string[]): string[] {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  const ids = (parsed as { moodIds?: unknown }).moodIds;
  if (!Array.isArray(ids)) return [];
  const validSet = new Set(validIds);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (typeof id === 'string' && validSet.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
      if (result.length >= 3) break;
    }
  }
  return result;
}
