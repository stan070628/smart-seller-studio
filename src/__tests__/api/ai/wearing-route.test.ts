import { describe, it, expect } from 'vitest';
import { SCENE_PROMPT_SYSTEM } from '@/app/api/ai/generate-scene-image/prompts';

describe('wearing 씬 프롬프트', () => {
  it('SCENE_PROMPT_SYSTEM에 wearing 섹션 방향이 있다', () => {
    expect(SCENE_PROMPT_SYSTEM).toContain('wearing:');
  });
});
