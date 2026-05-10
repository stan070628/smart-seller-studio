// src/lib/detail-page/section-parser.ts
import { v4 as uuidv4 } from 'uuid';
import type { DetailSection, SectionType } from '@/types/detail-page';
import type { DetailPageContent } from '@/lib/ai/prompts/detail-page';

/**
 * DetailPageContent(AI 생성 결과)를 DetailSection[] 으로 변환한다.
 * 빈 배열에 해당하는 선택적 섹션은 생략하며, order는 0부터 시작하는 연속 인덱스를 사용한다.
 */
export function contentToSections(content: DetailPageContent): DetailSection[] {
  if (!content.headline?.trim()) {
    throw new Error('contentToSections: headline must not be empty');
  }
  if (!content.ctaText?.trim()) {
    throw new Error('contentToSections: ctaText must not be empty');
  }

  const sections: DetailSection[] = [];
  let order = 0;

  // hero — headline/subheadline 는 항상 존재하므로 생략 조건 없음
  sections.push({
    id: uuidv4(),
    type: 'hero',
    order: order++,
    content: {
      type: 'hero',
      headline: content.headline,
      subheadline: content.subheadline,
    },
    attachedImages: [],
    aiInstruction: undefined,
  });

  // selling_points — 빈 배열이면 섹션 생략
  if (content.sellingPoints.length > 0) {
    sections.push({
      id: uuidv4(),
      type: 'selling_points',
      order: order++,
      content: {
        type: 'selling_points',
        points: content.sellingPoints,
      },
      attachedImages: [],
      aiInstruction: undefined,
    });
  }

  // features — 빈 배열이면 섹션 생략
  if (content.features.length > 0) {
    sections.push({
      id: uuidv4(),
      type: 'features',
      order: order++,
      content: {
        type: 'features',
        items: content.features,
      },
      attachedImages: [],
      aiInstruction: undefined,
    });
  }

  // spec_table — 빈 배열이면 섹션 생략
  if (content.specs.length > 0) {
    sections.push({
      id: uuidv4(),
      type: 'spec_table',
      order: order++,
      content: {
        type: 'spec_table',
        specs: content.specs,
      },
      attachedImages: [],
      aiInstruction: undefined,
    });
  }

  // usage_steps — 빈 배열이면 섹션 생략
  if (content.usageSteps.length > 0) {
    sections.push({
      id: uuidv4(),
      type: 'usage_steps',
      order: order++,
      content: {
        type: 'usage_steps',
        steps: content.usageSteps,
      },
      attachedImages: [],
      aiInstruction: undefined,
    });
  }

  // warning — 빈 배열이면 섹션 생략
  if (content.warnings.length > 0) {
    sections.push({
      id: uuidv4(),
      type: 'warning',
      order: order++,
      content: {
        type: 'warning',
        warnings: content.warnings,
      },
      attachedImages: [],
      aiInstruction: undefined,
    });
  }

  // cta — ctaText 는 항상 존재하므로 생략 조건 없음
  sections.push({
    id: uuidv4(),
    type: 'cta',
    order: order++,
    content: {
      type: 'cta',
      text: content.ctaText,
    },
    attachedImages: [],
    aiInstruction: undefined,
  });

  // 'stats' 섹션은 DetailPageContent에 해당 데이터가 없으므로 생성하지 않음.
  // 사용자가 수동으로 '섹션 추가' 버튼을 통해서만 추가 가능.

  return sections;
}

/**
 * 주어진 type과 order로 빈 DetailSection을 생성하는 헬퍼.
 * 드래그&드롭으로 새 섹션을 추가할 때 사용한다.
 */
export function createEmptySection(type: SectionType, order: number): DetailSection {
  const base = {
    id: uuidv4(),
    type,
    order,
    attachedImages: [] as DetailSection['attachedImages'],
    aiInstruction: undefined,
  } as const;

  switch (type) {
    case 'hero':
      return { ...base, type: 'hero', content: { type: 'hero', headline: '', subheadline: '' } };
    case 'selling_points':
      return { ...base, type: 'selling_points', content: { type: 'selling_points', points: [] } };
    case 'features':
      return { ...base, type: 'features', content: { type: 'features', items: [] } };
    case 'stats':
      return { ...base, type: 'stats', content: { type: 'stats', stats: [] } };
    case 'spec_table':
      return { ...base, type: 'spec_table', content: { type: 'spec_table', specs: [] } };
    case 'usage_steps':
      return { ...base, type: 'usage_steps', content: { type: 'usage_steps', steps: [] } };
    case 'warning':
      return { ...base, type: 'warning', content: { type: 'warning', warnings: [] } };
    case 'cta':
      return { ...base, type: 'cta', content: { type: 'cta', text: '' } };
  }
}

/**
 * 현재 배열 순서 기준으로 각 섹션의 order 필드를 0, 1, 2, ... 으로 재할당한다.
 * 드래그&드롭으로 순서가 바뀐 뒤 호출해 order를 정렬 상태와 동기화한다.
 * 원본 배열은 변경하지 않는다(불변 패턴).
 */
export function reorderSections(sections: DetailSection[]): DetailSection[] {
  return sections.map((s, i) => ({ ...s, order: i }));
}
