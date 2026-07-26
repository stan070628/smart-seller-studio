import { describe, it, expect } from 'vitest';
import { buildSceneUserPrompt } from '@/app/api/ai/generate-scene-image/user-prompt';
import { SCENE_PROMPT_SYSTEM } from '@/app/api/ai/generate-scene-image/prompts';

describe('wearing 씬 프롬프트', () => {
  it('SCENE_PROMPT_SYSTEM에 wearing 섹션 방향이 있다', () => {
    expect(SCENE_PROMPT_SYSTEM).toContain('wearing:');
  });

  it('buildSceneUserPrompt가 wearing을 받아 힌트를 실어보낸다', () => {
    const out = buildSceneUserPrompt('wearing', { headline: '민소매 티셔츠' }, '해변 산책');
    expect(out).toContain('해변 산책');
    expect(out).toContain('민소매 티셔츠');
  });
});
