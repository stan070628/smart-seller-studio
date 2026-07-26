import { describe, it, expect } from 'vitest';
import { buildSceneUserPrompt } from '@/app/api/ai/generate-scene-image/user-prompt';

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

describe('buildSceneUserPrompt — 편집 모드 (editOpts.isEditMode)', () => {
  it('isEditMode=true이면 첫 번째 이미지가 편집 대상임을 프롬프트에 명시한다', () => {
    const out = buildSceneUserPrompt('hero', { headline: '텀블러' }, undefined, {
      isEditMode: true,
      instruction: '배경을 야외로 바꿔줘',
    });
    expect(out).toContain('FIRST image');
    expect(out).toContain('existing scene');
    expect(out).toContain('배경을 야외로 바꿔줘');
  });

  it('isEditMode=true + instruction 없으면 instruction 라인이 없다', () => {
    const out = buildSceneUserPrompt('lifestyle', undefined, undefined, { isEditMode: true });
    expect(out).toContain('FIRST image');
    expect(out).not.toContain('Edit instruction');
  });

  it('isEditMode=false + instruction이면 Art direction으로 취급한다', () => {
    const out = buildSceneUserPrompt('hero', undefined, undefined, {
      isEditMode: false,
      instruction: '밝고 화사하게',
    });
    expect(out).toContain('Art direction');
    expect(out).toContain('밝고 화사하게');
    expect(out).not.toContain('FIRST image');
  });

  it('isEditMode=false이면 sceneHint와 instruction 모두 Art direction에 포함된다', () => {
    const out = buildSceneUserPrompt('hero', undefined, '골드 톤', {
      isEditMode: false,
      instruction: '밝게',
    });
    expect(out).toContain('골드 톤');
    expect(out).toContain('밝게');
  });

  it('기존 시그니처(editOpts 없음)는 하위호환 유지', () => {
    const out = buildSceneUserPrompt('hero', { headline: '향수' }, 'moody gold');
    expect(out).toContain('Art direction');
    expect(out).toContain('moody gold');
    expect(out).not.toContain('FIRST image');
  });
});
