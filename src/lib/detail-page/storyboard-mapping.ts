import type { DetailSection, SceneStoryboardItem } from '@/types/detail-page';

const IMAGE_SECTION_TYPES = new Set<string>(['hero', 'point']);

export function buildStoryboardWithSectionIds(
  scenes: SceneStoryboardItem[],
  sections: DetailSection[],
): SceneStoryboardItem[] {
  const imageSections = sections.filter(s => IMAGE_SECTION_TYPES.has(s.type));
  return scenes.map((scene, idx) => ({
    ...scene,
    sectionId: imageSections[idx]?.id ?? null,
  }));
}

export function getSceneForSection(
  storyboard: SceneStoryboardItem[],
  sectionId: string,
): SceneStoryboardItem | undefined {
  return storyboard.find(s => s.sectionId === sectionId);
}
