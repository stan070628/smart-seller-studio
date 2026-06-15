import { describe, it, expect } from 'vitest';
import { buildSceneUserPrompt } from '@/app/api/ai/generate-scene-image/prompt';

describe('buildSceneUserPrompt', () => {
  it('sceneHint가 있으면 Art direction 라인을 포함한다', () => {
    const out = buildSceneUserPrompt('hero', { headline: '향수' }, 'moody marble and gold');
    expect(out).toContain('Art direction');
    expect(out).toContain('moody marble and gold');
    expect(out).toContain('Section type: hero');
  });

  it('sceneHint가 없으면 Art direction 라인이 없다 (기존 동작 유지)', () => {
    const out = buildSceneUserPrompt('lifestyle', { headline: '향수' }, undefined);
    expect(out).not.toContain('Art direction');
    expect(out).toContain('Section type: lifestyle');
  });

  it('productInfo가 없어도 동작한다', () => {
    const out = buildSceneUserPrompt('detail', undefined, undefined);
    expect(out).toContain('Section type: detail');
  });

  it('공백만 있는 sceneHint는 Art direction 라인을 만들지 않는다 (하위호환)', () => {
    const withWhitespace = buildSceneUserPrompt('hero', { headline: '향수' }, '   ');
    const withUndefined = buildSceneUserPrompt('hero', { headline: '향수' }, undefined);
    expect(withWhitespace).not.toContain('Art direction');
    expect(withWhitespace).toBe(withUndefined);
  });
});
