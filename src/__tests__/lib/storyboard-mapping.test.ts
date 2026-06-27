import { describe, it, expect } from 'vitest';
import {
  buildStoryboardWithSectionIds,
  getSceneForSection,
} from '@/lib/detail-page/storyboard-mapping';
import type { DetailSection, SceneStoryboardItem } from '@/types/detail-page';

const makeSection = (id: string, type: 'hero' | 'point' | 'selling_points'): DetailSection => ({
  id,
  type,
  content: type === 'hero'
    ? { type: 'hero', headline: 'H', subheadline: 'S' }
    : type === 'point'
    ? { type: 'point', pointLabel: null, headline: 'H', subheadline: 'S' }
    : { type: 'selling_points', points: [] },
  attachedImages: [],
});

const makeRawScene = (title: string): SceneStoryboardItem => ({
  id: `scene-${title}`,
  title,
  description: '',
  prompt: `prompt for ${title}`,
  sourceImageIndex: 0,
  mode: 'ai',
  sectionId: null,
});

describe('buildStoryboardWithSectionIds', () => {
  it('이미지 섹션(hero/point) 순서대로 sectionId를 부여한다', () => {
    const sections: DetailSection[] = [
      makeSection('s1', 'hero'),
      makeSection('s2', 'selling_points'),
      makeSection('s3', 'point'),
    ];
    const scenes = [makeRawScene('A'), makeRawScene('B')];
    const result = buildStoryboardWithSectionIds(scenes, sections);
    expect(result[0].sectionId).toBe('s1');
    expect(result[1].sectionId).toBe('s3');
  });

  it('씬이 이미지 섹션보다 많으면 초과 씬의 sectionId는 null이다', () => {
    const sections: DetailSection[] = [makeSection('s1', 'hero')];
    const scenes = [makeRawScene('A'), makeRawScene('B'), makeRawScene('C')];
    const result = buildStoryboardWithSectionIds(scenes, sections);
    expect(result[0].sectionId).toBe('s1');
    expect(result[1].sectionId).toBeNull();
    expect(result[2].sectionId).toBeNull();
  });

  it('이미지 섹션이 없으면 모든 씬의 sectionId는 null이다', () => {
    const sections: DetailSection[] = [makeSection('s1', 'selling_points')];
    const scenes = [makeRawScene('A')];
    const result = buildStoryboardWithSectionIds(scenes, sections);
    expect(result[0].sectionId).toBeNull();
  });

  it('sections가 비어있어도 동작한다', () => {
    const result = buildStoryboardWithSectionIds([makeRawScene('A')], []);
    expect(result[0].sectionId).toBeNull();
  });
});

describe('getSceneForSection', () => {
  it('sectionId가 일치하는 씬을 반환한다', () => {
    const scenes: SceneStoryboardItem[] = [
      { ...makeRawScene('A'), sectionId: 's1' },
      { ...makeRawScene('B'), sectionId: 's2' },
    ];
    const result = getSceneForSection(scenes, 's2');
    expect(result?.title).toBe('B');
  });

  it('일치하는 씬이 없으면 undefined를 반환한다', () => {
    const scenes: SceneStoryboardItem[] = [{ ...makeRawScene('A'), sectionId: 's1' }];
    expect(getSceneForSection(scenes, 'unknown')).toBeUndefined();
  });

  it('sectionId가 null인 씬은 반환하지 않는다', () => {
    const scenes: SceneStoryboardItem[] = [{ ...makeRawScene('A'), sectionId: null }];
    expect(getSceneForSection(scenes, 'anything')).toBeUndefined();
  });
});
